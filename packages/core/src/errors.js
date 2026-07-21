/**
 * Shared error types for all providers.
 *
 * `safeToRetry` on a ProviderError is the contract that makes multi-provider
 * failover safe: it is `true` ONLY when the adapter can guarantee the failed
 * operation caused no mail to enter production and no money to move. Routers
 * must never fail a send over to another provider unless the error says
 * safeToRetry === true (or the capability was NotSupported). When in doubt,
 * adapters leave it false — a duplicate letter in a real mailbox is worse
 * than a surfaced error.
 */

/**
 * Machine-readable flavors for errors that are NOT the provider rejecting the
 * request. Everything here means the request died in transport — nothing
 * mailed, nothing was charged — and the fix is in the caller's network, not in
 * their account. Callers (and agents) should branch on `err.code` rather than
 * pattern-matching messages.
 */
export const ERROR_CODES = Object.freeze({
  /** DNS/TCP/TLS never completed: refused, timed out, or unresolvable. */
  UNREACHABLE: "unreachable",
  /** Something in between answered instead of the provider: egress proxy, firewall, allowlist. */
  EGRESS_BLOCKED: "egress_blocked",
  /** TLS handshake rejected — usually a TLS-inspecting proxy with an untrusted CA. */
  TLS_UNTRUSTED: "tls_untrusted",
  /** Reached something, but it answered like a broken hop rather than the gateway. */
  GATEWAY_UNAVAILABLE: "gateway_unavailable",
});

export class ProviderError extends Error {
  constructor(
    message,
    { provider, status, body, safeToRetry = false, code, hint } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.body = body;
    this.safeToRetry = safeToRetry;
    // Optional: one of ERROR_CODES, set when the failure is transport-level and
    // the message alone would be misleading (e.g. a proxy's bare 403).
    this.code = code;
    // Optional: the concrete next action — what to allowlist, what to set.
    this.hint = hint;
  }
}

export class NotSupported extends Error {
  constructor(provider, capability) {
    super(`${provider} does not support ${capability}`);
    this.name = "NotSupported";
    this.provider = provider;
    this.capability = capability;
  }
}
