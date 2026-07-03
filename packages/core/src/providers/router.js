// Multi-provider failover. The reason provider-agnostic matters in production:
// compliance mail (lien notices, legal notices) has statutory deadlines, and
// a single print API outage can miss them. FailoverProvider tries providers
// in order and moves to the next one only when it is safe to do so.
//
// Failover rules:
//   - Reads (verify, get, list, preview) fail over freely — worst case is a
//     404 from a provider that doesn't know the id.
//   - Sends fail over ONLY when the failed provider guarantees nothing
//     entered production and no money moved (err.safeToRetry === true), or
//     when it doesn't support the capability at all (NotSupported).
//     Ambiguous errors (network drop mid-submit, 5xx) surface to the caller —
//     a duplicate letter in a real mailbox is worse than an error message.
//   - cancelLetter fails over on 404/NotSupported so a piece sent via any
//     provider in the chain can be cancelled without knowing which one.

import { NotSupported } from "../errors.js";

export class FailoverProvider {
  constructor(providers, { onFailover } = {}) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error("FailoverProvider requires a non-empty providers array");
    }
    this.providers = providers;
    this.onFailover = onFailover; // optional ({ from, to, op, error }) => void
  }

  get name() {
    return `failover(${this.providers.map((p) => p.name).join("→")})`;
  }

  // Live if ANY provider in the chain can move real mail — callers gating on
  // isLive (spend caps, ALLOW_LIVE checks) should treat the chain as live.
  get isLive() {
    return this.providers.some((p) => p.isLive);
  }

  _shouldFailover(err, kind) {
    if (err instanceof NotSupported || err?.name === "NotSupported") return true;
    if (kind === "read") return true;
    if (kind === "cancel") return err?.status === 404;
    // kind === "send"
    return err?.safeToRetry === true;
  }

  async _run(op, args, kind) {
    let lastErr;
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[i];
      if (typeof p[op] !== "function") {
        lastErr = new NotSupported(p.name, op);
        continue;
      }
      try {
        return await p[op](...args);
      } catch (err) {
        lastErr = err;
        const next = this.providers[i + 1];
        if (next && this._shouldFailover(err, kind)) {
          this.onFailover?.({ from: p.name, to: next.name, op, error: err });
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  verifyAddress(input) {
    return this._run("verifyAddress", [input], "read");
  }
  preview(input) {
    return this._run("preview", [input], "read");
  }
  sendLetter(input) {
    return this._run("sendLetter", [input], "send");
  }
  sendPostcard(input) {
    return this._run("sendPostcard", [input], "send");
  }
  getLetter(id) {
    return this._run("getLetter", [id], "read");
  }
  listLetters(params) {
    return this._run("listLetters", [params], "read");
  }
  cancelLetter(id) {
    return this._run("cancelLetter", [id], "cancel");
  }
}
