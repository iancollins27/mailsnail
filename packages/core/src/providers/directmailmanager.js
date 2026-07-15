// Direct Mail Manager (DMM) adapter. JSON REST against
// api.directmailmanager.com. DMM does a First-Class letter cheaper than
// Click2Mail/Lob, so it sits first in the chain and owns the letter category;
// everything it doesn't implement (postcards, verify, preview, list) falls
// through to Click2Mail/Lob via FailoverProvider. See
// DESIGN-dmm-and-cheap-letters.md §3.
//
// Like Lob, DMM sends are single-shot POSTs, so failover safety maps to the
// HTTP outcome: a 4xx means DMM rejected the request and nothing was created
// (safe to retry elsewhere); a 5xx or a network error mid-submit leaves the
// outcome unknown (never fail over — a duplicate letter is worse than an
// error). Reads are always safe to retry.
//
// Schema confirmed from the DMM v3 docs (2026-07-14): the letter body uses
// `to_address` (first_name/last_name + address_* fields), a `mail_type` enum
// ("first_class" | "standard_class" — the latter is the cheap economy lane),
// `color`/`double_sided` booleans, and a required `artwork` reference. The ONE
// piece still to confirm with a sandbox send is how the PDF becomes that
// artwork: DMM creates an artwork resource (POST /artworks) and the letter
// references it, rather than taking an inline file URL like Lob. That step is
// marked TODO(sandbox-spike) below. See DESIGN-dmm-and-cheap-letters.md §7.

import { ProviderError, NotSupported } from "../errors.js";

const DMM_PROD_URL = "https://api.directmailmanager.com/api";
const DMM_SANDBOX_URL = "https://sandbox.directmailmanager.com/api";

// DMM does First-Class letters only. Certified/registered is Click2Mail's job,
// so certified requests throw NotSupported and the router fails over.
function isCertified(extra_service) {
  return (
    extra_service === "certified" ||
    extra_service === "certified_return_receipt"
  );
}

export class DirectMailManagerProvider {
  // DMM keys are environment-specific: a sandbox key only works against the
  // sandbox URL and never mails/bills. Live requires a prod key + sandbox:false.
  constructor({ apiKey, sandbox = true } = {}) {
    if (!apiKey) {
      throw new Error(
        "DMM_API_KEY is required. Generate one at https://app.directmailmanager.com/settings/api-keys",
      );
    }
    this.apiKey = apiKey;
    this.sandbox = !!sandbox;
    this.baseUrl = this.sandbox ? DMM_SANDBOX_URL : DMM_PROD_URL;
  }

  get name() {
    return "directmailmanager";
  }
  get isLive() {
    return !this.sandbox;
  }

  async _request(method, path, body, { mutation = false } = {}) {
    const url = `${this.baseUrl}${path}`;
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch (netErr) {
      // Network error: unknown outcome on a mutation → not safe to fail over.
      throw new ProviderError(`DMM network error: ${netErr.message}`, {
        provider: "directmailmanager",
        safeToRetry: !mutation,
      });
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      // TODO(sandbox-spike): confirm DMM's error body shape (assumed
      // { message } here). This only affects the surfaced message string, not
      // the safeToRetry decision below.
      const msg = parsed?.message || `DMM API ${res.status}`;
      throw new ProviderError(msg, {
        provider: "directmailmanager",
        status: res.status,
        body: parsed,
        // 4xx = rejected, nothing created. 5xx on a mutation = unknown outcome.
        safeToRetry: !mutation || res.status < 500,
      });
    }
    return parsed;
  }

  _toDmmAddress(a) {
    // Confirmed from the DMM v3 address schema: first_name/last_name (DMM splits
    // the recipient into two fields), company, address_line1/2, address_city/
    // state/zip, address_country.
    const parts = (a.name ?? "").trim().split(/\s+/);
    return {
      first_name: parts[0] ?? "",
      last_name: parts.slice(1).join(" "),
      company: a.company,
      address_line1: a.address_line1,
      address_line2: a.address_line2 ?? "",
      address_city: a.address_city,
      address_state: a.address_state,
      address_zip: a.address_zip,
      address_country: a.address_country ?? "US",
    };
  }

  async sendLetter(input) {
    if (input.body_text) {
      throw new ProviderError(
        "body_text rendering requires a gateway (managed mode or a self-hosted @mailsnail/gateway). For direct DMM use, pass file_url.",
        { provider: "directmailmanager", safeToRetry: true },
      );
    }
    // First-Class only. Certified/registered → NotSupported so the router
    // fails over to Click2Mail (which owns the cheapest certified path).
    if (isCertified(input.extra_service)) {
      throw new NotSupported("directmailmanager", "certified mail");
    }
    if (!input.file_url) {
      throw new ProviderError("DMM requires file_url.", {
        provider: "directmailmanager",
        safeToRetry: true,
      });
    }
    // POST /letters body — confirmed field names from the DMM v3 docs. `mail_type`
    // selects the class: default First-Class, or "standard_class" for the cheap
    // economy lane. The recipient is `to_address`; DMM uses the account's default
    // return address (or a /company-addresses reference) rather than inline `from`.
    const payload = {
      name: input.description ?? "Mailsnail letter",
      to_address: this._toDmmAddress(input.to),
      color: input.color ?? false,
      double_sided: input.double_sided ?? true,
      mail_type:
        input.mail_type === "standard_class" ? "standard_class" : "first_class",
      address_placement: "top_first_page",
      // TODO(sandbox-spike): DMM references an `artwork` created via POST /artworks
      // from the PDF — not an inline file URL like Lob. A sandbox send resolves the
      // upload flow; until then we pass file_url through as the artwork reference.
      artwork: input.file_url,
      // TODO(sandbox-spike): to override the return address, pass a company-address
      // id (input.from → /company-addresses). Omitted uses the account default.
    };
    const result = await this._request("POST", "/letters", payload, {
      mutation: true,
    });
    // TODO(sandbox-spike): confirm the response field names (id / status /
    // expected_delivery_date / tracking_number / url) against a real sandbox
    // response; mapped to the standard SendResult below.
    return {
      id: result.id,
      status: result.status ?? "queued",
      expected_delivery_date: result.expected_delivery_date,
      tracking_number: result.tracking_number,
      url: result.url,
      mode: this.isLive ? "LIVE" : "TEST",
      raw: result,
    };
  }

  async getLetter(id) {
    return this._request("GET", `/letters/${encodeURIComponent(id)}`);
  }

  async cancelLetter(id) {
    // TODO(sandbox-spike): confirm the cancel verb + shape. DMM appears to
    // cancel via a PATCH status change pre-production (vs Lob's DELETE);
    // confirm whether it's PATCH { status: "cancelled" } or DELETE /letters/:id.
    return this._request(
      "PATCH",
      `/letters/${encodeURIComponent(id)}`,
      { status: "cancelled" },
      { mutation: true },
    );
  }

  // Intentionally NO sendPostcard / verifyAddress / preview / listLetters.
  // DMM is not cheapest at those (or doesn't offer them), so omitting the
  // methods lets FailoverProvider route them to click2mail / lob. See
  // DESIGN-dmm-and-cheap-letters.md §3.
}
