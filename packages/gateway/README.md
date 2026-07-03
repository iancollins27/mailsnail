# @mailsnail/gateway

A self-hostable physical-mail REST API. Bring your own print-provider
credentials; get the same wire protocol as Mailsnail's managed service
(`api.mailsnail.dev`) on your own infrastructure — no payments layer, because
your provider account is the one being billed. PII never leaves your servers.

```bash
MAIL_PROVIDER=click2mail \
CLICK2MAIL_USERNAME=... CLICK2MAIL_PASSWORD=... \
npx mailsnail-gateway
# [mailsnail-gateway] listening on 8080 (provider=click2mail, mode=TEST, ...)
```

Or with failover across providers (see [the spec](../../spec/README.md) for
when a send is allowed to move to the next provider):

```bash
MAIL_PROVIDERS=click2mail,lob \
CLICK2MAIL_USERNAME=... CLICK2MAIL_PASSWORD=... LOB_API_KEY=live_... \
MAIL_ALLOW_LIVE=1 npx mailsnail-gateway
```

Docker:

```bash
docker build -t mailsnail-gateway packages/gateway
docker run -p 8080:8080 -e MAIL_PROVIDER=click2mail -e CLICK2MAIL_USERNAME=... \
  -e CLICK2MAIL_PASSWORD=... mailsnail-gateway
```

## Routes

| Route | What it does |
|---|---|
| `GET /healthz` | `{ ok, mode, provider }` |
| `POST /v1/verify` | Verify + normalize a US address |
| `POST /v1/preview` | Draft + hosted proof PDF, nothing mailed. Returns `draft_id` (drafting providers) or a render-only proof |
| `GET /v1/preview/:token` | The proof PDF (30-min TTL, credential-free) |
| `POST /v1/letters` | Send a letter (`body_text` is rendered server-side, or pass `file_url`); `{ draft_id }` confirms a preview |
| `GET /v1/letters/:id` | Provider status for a piece |
| `DELETE /v1/letters/:id` | Cancel before production (provider windows apply) |
| `POST /v1/postcards` | Send a postcard |

Request/response shapes are pinned by
[`spec/mailpiece.schema.json`](../../spec/mailpiece.schema.json).

## Pointing the MCP server at your gateway

```json
"env": {
  "MAIL_PROVIDER": "gateway",
  "MAIL_API_BASE_URL": "https://mail.internal.example.com"
}
```

Agents get the same 7 tools; your gateway does the rendering and talks to
your provider account.

## Env

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_PROVIDER` / `MAIL_PROVIDERS` | — (required) | Which core provider(s) to run. `click2mail`, `lob`, or a comma-separated failover chain. |
| `MAIL_ALLOW_LIVE` | `0` | Must be `1` for real mail. Otherwise drafts/dry-runs only. (`MAIL_API_ALLOW_LIVE` is honored as an alias.) |
| `PORT` | `8080` | Listen port. |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | External base URL used in returned `proof_url`s. |
| provider creds | — | `CLICK2MAIL_USERNAME`/`CLICK2MAIL_PASSWORD`, `LOB_API_KEY` — per provider. |

## Observability

One JSON line per invocation on stdout (`evt: "invocation"` — route, status,
duration, piece kind, provider, mode). Local only; nothing phones home.

## What the managed service adds on top

Same protocol, plus: pay-per-piece billing over Stripe SPT / HTTP 402 (so
agents need no account at all), auto-refund when a paid piece fails to mail,
and abuse screening. Self-host when you want control and your own provider
rates; use managed when you want zero setup.

MIT.
