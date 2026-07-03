# The Mailsnail mail-piece spec (v0)

A provider-neutral JSON shape for physical mail. One schema describes a letter
or postcard; any adapter or gateway that accepts it and returns the standard
result shapes is **Mailsnail-compatible** — swappable behind the same agent
tools, the same REST routes, and the same failover router.

- [`mailpiece.schema.json`](./mailpiece.schema.json) — JSON Schema (draft-07)
  for `letter`, `postcard`, `address`, `send_result`, `verify_result`.
- Runtime implementation: [`@mailsnail/core`](../packages/core)'s `schema.js`
  (validation) and `errors.js` (the failover-safety contract).

## Why a spec and not just a library

The library is the reference implementation; the spec is the interface. Print
providers differ in transport (JSON vs XML), in rendering (some accept HTML,
some only PDF), and in capabilities (certified, proofs, cancellation windows).
The spec pins down the parts a sender should never have to care about, so:

- new provider adapters can be written (and contributed) against a fixed
  contract — see [CONTRIBUTING.md](../CONTRIBUTING.md);
- a print shop or mail house can become API-addressable by implementing the
  gateway wire protocol (`/v1/verify`, `/v1/preview`, `/v1/letters`,
  `/v1/postcards`) over this schema, without adopting anyone's stack;
- routing and failover across providers stays safe, because the error
  contract (`safeToRetry`) is part of the interface, not an implementation
  detail.

## The failover-safety contract

Every adapter error carries `safeToRetry`:

- `true` — the adapter guarantees the failed operation caused **no mail to
  enter production and no money to move**. A router may retry the piece on
  another provider.
- `false` (default) — the outcome is unknown (network drop mid-submit, 5xx
  from the provider). Routers must surface the error instead of failing over;
  a duplicate letter in a real mailbox is worse than an error message.

## Versioning

This is v0: US-only, letters + postcards, `oneOf` content sources. Fields are
added, never repurposed. Breaking changes bump the schema `$id`
(`mailpiece.v1.schema.json`) and ship alongside v0, not over it.
