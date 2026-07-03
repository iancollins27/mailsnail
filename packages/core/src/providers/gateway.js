// Gateway adapter: talk to a Mailsnail gateway over HTTP instead of holding
// print-provider credentials locally.
//
// Two deployments of the same wire protocol:
//   - "managed": Mailsnail's hosted gateway (https://api.mailsnail.dev).
//     No signup; the agent pays per piece via Stripe Shared Payment Tokens
//     (SPT) over the Machine Payments Protocol (HTTP 402 challenges).
//   - self-host: your own @mailsnail/gateway deployment with your own
//     provider credentials. Point baseUrl at it and no payment is involved.
//
// Payment flow (managed):
//   1. agent calls send without payment_token -> 402 + price + idempotency key
//   2. agent mints an SPT for the quoted amount and retries with payment_token
//   3. charge happens, mail goes out; failed mail auto-refunds

import { ProviderError, NotSupported } from "../errors.js";

export class GatewayProvider {
  constructor({ baseUrl, name = "managed" } = {}) {
    if (!baseUrl) {
      throw new Error(
        "baseUrl is required for the gateway provider (e.g. https://api.mailsnail.dev or your self-hosted gateway).",
      );
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this._name = name;
  }

  get name() {
    return this._name;
  }
  // The gateway gates "live" mode itself; from the client's perspective we
  // treat it as live (real money can move on each successful managed send).
  get isLive() {
    return true;
  }

  async _request(method, path, { body, headers } = {}) {
    const url = `${this.baseUrl}${path}`;
    const init = {
      method,
      headers: { Accept: "application/json", ...(headers ?? {}) },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch (netErr) {
      throw new ProviderError(
        `${this._name} gateway network error: ${netErr.message}`,
        { provider: this._name, safeToRetry: false },
      );
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, headers: res.headers, body: parsed };
  }

  _sendError(r) {
    if (r.status === 402) {
      // Surface the price/challenge as a structured error the agent can act on.
      const pr = r.body?.payment_request ?? {};
      const err = new ProviderError(
        `Payment required: ${pr.amount}¢ ${pr.currency} via ${(pr.methods ?? []).join(",")}`,
        { provider: this._name, status: 402, body: r.body },
      );
      err.payment_required = {
        amount_cents: pr.amount,
        currency: pr.currency,
        methods: pr.methods,
        idempotency_key: pr.idempotency_key,
        next_step:
          'Mint a Stripe Shared Payment Token (SPT) for the quoted amount and call the tool again with `payment_token: "spt_..."`.',
      };
      return err;
    }
    const detail = r.body?.mail_error
      ? `${r.body.error}: ${r.body.mail_error}`
      : (r.body?.error ?? `gateway ${r.status}`);
    const e = new ProviderError(detail, {
      provider: this._name,
      status: r.status,
      body: r.body,
      // The gateway refunds the charge when mail fails after payment —
      // in that one case nothing mailed and no money is held, so a router
      // may safely try another provider.
      safeToRetry: r.body?.error === "mail_failed_refund_issued",
    });
    if (r.body?.refund_id) e.refund_id = r.body.refund_id;
    return e;
  }

  async verifyAddress(input) {
    const r = await this._request("POST", "/v1/verify", { body: input });
    if (r.status >= 400) {
      throw new ProviderError(r.body?.error ?? `gateway ${r.status}`, {
        provider: this._name,
        status: r.status,
        body: r.body,
        safeToRetry: true,
      });
    }
    return r.body;
  }

  async preview(input) {
    const { payment_token, draft_id, ...rest } = input;
    const r = await this._request("POST", "/v1/preview", { body: rest });
    if (r.status >= 400) {
      throw new ProviderError(
        r.body?.message ?? r.body?.error ?? `gateway ${r.status}`,
        { provider: this._name, status: r.status, body: r.body, safeToRetry: true },
      );
    }
    return r.body;
  }

  async sendLetter(input) {
    const { payment_token, draft_id, ...rest } = input;
    // Confirm a previewed draft (draft_id) or one-shot send (full letter body).
    const body = draft_id
      ? payment_token
        ? { draft_id, payment_token }
        : { draft_id }
      : payment_token
        ? { ...rest, payment_token }
        : rest;
    const r = await this._request("POST", "/v1/letters", { body });
    if (r.status >= 400) throw this._sendError(r);
    return {
      id: r.body.id,
      status: r.body.status,
      url: r.body.receipt_url,
      mode: "LIVE",
      raw: r.body,
    };
  }

  async sendPostcard(input) {
    // Click2Mail-backed gateways use a single combined-sides PDF (front_url);
    // back_url is Lob-only.
    const { payment_token, back_url, ...rest } = input;
    const body = payment_token ? { ...rest, payment_token } : rest;
    const r = await this._request("POST", "/v1/postcards", { body });
    if (r.status >= 400) throw this._sendError(r);
    return {
      id: r.body.id,
      status: r.body.status,
      url: r.body.receipt_url,
      mode: "LIVE",
      raw: r.body,
    };
  }

  async getLetter(id) {
    const r = await this._request("GET", `/v1/letters/${encodeURIComponent(id)}`);
    if (r.status >= 400) {
      throw new ProviderError(r.body?.error ?? `gateway ${r.status}`, {
        provider: this._name,
        status: r.status,
        body: r.body,
        safeToRetry: true,
      });
    }
    return r.body;
  }

  async listLetters() {
    throw new NotSupported(this._name, "listLetters");
  }

  async cancelLetter() {
    throw new NotSupported(this._name, "cancelLetter");
  }
}
