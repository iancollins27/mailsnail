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

export class ProviderError extends Error {
  constructor(message, { provider, status, body, safeToRetry = false } = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.body = body;
    this.safeToRetry = safeToRetry;
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
