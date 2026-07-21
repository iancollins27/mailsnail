# @mailsnail/core

Provider-agnostic core for sending physical mail from code. One interface,
swappable adapters, safe multi-provider failover. Zero dependencies (Node 18+).

```js
import { createProvider } from "@mailsnail/core";

// From env: MAIL_PROVIDER=click2mail|lob|managed|gateway,
// or MAIL_PROVIDERS=click2mail,lob for an ordered failover chain.
const mail = createProvider(process.env);

const result = await mail.sendLetter({
  to:   { name: "Jane Doe", address_line1: "123 Main St", address_city: "Springfield", address_state: "IL", address_zip: "62701" },
  from: { name: "Acme Co",  address_line1: "9 Market Ave", address_city: "Columbus",    address_state: "OH", address_zip: "43004" },
  file_url: "https://example.com/letter.pdf",
  extra_service: "certified",
});
```

Or construct adapters directly:

```js
import { Click2MailProvider, LobProvider, FailoverProvider } from "@mailsnail/core";

const mail = new FailoverProvider([
  new Click2MailProvider({ username, password, allowLive: true }),
  new LobProvider({ apiKey: process.env.LOB_API_KEY }),
]);
```

## What's in the box

- **Adapters** — `Click2MailProvider`, `LobProvider`, `GatewayProvider` (HTTP
  client for Mailsnail's hosted managed mode or your own self-hosted
  `@mailsnail/gateway`).
- **`FailoverProvider`** — routes each operation down an ordered provider
  chain. Sends fail over only on errors flagged `safeToRetry` (nothing
  mailed, no money moved) or `NotSupported`; ambiguous failures surface
  instead of risking duplicate mail.
- **Validation** — `validateAddress` / `validateLetterRequest` /
  `validatePostcardRequest`, implementing the repo-level
  [mail-piece spec](../../spec/).
- **Errors** — `ProviderError` (with `provider`, `status`, `safeToRetry`, and —
  for transport failures — a `code` from `ERROR_CODES` plus an actionable
  `hint`) and `NotSupported`.
- **`diagnose()` / `formatDiagnosis()`** — preflight connectivity check behind
  `npx mailsnail doctor`. Config, DNS, proxy status, and reachability of every
  host the configured provider needs, with the exact `host:port` to allowlist.
  Reads only; never mails, never charges.

A request that dies in transport is reported as such rather than as a provider
rejection: `egress_blocked` (a proxy/firewall answered instead of the provider),
`unreachable` (DNS/TCP never completed), or `tls_untrusted` (an inspecting proxy's
CA). All three mean nothing mailed and no money moved. Set `NODE_USE_ENV_PROXY=1`
(Node ≥ 22.21) or install the optional `undici` peer to route through
`HTTPS_PROXY`.

Live mail is opt-in everywhere: nothing mails or bills unless the adapter was
constructed with `allowLive: true` (env: `MAIL_ALLOW_LIVE=1`).

Part of the [Mailsnail monorepo](https://github.com/iancollins27/mailsnail). MIT.
