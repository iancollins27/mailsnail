// Click2Mail adapter. REST integration against rest.click2mail.com.
//
// Flow for sending one letter:
//   1. POST /documents (multipart) -> documentId
//   2. POST /addressLists (XML) -> addressListId
//   3. Poll GET /addressLists/{id} until CASS standardized (status 3)
//   4. POST /jobs (form-urlencoded) -> jobId
//   5. POST /jobs/{id}/submit (form-urlencoded) — gated by allowLive
//
// Steps 1-4 are inert: no money moves and nothing mails until submit, so
// failures there are stamped safeToRetry (a router may fail over). Submit is
// the point of no return — only a 4xx response (C2M rejected it) is safe.

import { ProviderError, NotSupported } from "../errors.js";

const C2M_BASE_URL = "https://rest.click2mail.com/molpro";
const CASS_POLL_INTERVAL_MS = 1500;
const CASS_POLL_TIMEOUT_MS = 30_000;

function escapeXml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pickXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function isCertifiedService(extra_service) {
  return (
    extra_service === "certified" ||
    extra_service === "certified_return_receipt"
  );
}

export class Click2MailProvider {
  constructor({ username, password, allowLive = false } = {}) {
    if (!username || !password) {
      throw new Error(
        "CLICK2MAIL_USERNAME and CLICK2MAIL_PASSWORD are required. Sign up at https://click2mail.com.",
      );
    }
    this.username = username;
    this.password = password;
    // Click2Mail doesn't have separate test/live keys like Lob. The caller
    // explicitly opts into live via allowLive; otherwise jobs are created but
    // never submitted (nothing mails, nothing is billed).
    this.allowLive = !!allowLive;
  }

  get name() {
    return "click2mail";
  }
  get isLive() {
    return this.allowLive;
  }

  _authHeader() {
    return (
      "Basic " +
      Buffer.from(`${this.username}:${this.password}`).toString("base64")
    );
  }

  async _request(method, path, { body, contentType, accept, safeToRetry = true } = {}) {
    const url = `${C2M_BASE_URL}${path}`;
    const init = {
      method,
      headers: {
        Authorization: this._authHeader(),
        Accept: accept ?? "application/xml",
      },
    };
    if (body !== undefined) {
      if (contentType) init.headers["Content-Type"] = contentType;
      init.body = body;
    }
    // Retry idempotent GETs on transient network errors / 5xx (e.g. CASS polling).
    // POSTs are never retried here — avoids duplicate documents/jobs/charges.
    const maxAttempts = method === "GET" ? 3 : 1;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        res = await fetch(url, init);
      } catch (netErr) {
        lastErr = new ProviderError(
          `Click2Mail network error: ${netErr.message}`,
          { provider: "click2mail", safeToRetry },
        );
        if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 600 * attempt)); continue; }
        throw lastErr;
      }
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 500 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
          continue;
        }
        throw new ProviderError(
          `Click2Mail ${res.status}: ${text.slice(0, 300)}`,
          { provider: "click2mail", status: res.status, body: text, safeToRetry },
        );
      }
      return text;
    }
    throw lastErr;
  }

  async _uploadDocument({ pdfBuffer, documentClass = "Letter 8.5 x 11" }) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([pdfBuffer], { type: "application/pdf" }),
      "document.pdf",
    );
    form.append("documentClass", documentClass);
    form.append("documentFormat", "PDF");
    const xml = await this._request("POST", "/documents", { body: form });
    const id = pickXmlTag(xml, "id");
    if (!id)
      throw new ProviderError("Click2Mail did not return a document id", {
        provider: "click2mail",
        body: xml,
        safeToRetry: true,
      });
    return { id, raw: xml };
  }

  async _createAddressList(addresses) {
    const addrXml = addresses
      .map(
        (a) => `    <address>
      <first_name>${escapeXml(a.name?.split(" ")[0] ?? "")}</first_name>
      <last_name>${escapeXml(a.name?.split(" ").slice(1).join(" ") ?? "")}</last_name>
      <organization>${escapeXml(a.company ?? "")}</organization>
      <address1>${escapeXml(a.address_line1)}</address1>
      <address2>${escapeXml(a.address_line2 ?? "")}</address2>
      <address3></address3>
      <city>${escapeXml(a.address_city)}</city>
      <state>${escapeXml(a.address_state)}</state>
      <zip>${escapeXml(a.address_zip)}</zip>
      <country_non-us></country_non-us>
    </address>`,
      )
      .join("\n");
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<addressList>
  <addressMappingId>2</addressMappingId>
  <addresses>
${addrXml}
  </addresses>
</addressList>`;
    const xml = await this._request("POST", "/addressLists", {
      body,
      contentType: "application/xml",
    });
    const id = pickXmlTag(xml, "id");
    if (!id)
      throw new ProviderError("Click2Mail did not return an addressList id", {
        provider: "click2mail",
        body: xml,
        safeToRetry: true,
      });
    return { id, status: pickXmlTag(xml, "status"), raw: xml };
  }

  async _waitForCass(addressListId) {
    const start = Date.now();
    while (Date.now() - start < CASS_POLL_TIMEOUT_MS) {
      const xml = await this._request(
        "GET",
        `/addressLists/${encodeURIComponent(addressListId)}`,
      );
      const status = pickXmlTag(xml, "status");
      const description = pickXmlTag(xml, "statusDescription") ?? "";
      // Status 3 = "CASS Standardized" / ready
      if (status === "3" || /standardized/i.test(description)) {
        return { status, description, raw: xml };
      }
      if (/error|failed|invalid/i.test(description)) {
        throw new ProviderError(`Click2Mail CASS failed: ${description}`, {
          provider: "click2mail",
          body: xml,
          safeToRetry: true,
        });
      }
      await new Promise((r) => setTimeout(r, CASS_POLL_INTERVAL_MS));
    }
    throw new ProviderError(
      `Click2Mail CASS standardization timed out after ${CASS_POLL_TIMEOUT_MS}ms`,
      { provider: "click2mail", safeToRetry: true },
    );
  }

  async _createJob(params) {
    const body = new URLSearchParams(params).toString();
    const xml = await this._request("POST", "/jobs", {
      body,
      contentType: "application/x-www-form-urlencoded",
    });
    const id = pickXmlTag(xml, "id");
    if (!id)
      throw new ProviderError("Click2Mail did not return a job id", {
        provider: "click2mail",
        body: xml,
        safeToRetry: true,
      });
    return { id, status: pickXmlTag(xml, "status"), raw: xml };
  }

  async _submitJob(jobId) {
    if (!this.allowLive) {
      // Dry-run: don't actually submit. Return a synthetic "test" status.
      return {
        id: jobId,
        status: "TEST_NOT_SUBMITTED",
        statusDescription:
          "Job created but not submitted (live mode not enabled).",
      };
    }
    const body = new URLSearchParams({ billingType: "User Credit" }).toString();
    try {
      const xml = await this._request(
        "POST",
        `/jobs/${encodeURIComponent(jobId)}/submit`,
        { body, contentType: "application/x-www-form-urlencoded", safeToRetry: false },
      );
      return {
        id: jobId,
        status: pickXmlTag(xml, "status"),
        statusDescription: pickXmlTag(xml, "statusDescription"),
        raw: xml,
      };
    } catch (err) {
      // A 4xx means C2M rejected the submission — nothing entered production.
      // 5xx / network errors leave the outcome unknown; never fail those over.
      if (err instanceof ProviderError) {
        err.safeToRetry = typeof err.status === "number" && err.status < 500;
      }
      throw err;
    }
  }

  async _fetchPdf(url) {
    const res = await fetch(url);
    if (!res.ok)
      throw new ProviderError(
        `Failed to fetch file_url (${res.status}): ${url}`,
        { provider: "click2mail", status: res.status, safeToRetry: true },
      );
    return Buffer.from(await res.arrayBuffer());
  }

  async _normalizedAddress(listId) {
    try {
      const xml = await this._request(
        "GET",
        `/addressLists/${encodeURIComponent(listId)}/addresses`,
      );
      return {
        address_line1: pickXmlTag(xml, "address1"),
        address_line2: pickXmlTag(xml, "address2"),
        address_city: pickXmlTag(xml, "city"),
        address_state: pickXmlTag(xml, "state"),
        address_zip: pickXmlTag(xml, "zip"),
      };
    } catch {
      return null;
    }
  }

  /**
   * Verify a single US address. Click2Mail has no standalone verify endpoint:
   * create a single-address list, wait for CASS, return the standardized
   * address. Slow-ish (~2-30s of polling).
   */
  async verifyAddress(input) {
    const list = await this._createAddressList([
      {
        name: "Address Verification",
        address_line1: input.address_line1,
        address_line2: input.address_line2,
        address_city: input.address_city,
        address_state: input.address_state,
        address_zip: input.address_zip,
      },
    ]);
    const ready = await this._waitForCass(list.id);
    const normalized = await this._normalizedAddress(list.id);
    return {
      deliverability: ready.status === "3" ? "deliverable" : ready.description,
      normalized,
      raw: ready,
    };
  }

  /**
   * Create a Click2Mail job WITHOUT submitting it (a "draft"). No charge,
   * nothing mailed. Returns the jobId + CASS-normalized recipient address.
   * The draft can then be proofed (generateProof) and later submitted
   * (submitDraft).
   */
  async createDraft({
    to,
    file_url,
    pdf_buffer,
    color = false,
    double_sided = true,
    extra_service,
    certified,
    description,
  }) {
    const isCertified = certified ?? isCertifiedService(extra_service);
    if (!file_url && !pdf_buffer) {
      throw new ProviderError("Either file_url or pdf_buffer is required", {
        provider: "click2mail",
        safeToRetry: true,
      });
    }
    const pdfBuffer = pdf_buffer ?? (await this._fetchPdf(file_url));
    // The uploaded document's class must match the job's class. Certified jobs
    // ask for "Certified Letter 8.5 x 11", so the document has to be uploaded as
    // that too — uploading the default "Letter 8.5 x 11" under a certified job is
    // what produced "document not compatible". Confirmed by C2M support
    // (Mahesh Lavannis, 2025-07-23). First-class keeps the default class.
    const doc = await this._uploadDocument({
      pdfBuffer,
      documentClass: isCertified ? "Certified Letter 8.5 x 11" : "Letter 8.5 x 11",
    });
    const list = await this._createAddressList([to]);
    await this._waitForCass(list.id);
    const normalized = await this._normalizedAddress(list.id);
    const job = await this._createJob({
      // documentClass must match the class the document was uploaded under (above).
      // Certified SKU verified empirically against the live account (2026-06-16):
      // it resolves ONLY with productionTime "Next Day" — NOT "Next Business Day",
      // which C2M support (Mahesh, 2025-07-23) suggested but the API rejects with
      // "Sku not found". Support's envelope ("Certified Mail Letter Envelope") and
      // mailClass ("Certified Mail") were correct.
      documentClass: isCertified ? "Certified Letter 8.5 x 11" : "Letter 8.5 x 11",
      layout: "Address on Separate Page",
      productionTime: "Next Day",
      envelope: isCertified ? "Certified Mail Letter Envelope" : "#10 Double Window",
      color: color ? "Full Color" : "Black and White",
      paperType: "White 24#",
      printOption: double_sided ? "Printing both sides" : "Printing One side",
      mailClass: isCertified ? "Certified Mail" : "First Class",
      documentId: doc.id,
      addressId: list.id,
      ...(description ? { description } : {}),
    });
    return {
      jobId: job.id,
      jobStatus: job.status,
      normalized,
      raw: { document: doc, addressList: list, job },
    };
  }

  /**
   * Generate a print proof for a created (unsubmitted) job.
   * Returns { proofId, proofUrl }. proofUrl needs our credentials to fetch.
   */
  async generateProof(jobId) {
    const xml = await this._request(
      "POST",
      `/jobs/${encodeURIComponent(jobId)}/proof`,
    );
    const proofId = pickXmlTag(xml, "id");
    const proofUrl = pickXmlTag(xml, "statusUrl");
    if (!proofId || !proofUrl) {
      throw new ProviderError("Click2Mail did not return a proof id/url", {
        provider: "click2mail",
        body: xml,
        safeToRetry: true,
      });
    }
    return { proofId, proofUrl };
  }

  /** Fetch the proof PDF bytes from a proofUrl (uses our Basic auth). */
  async fetchProof(proofUrl) {
    const res = await fetch(proofUrl, {
      headers: { Authorization: this._authHeader() },
    });
    if (!res.ok) {
      throw new ProviderError(`Failed to fetch proof (${res.status})`, {
        provider: "click2mail",
        status: res.status,
        safeToRetry: true,
      });
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Submit a previously-created job (the "confirm" step). Gated by allowLive:
   * in dry-run, returns TEST_NOT_SUBMITTED without actually submitting.
   */
  async submitDraft(jobId) {
    const submitted = await this._submitJob(jobId);
    return {
      id: jobId,
      status: submitted.status,
      mode: this.allowLive ? "LIVE" : "TEST",
      raw: submitted,
    };
  }

  /** Send a letter end-to-end (create draft + submit in one call). */
  async sendLetter(input) {
    if (input.body_text) {
      throw new ProviderError(
        "body_text rendering requires a gateway (managed mode or a self-hosted @mailsnail/gateway). For direct Click2Mail use, render the letter to a PDF yourself and pass file_url.",
        { provider: "click2mail", safeToRetry: true },
      );
    }
    const draft = await this.createDraft(input);
    const submitted = await this._submitJob(draft.jobId);
    return {
      id: draft.jobId,
      status: submitted.status ?? draft.jobStatus,
      expected_delivery_date: undefined,
      tracking_number: undefined,
      url: undefined,
      mode: this.allowLive ? "LIVE" : "TEST",
      normalized: draft.normalized,
      raw: { ...draft.raw, submission: submitted },
    };
  }

  _postcardDocumentClass(size) {
    switch (size) {
      case "6x9":
        return "Postcard 6 x 9";
      case "6x11":
        return "Postcard 6 x 11";
      case "4x6":
      default:
        return "Postcard 4.25 x 6";
    }
  }

  /**
   * Send a postcard end-to-end (create + submit). For Click2Mail the postcard
   * is a single combined-sides PDF (front_url or pdf_buffer); back_url is
   * ignored. Gated by allowLive like letters.
   *
   * NOTE: Click2Mail's exact postcard documentClass / job param strings are
   * best-effort here (the letter job shape with postcard-appropriate values)
   * and should be confirmed against your Click2Mail account — same caveat as
   * certified had before it was verified.
   */
  async sendPostcard({
    to,
    front_url,
    pdf_buffer,
    size = "4x6",
    color = true,
    description,
  }) {
    if (!front_url && !pdf_buffer) {
      throw new ProviderError(
        "Either front_url or pdf_buffer is required for a postcard",
        { provider: "click2mail", safeToRetry: true },
      );
    }
    const documentClass = this._postcardDocumentClass(size);
    const pdfBuffer = pdf_buffer ?? (await this._fetchPdf(front_url));
    const doc = await this._uploadDocument({ pdfBuffer, documentClass });
    const list = await this._createAddressList([to]);
    await this._waitForCass(list.id);
    const normalized = await this._normalizedAddress(list.id);
    const job = await this._createJob({
      documentClass,
      // Postcards carry the address on the card itself (no separate cover page).
      layout: "Address on Same Page",
      productionTime: "Next Day",
      color: color ? "Full Color" : "Black and White",
      printOption: "Printing both sides",
      mailClass: "First Class",
      documentId: doc.id,
      addressId: list.id,
      ...(description ? { description } : {}),
    });
    const submitted = await this._submitJob(job.id);
    return {
      id: job.id,
      status: submitted.status ?? job.status,
      mode: this.allowLive ? "LIVE" : "TEST",
      normalized,
      raw: { document: doc, addressList: list, job, submission: submitted },
    };
  }

  async getLetter(id) {
    const xml = await this._request("GET", `/jobs/${encodeURIComponent(id)}`);
    return {
      id: pickXmlTag(xml, "id"),
      status: pickXmlTag(xml, "status"),
      statusDescription: pickXmlTag(xml, "statusDescription"),
      raw: xml,
    };
  }

  async preview() {
    throw new NotSupported("click2mail", "preview");
  }

  async listLetters() {
    throw new NotSupported("click2mail", "listLetters");
  }

  async cancelLetter(id) {
    // Click2Mail's REST API supports DELETE /jobs/{id} but only before submission.
    return this._request("DELETE", `/jobs/${encodeURIComponent(id)}`);
  }
}
