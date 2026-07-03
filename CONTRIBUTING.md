# Contributing

Bug reports, provider adapters, and gateway improvements are all welcome.
Small PRs land fast; open an issue first for anything structural.

## Repo layout

| Package | What it is |
|---|---|
| [`packages/core`](packages/core) | `@mailsnail/core` — provider interface, adapters (Click2Mail, Lob, gateway client), failover router, request validation. Zero dependencies. |
| [`packages/mailsnail`](packages/mailsnail) | The `mailsnail` MCP server (`npx -y mailsnail`) — 7 tools over any core provider. |
| [`spec/`](spec) | The provider-neutral mail-piece schema and the failover-safety contract. |

```bash
npm install        # installs + links workspaces
npm test           # core unit tests + MCP smoke (no network, no credentials)
```

## Writing a provider adapter

Adapters live in `packages/core/src/providers/`. An adapter is a class with:

```
constructor({ ...credentials, allowLive? })
get name(): string            // lowercase, stable — used in env config and error payloads
get isLive(): boolean         // true only when real mail can move
verifyAddress(input)          // -> verify_result (see spec/)
sendLetter(input)             // -> send_result
sendPostcard(input)           // -> send_result           (optional)
getLetter(id)                 //                          (optional)
listLetters(params)           //                          (optional)
cancelLetter(id)              //                          (optional)
preview(input)                //                          (optional; gateways only, usually)
```

Input and output shapes are pinned by [`spec/mailpiece.schema.json`](spec/mailpiece.schema.json).
Unsupported capabilities throw `NotSupported(name, capability)` — the failover
router uses this to move on to the next provider.

### The rules that matter

1. **Error honesty (`safeToRetry`).** Throw `ProviderError` with
   `safeToRetry: true` **only** when you can guarantee nothing entered
   production and no money moved. Default is `false`. This is the contract
   that makes multi-provider failover safe — get it wrong in the `true`
   direction and someone's recipient gets two certified letters.
2. **Dry-run by default.** `allowLive` (wired from `MAIL_ALLOW_LIVE=1`) gates
   anything that mails or bills. Without it, do as much as the provider allows
   (create drafts, validate, quote) and return `mode: "TEST"`.
3. **Never invent fields.** `id`, `status`, `tracking_number` come verbatim
   from the provider. Put the untranslated response in `raw`.
4. **No new dependencies in core.** Adapters use global `fetch` (Node 18+).
   Heavy things (PDF rendering, HTTP servers) belong in other packages.
5. **Preserve empirical provider knowledge in comments.** SKU strings,
   undocumented status codes, support-ticket findings — the comment is often
   worth more than the code around it.

### Checklist for an adapter PR

- [ ] Class in `packages/core/src/providers/<name>.js` implementing the interface
- [ ] Wired into `createProvider` in `providers/index.js` (env vars documented in the README table)
- [ ] `safeToRetry` reasoning written down as comments at every throw site
- [ ] Unit tests with mocked `fetch` (see `test/` for patterns) — happy path, error mapping, live-gating
- [ ] `npm test` green, no network calls in tests

## Releases

Packages publish from this monorepo under the `@mailsnail` scope (the MCP
server publishes as unscoped `mailsnail`). Maintainers cut releases; PRs
should not bump versions.
