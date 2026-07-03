// The open Mailsnail gateway: a self-hostable REST API over any
// @mailsnail/core provider. Same wire protocol as the managed service at
// api.mailsnail.dev, minus payments — you hold the provider credentials, your
// provider account gets billed, so there is nothing to charge for here.
//
// Routes:
//   GET  /healthz
//   POST /v1/verify              -> verify_result
//   POST /v1/preview             -> { draft_id?, proof_url, ... }  (no charge, nothing mailed)
//   GET  /v1/preview/:token      -> proof PDF (short-lived, credential-free)
//   POST /v1/letters             -> send_result   ({ draft_id } confirms a preview)
//   GET  /v1/letters/:id         -> provider status
//   DELETE /v1/letters/:id       -> cancel (provider cancellation windows apply)
//   POST /v1/postcards           -> send_result

import express from "express";
import { randomBytes } from "node:crypto";
import {
  validateLetterRequest,
  validatePostcardRequest,
} from "@mailsnail/core";
import { textToPdf, TextToPdfError } from "./text-to-pdf.js";
import { invocationLogger } from "./invocation-log.js";

const PROOF_TTL_MS = 30 * 60 * 1000; // 30 min

function classifyLetter(body) {
  return body.extra_service === "certified" ||
    body.extra_service === "certified_return_receipt"
    ? "certified_letter"
    : "letter";
}

async function renderIfBodyText(body) {
  if (!body.body_text) return null;
  return textToPdf(body.body_text, { from_name: body.from?.name });
}

function sendErrorPayload(err) {
  return {
    error: "mail_failed",
    message: err.message,
    provider: err.provider,
    upstream_status: err.status,
    safe_to_retry: err.safeToRetry === true,
  };
}

/**
 * Build the gateway express app around a @mailsnail/core provider.
 *
 * @param {object} opts
 * @param {object} opts.provider - any core provider (single or FailoverProvider)
 * @param {string} [opts.publicBaseUrl] - external URL proofs are served under
 * @param {(line: object) => void} [opts.log] - invocation log sink (default: stdout JSON lines)
 */
export function createGatewayApp({ provider, publicBaseUrl, log } = {}) {
  if (!provider) throw new Error("createGatewayApp requires a provider");

  // In-memory stores for the preview -> confirm flow (drafts + hosted proofs).
  // Fine for low volume; swap for Redis / object storage when traffic warrants.
  const drafts = new Map();
  const proofs = new Map();

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(invocationLogger({ provider, log }));

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      mode: provider.isLive ? "LIVE" : "TEST",
      provider: provider.name,
    });
  });

  app.post("/v1/verify", async (req, res) => {
    if (!req.body?.address_line1) {
      return res.status(400).json({ error: "address_line1 is required" });
    }
    try {
      res.json(await provider.verifyAddress(req.body));
    } catch (err) {
      res
        .status(err.status === 401 ? 502 : 500)
        .json({ error: err.message, upstream_status: err.status });
    }
  });

  // Preview: create an unsubmitted draft + host a proof PDF. NO charge,
  // nothing mailed. Providers that support drafts (Click2Mail) give an
  // authoritative print proof + a confirmable draft_id; otherwise, body_text
  // requests fall back to a render-only proof (no draft_id — confirm by
  // re-sending the same body to POST /v1/letters).
  app.post("/v1/preview", async (req, res) => {
    const invalid = validateLetterRequest(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const kind = classifyLetter(req.body);

    let pdfBuffer = null;
    try {
      pdfBuffer = await renderIfBodyText(req.body);
    } catch (renderErr) {
      return res.status(400).json({
        error: "render_failed",
        message:
          renderErr instanceof TextToPdfError
            ? renderErr.message
            : "Failed to render body_text to PDF",
      });
    }

    const hostProof = (pdf) => {
      const token = randomBytes(24).toString("hex");
      const expiresAt = Date.now() + PROOF_TTL_MS;
      proofs.set(token, { pdf, expiresAt });
      const base = publicBaseUrl ?? "";
      return { proof_url: `${base}/v1/preview/${token}`, expiresAt };
    };

    try {
      if (typeof provider.createDraft === "function") {
        const draft = await provider.createDraft({
          to: req.body.to,
          file_url: pdfBuffer ? undefined : req.body.file_url,
          pdf_buffer: pdfBuffer,
          color: req.body.color ?? false,
          double_sided: req.body.double_sided ?? true,
          certified: kind === "certified_letter",
          description: req.body.description,
        });
        // Prefer the provider's authoritative print proof; fall back to our render.
        let proofPdf = pdfBuffer;
        if (
          typeof provider.generateProof === "function" &&
          typeof provider.fetchProof === "function"
        ) {
          const { proofUrl } = await provider.generateProof(draft.jobId);
          proofPdf = await provider.fetchProof(proofUrl);
        }
        if (!proofPdf) {
          return res.status(400).json({
            error: "preview_unavailable",
            message: "Provider returned no proof and no body_text was given to render.",
          });
        }
        const { proof_url, expiresAt } = hostProof(proofPdf);
        drafts.set(String(draft.jobId), { kind, createdAt: Date.now() });
        return res.json({
          draft_id: String(draft.jobId),
          proof_url,
          kind,
          mode: provider.isLive ? "LIVE" : "TEST",
          to_normalized: draft.normalized,
          expires_at: new Date(expiresAt).toISOString(),
          next_step:
            "Show proof_url to the user. On approval, POST /v1/letters with { draft_id } to mail exactly this proof.",
        });
      }

      if (pdfBuffer) {
        const { proof_url, expiresAt } = hostProof(pdfBuffer);
        return res.json({
          proof_url,
          kind,
          mode: provider.isLive ? "LIVE" : "TEST",
          expires_at: new Date(expiresAt).toISOString(),
          next_step:
            "Rendered preview only (provider does not support drafts). On approval, POST /v1/letters with the same body to send.",
        });
      }

      return res.status(501).json({
        error: "preview_not_supported",
        message: `${provider.name} does not support drafts; pass body_text for a render-only preview.`,
      });
    } catch (e) {
      return res
        .status(e.status === 401 ? 502 : 500)
        .json({ error: "preview_failed", message: e.message });
    }
  });

  // Serve a hosted proof PDF. No credentials; short-lived; safe to show a user.
  app.get("/v1/preview/:token", (req, res) => {
    const entry = proofs.get(req.params.token);
    if (!entry || entry.expiresAt < Date.now()) {
      if (entry) proofs.delete(req.params.token);
      return res.status(404).json({ error: "proof_not_found_or_expired" });
    }
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", 'inline; filename="mailsnail-proof.pdf"');
    res.send(entry.pdf);
  });

  app.post("/v1/letters", async (req, res) => {
    // Confirm a previewed draft.
    if (req.body?.draft_id) {
      const draftId = String(req.body.draft_id);
      if (!drafts.has(draftId)) {
        return res.status(404).json({
          error: "draft_not_found",
          message: "Unknown or expired draft_id. Call POST /v1/preview again.",
        });
      }
      if (typeof provider.submitDraft !== "function") {
        return res.status(501).json({
          error: "confirm_not_supported",
          message: `${provider.name} does not support draft confirmation.`,
        });
      }
      try {
        const submitted = await provider.submitDraft(draftId);
        drafts.delete(draftId);
        return res.json(submitted);
      } catch (err) {
        return res.status(502).json(sendErrorPayload(err));
      }
    }

    const invalid = validateLetterRequest(req.body);
    if (invalid) return res.status(400).json({ error: invalid });

    let pdfBuffer = null;
    try {
      pdfBuffer = await renderIfBodyText(req.body);
    } catch (renderErr) {
      return res.status(400).json({
        error: "render_failed",
        message:
          renderErr instanceof TextToPdfError
            ? renderErr.message
            : "Failed to render body_text to PDF",
      });
    }

    try {
      const result = await provider.sendLetter({
        to: req.body.to,
        from: req.body.from,
        file_url: pdfBuffer ? undefined : req.body.file_url,
        pdf_buffer: pdfBuffer,
        color: req.body.color ?? false,
        double_sided: req.body.double_sided ?? true,
        extra_service: req.body.extra_service,
        description: req.body.description,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json(sendErrorPayload(err));
    }
  });

  app.get("/v1/letters/:id", async (req, res) => {
    try {
      res.json(await provider.getLetter(req.params.id));
    } catch (err) {
      res.status(err.status === 404 ? 404 : 500).json({ error: err.message });
    }
  });

  app.delete("/v1/letters/:id", async (req, res) => {
    try {
      res.json({ cancelled: true, result: await provider.cancelLetter(req.params.id) });
    } catch (err) {
      res
        .status(err.status === 404 ? 404 : 502)
        .json({ error: err.message, upstream_status: err.status });
    }
  });

  app.post("/v1/postcards", async (req, res) => {
    const invalid = validatePostcardRequest(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const result = await provider.sendPostcard({
        to: req.body.to,
        from: req.body.from,
        front_url: req.body.front_url,
        back_url: req.body.back_url,
        size: req.body.size ?? "4x6",
        description: req.body.description,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json(sendErrorPayload(err));
    }
  });

  app.use((err, _req, res, _next) => {
    console.error("[mailsnail-gateway] unhandled error:", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
