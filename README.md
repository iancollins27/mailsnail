<!-- DRAFT — voice-bearing (🟡). Ian's taste pass required before the repo goes public.
     This README is the canonical listing copy for the project. -->

# Mailsnail

**Open-source, provider-agnostic physical mail — for AI agents and the code they run in.**

Agents have every channel except one. They can email, text, call, and post — but until now, putting a real, postmarked envelope in a mailbox meant a human signing up for a print-provider account, provisioning API keys, and wiring billing. Mailsnail closes that gap:

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
| [`mailsnail`](packages/mailsnail) | MCP server — 7 tools (`verify_address`, `preview_letter`, `send_letter`, `send_postcard`, `get_letter`, `list_letters`, `cancel_letter`) over any provider below. Works in Claude Code, Claude Desktop, Cursor, Codex CLI, OpenAI Agents SDK. |
| [`@mailsnail/core`](packages/core) | Provider-agnostic core: adapters (Click2Mail, Lob, any Mailsnail gateway), multi-provider failover router, request validation. Zero dependencies. |
| [`spec/`](spec) | The provider-neutral mail-piece schema + the failover-safety contract. Implement it and anything — including a print shop — becomes a Mailsnail-compatible node. |

`@mailsnail/gateway` (self-hostable REST API: BYO provider credentials, `body_text`→PDF rendering, proofs) is next — the managed service at `api.mailsnail.dev` runs the same wire protocol.

## Four ways to run it

| Mode | Credentials | Paying | Good for |
|---|---|---|---|
| **managed** (default) | none | agent, per piece (Stripe SPT) | agents; zero-setup |
| **gateway** | your own, on your server | your provider account | teams; PII stays in your infra |
| **click2mail / lob** (BYOK) | yours, local env | your provider account | direct control, one provider |
| **failover chain** | yours, per provider | your provider accounts | mail that must not miss deadlines |

Failover is deliberately conservative: a send moves to the next provider **only** when the failed provider guarantees nothing entered production and no money moved (`safeToRetry` — see [the spec](spec/README.md)). A duplicate certified letter is worse than an error.

## Safety

- Dry-run by default everywhere; live mail requires an explicit `MAIL_MCP_ALLOW_LIVE=1`.
- Per-session spend caps in the MCP server; auto-refund in managed mode when a paid piece fails to mail.
- `preview_letter` returns a proof PDF and exact price before anything is charged — show it to your user first.
- Don't use this for spam, harassment, or fraud. Provider terms and USPS regulations apply; managed mode enforces its own abuse screening.

## Why open source

You're letting software put paper in mailboxes and spend money doing it. Read the code. Run it yourself with your own provider account for free. Use managed mode when you'd rather not hold credentials at all. If we ever disappoint you, `MAIL_PROVIDER=click2mail` and your mail keeps moving — that's the deal, and it's enforceable because this repo exists.

## Status

Early. US-only today. Letters, certified letters, and postcards. The managed API, MCP server, and Click2Mail/Lob adapters are live; the self-host gateway package and additional adapters (PostGrid, Stannp) are the current roadmap — [CONTRIBUTING.md](CONTRIBUTING.md) has the adapter guide if you want one sooner.

## License

MIT.
