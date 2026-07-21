<img src="assets/logo.png" width="120" alt="Mailsnail" />

# Mailsnail

[![smoke](https://github.com/iancollins27/mailsnail/actions/workflows/smoke.yml/badge.svg)](https://github.com/iancollins27/mailsnail/actions/workflows/smoke.yml)

**Open-source, provider-agnostic physical mail for AI agents.**

Agents have every channel except one. They can email, text, call, and post to every feed — but until now, putting a real, postmarked envelope in a mailbox meant a human signing up for a print-provider account, provisioning API keys, and wiring billing. Mailsnail closes that gap:

- **No signup in managed mode.** Agents pay per piece via Stripe Shared Payment Tokens over the [Machine Payments Protocol](https://docs.stripe.com/payments/machine/mpp) (HTTP 402). First letter can go out minutes after install. $1.50 first-class, $9.00 certified, $1.00 postcard — flat, no subscription.
- **No lock-in, ever.** The provider layer is open and swappable: bring your own Click2Mail or Lob account, self-host the whole gateway, or chain providers for failover. The managed service is a convenience, not a cage.
- **Built for compliance mail.** Certified letters with `extra_service: "certified"` — the mail that legally *must* be physical (preliminary lien notices, legal notices) and must not miss its deadline because one print API had a bad day.

```bash
claude mcp add mailsnail -- npx -y mailsnail
# then: "Send me a postcard that says hello."
```

## Packages

| Package | What it is |
|---|---|
| [`mailsnail`](packages/mailsnail) | MCP server — 10 tools (`doctor`, `verify_address`, `preview_letter`, `send_letter`, `send_postcard`, `get_balance`, `top_up`, `get_letter`, `list_letters`, `cancel_letter`) over any provider below. Works in Claude Code, Claude Desktop, Cursor, Codex CLI, OpenAI Agents SDK. |
| [`@mailsnail/core`](packages/core) | Provider-agnostic core: adapters (Click2Mail, Lob, any Mailsnail gateway), multi-provider failover router, request validation. Zero dependencies. |
| [`@mailsnail/gateway`](packages/gateway) | Self-hostable REST API: BYO provider credentials, `body_text`→PDF rendering, proofs, invocation logging. The managed service at `api.mailsnail.dev` runs the same wire protocol. |
| [`spec/`](spec) | The provider-neutral mail-piece schema + the failover-safety contract. Implement it and anything — including a print shop — becomes a Mailsnail-compatible node. |

## Four ways to run it

| Mode | Credentials | Paying | Good for |
|---|---|---|---|
| **managed** (default) | none | agent, per piece (Stripe SPT) | agents; zero-setup |
| **gateway** | your own, on your server | your provider account | teams; PII stays in your infra |
| **click2mail / lob** (BYOK) | yours, local env | your provider account | direct control, one provider |
| **failover chain** | yours, per provider | your provider accounts | mail that must not miss deadlines |

Failover is deliberately conservative: a send moves to the next provider **only** when the failed provider guarantees nothing entered production and no money moved (`safeToRetry` — see [the spec](spec/README.md)). A duplicate certified letter is worse than an error.

## Running behind an egress proxy or allowlist

Sandboxed agents — CI runners, enterprise agent platforms, hosted agent sessions — usually sit behind an egress allowlist, and that is the environment managed mode is *for*. Two minutes of setup:

```bash
npx mailsnail doctor      # says exactly what it can and can't reach, and why. Free; never mails.
```

**Allow this host:**

| Mode | Host to permit | Port |
|---|---|---|
| managed (default) | `api.mailsnail.dev` | 443 (TCP / HTTPS `CONNECT`) |
| self-hosted gateway | whatever `MAIL_API_BASE_URL` points at | its port |
| click2mail (BYOK) | `rest.click2mail.com` | 443 |
| lob (BYOK) | `api.lob.com` | 443 |

Allowlist by **hostname**, not IP: the managed gateway runs on managed infrastructure and its addresses change without notice. If your policy is IP-only, self-host [`@mailsnail/gateway`](packages/gateway) on an address you control — that escape hatch is the whole point of the open provider layer.

**Through an HTTP proxy.** Node's `fetch` ignores `HTTPS_PROXY` unless you tell it not to, so an allowlisted gateway can still time out silently. Either:

```bash
export NODE_USE_ENV_PROXY=1        # Node >= 22.21
export HTTPS_PROXY=http://proxy.example:8080
```

or install `undici` alongside `mailsnail` (`npm i undici`) and Mailsnail routes through `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` itself, honoring `NO_PROXY`. `mailsnail doctor` tells you which of these is actually in effect.

**TLS-inspecting proxy?** Point `NODE_EXTRA_CA_CERTS` at your organization's CA bundle.

**When it's blocked anyway**, the failure says so instead of guessing: transport errors carry a `code` of `unreachable`, `egress_blocked`, or `tls_untrusted`, plus the exact `host:port` to permit. Any of those codes means the request never reached the backend — nothing mailed, nothing was charged, and the fix is network policy, not your account.

## Safety

- Dry-run by default everywhere; live mail requires an explicit `MAIL_MCP_ALLOW_LIVE=1`.
- Per-session spend caps in the MCP server; auto-refund in managed mode when a paid piece fails to mail.
- `preview_letter` returns a proof PDF and exact price before anything is charged — show it to your user first.
- Don't use this for spam, harassment, or fraud. Provider terms and USPS regulations apply; managed mode enforces its own abuse screening.

## Why open source

You're letting software put paper in mailboxes and spend money doing it. Read the code. Run it yourself with your own provider account for free. Use managed mode when you'd rather not hold credentials at all. If we ever disappoint you, `MAIL_PROVIDER=click2mail` and your mail keeps moving — that's the deal, and it's enforceable because this repo exists.

## Status

Early. US-only today. Letters, certified letters, and postcards. The managed API, MCP server, self-host gateway, and Click2Mail/Lob adapters are live; additional adapters (PostGrid, Stannp) are next — [CONTRIBUTING.md](CONTRIBUTING.md) has the adapter guide if you want one sooner.

## License

MIT.
