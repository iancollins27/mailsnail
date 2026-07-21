// Lob adapter. JSON REST against api.lob.com.
//
// Lob sends are single-shot POSTs, so failover safety maps to the HTTP
// outcome: a 4xx response means Lob rejected the request and nothing was
// created (safe to retry elsewhere); a 5xx or a network error leaves the
// outcome unknown (never fail over — a duplicate letter is worse than an
// error). Reads are always safe to retry.

import { ProviderError, NotSupported } from "../errors.js";

const LOB_BASE_URL = "https://api.lob.com/v1";

export class LobProvider {
  constructor({ apiKey } = {}) {
    if (!apiKey) {
      throw new Error(
        "LOB_API_KEY is required. Get one at https://dashboard.lob.com/settings/api-keys",
      );
    }
    this.apiKey = apiKey;
  }

  get name() {
    return "lob";
  }
  get isLive() {
    return this.apiKey.startsWith("live_");
  }

  // Hosts this adapter must reach — see `mailsnail doctor`.
  get endpoints() {
    return [{ url: LOB_BASE_URL, purpose: "Lob API" }];
  }

  async _request(method, path, body, { mutation = false } = {}) {
    const url = `${LOB_BASE_URL}${path}`;
    const auth = Buffer.from(`${this.apiKey}:`).toString("base64");
    const init = {
      method,
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch (netErr) {
      throw new ProviderError(`Lob network error: ${netErr.message}`, {
        provider: "lob",
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
      const msg =
        (parsed && parsed.error && parsed.error.message) ||
        `Lob API ${res.status}`;
      throw new ProviderError(msg, {
        provider: "lob",
        status: res.status,
        body: parsed,
        // 4xx = rejected, nothing created. 5xx on a mutation = unknown outcome.
        safeToRetry: !mutation || res.status < 500,
      });
    }
    return parsed;
  }

  _toLobAddress(a) {
    return {
      name: a.name,
      company: a.company,
      address_line1: a.address_line1,
      address_line2: a.address_line2,
      address_city: a.address_city,
      address_state: a.address_state,
      address_zip: a.address_zip,
      address_country: a.address_country ?? "US",
    };
  }

  async verifyAddress(input) {
    const result = await this._request("POST", "/us_verifications", {
      primary_line: input.address_line1,
      secondary_line: input.address_line2,
      city: input.address_city,
      state: input.address_state,
      zip_code: input.address_zip,
    });
    const zip = result.components?.zip_code ?? "";
    const plus4 = result.components?.zip_code_plus_4
      ? `-${result.components.zip_code_plus_4}`
      : "";
    return {
      deliverability: result.deliverability,
      normalized: {
        address_line1: result.primary_line,
        address_line2: result.secondary_line,
        address_city: result.components?.city,
        address_state: result.components?.state,
        address_zip: `${zip}${plus4}`,
      },
      raw: result,
    };
  }

  async sendLetter(input) {
    if (input.body_text) {
      throw new ProviderError(
        "body_text rendering requires a gateway (managed mode or a self-hosted @mailsnail/gateway). For direct Lob use, pass file_url.",
        { provider: "lob", safeToRetry: true },
      );
    }
    if (!input.file_url) {
      throw new ProviderError("Lob requires file_url.", {
        provider: "lob",
        safeToRetry: true,
      });
    }
    const payload = {
      to: this._toLobAddress(input.to),
      from: this._toLobAddress(input.from),
      file: input.file_url,
      color: input.color ?? false,
      double_sided: input.double_sided ?? true,
      address_placement: "top_first_page",
      description: input.description,
    };
    if (input.extra_service) payload.extra_service = input.extra_service;
    const result = await this._request("POST", "/letters", payload, {
      mutation: true,
    });
    return {
      id: result.id,
      status: result.send_date ? "scheduled" : "queued",
      expected_delivery_date: result.expected_delivery_date,
      tracking_number: result.tracking_number,
      url: result.url,
      mode: this.isLive ? "LIVE" : "TEST",
      raw: result,
    };
  }

  async sendPostcard(input) {
    if (!input.front_url || !input.back_url) {
      throw new ProviderError(
        "Lob postcards require front_url and back_url.",
        { provider: "lob", safeToRetry: true },
      );
    }
    const result = await this._request(
      "POST",
      "/postcards",
      {
        to: this._toLobAddress(input.to),
        from: this._toLobAddress(input.from),
        front: input.front_url,
        back: input.back_url,
        size: input.size ?? "4x6",
        description: input.description,
      },
      { mutation: true },
    );
    return {
      id: result.id,
      status: result.send_date ? "scheduled" : "queued",
      expected_delivery_date: result.expected_delivery_date,
      url: result.url,
      mode: this.isLive ? "LIVE" : "TEST",
      raw: result,
    };
  }

  async getLetter(id) {
    return this._request("GET", `/letters/${encodeURIComponent(id)}`);
  }

  async listLetters(params = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.before) qs.set("before", params.before);
    if (params.after) qs.set("after", params.after);
    const suffix = qs.toString() ? `?${qs}` : "";
    const result = await this._request("GET", `/letters${suffix}`);
    return {
      count: result.count,
      next_url: result.next_url,
      previous_url: result.previous_url,
      data: (result.data ?? []).map((l) => ({
        id: l.id,
        to: l.to,
        send_date: l.send_date,
        expected_delivery_date: l.expected_delivery_date,
        tracking_number: l.tracking_number,
        description: l.description,
        carrier: l.carrier,
      })),
    };
  }

  async preview() {
    throw new NotSupported("lob", "preview");
  }

  async cancelLetter(id) {
    return this._request("DELETE", `/letters/${encodeURIComponent(id)}`, undefined, {
      mutation: true,
    });
  }
}
