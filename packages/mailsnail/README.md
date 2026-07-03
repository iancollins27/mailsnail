# mailsnail

[![smoke](https://github.com/iancollins27/mailsnail/actions/workflows/smoke.yml/badge.svg)](https://github.com/iancollins27/mailsnail/actions/workflows/smoke.yml)
[![npm](https://img.shields.io/npm/v/mailsnail.svg)](https://www.npmjs.com/package/mailsnail)

> An MCP server that lets AI agents send physical mail — letters and postcards. Default mode requires no signup: agents pay per piece via Stripe Shared Payment Tokens. Open source and provider-agnostic. Powers [Mailsnail](https://mailsnail.dev).

```
agent  ──tools──>  mailsnail  ──HTTPS──>  gateway (Stripe + print provider)  ──USPS──>  mailbox
                       └──or directly: your Click2Mail / Lob account (BYOK)
```

## Why this exists

There's already a Lob MCP that exposes ~76 tools across every Lob resource. That's great for full coverage. This one is the opposite: **7 focused tools**, designed for the way agents actually use mail.

The big differentiator: **the default `managed` provider needs no account**. Agents pay per piece via Stripe Shared Payment Tokens (SPT) — works with [Stripe Link](https://stripe.com/link) wallets, the [link-cli](https://github.com/stripe/link-cli), and any agent runtime that supports the [Machine Payments Protocol](https://docs.stripe.com/payments/machine/mpp). No signup, no prepaid balance, no API keys to provision.

And because the provider layer ([`@mailsnail/core`](https://github.com/iancollins27/mailsnail/tree/main/packages/core)) is open and swappable, you're never locked in:

| Mode | Who holds the credentials | Who pays |
|---|---|---|
| `managed` (default) | The hosted backend | Agent, per piece, via Stripe SPT |
| `gateway` | Your self-hosted [@mailsnail/gateway](https://github.com/iancollins27/mailsnail) | You |
| `click2mail` | You | You |
| `lob` | You | You |
| `MAIL_PROVIDERS=a,b` | You (each provider) | You — ordered failover chain |

## Install

```bash
npx mailsnail
```

### Claude Desktop — Managed (no account, pay-per-piece)

```json
{
  "mcpServers": {
    "mailsnail": {
      "command": "npx",
      "args": ["-y", "mailsnail"],
      "env": {
        "MAIL_PROVIDER": "managed",
        "MAIL_API_BASE_URL": "https://api.mailsnail.dev"
      }
    }
  }
}
```

When the agent calls `send_letter` without a `payment_token`, the tool returns a `payment_required` error containing the quoted price. The agent mints an SPT for that amount (via Link wallet / link-cli / MPP) and calls `send_letter` again with the SPT in `payment_token`. Charge happens, mail goes out.

### Claude Desktop — Click2Mail (BYO account)

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mailsnail": {
      "command": "npx",
      "args": ["-y", "mailsnail"],
      "env": {
        "MAIL_PROVIDER": "click2mail",
        "CLICK2MAIL_USERNAME": "your_username",
        "CLICK2MAIL_PASSWORD": "your_password",
        "MAIL_MCP_SPEND_CAP_USD": "25"
      }
    }
  }
}
```

### Claude Desktop — Lob

```json
{
  "mcpServers": {
    "mailsnail": {
      "command": "npx",
      "args": ["-y", "mailsnail"],
      "env": {
        "MAIL_PROVIDER": "lob",
        "LOB_API_KEY": "test_...",
        "MAIL_MCP_SPEND_CAP_USD": "25"
      }
    }
  }
}
```

### Multi-provider failover

For mail that must go out (compliance deadlines), chain providers — a send moves to the next provider only when the failed one guarantees nothing mailed and nothing was charged:

```json
"env": {
  "MAIL_PROVIDERS": "click2mail,lob",
  "CLICK2MAIL_USERNAME": "...",
  "CLICK2MAIL_PASSWORD": "...",
  "LOB_API_KEY": "test_..."
}
```

### Cursor / Cline / Continue

Same shape, dropped into the client's MCP config. The command is `npx -y mailsnail`.

### Going live

When you're ready to actually mail real letters:

```json
"env": {
  "MAIL_MCP_ALLOW_LIVE": "1",
  "MAIL_MCP_SPEND_CAP_USD": "50",
  "...": "..."
}
```

For Lob, `MAIL_MCP_ALLOW_LIVE=1` is also required to start with a `live_` key. For Click2Mail (no test/live key distinction), it gates whether the server actually submits the final job — without it, jobs are created but not paid/queued.

## Tools

| Tool | What it does |
|---|---|
| `verify_address` | Validate + normalize a US address. Free on Lob; on Click2Mail uses CASS via a one-shot address list. |
| `preview_letter` | Proof PDF + exact price WITHOUT charging or mailing. Recommended first step; returns a `draft_id` you confirm with `send_letter`. Managed/gateway mode. |
| `send_letter` | Send a letter from plain text (managed/gateway renders the PDF) or a public PDF URL. `extra_service: 'certified'` for certified mail. |
| `send_postcard` | Send a 4×6 / 6×9 / 6×11 postcard from a PDF URL. |
| `get_letter` | Fetch status of a previously sent letter/job. |
| `list_letters` | List recent letters (Lob only). |
| `cancel_letter` | Cancel before production. Cancellation windows are short and provider-specific. |

### HTML / rendering

Embedding a PDF renderer in an `npx`-distributed server is a bad fit (puppeteer is ~300MB), so the MCP server itself never renders. In **managed** or **gateway** mode you can pass `body_text` and the backend renders the PDF for you; for **click2mail** / **lob** BYOK modes, pass a public URL to a pre-rendered PDF. Need to render in a BYOK mode? Pipe through a PDF-generation tool first.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_PROVIDER` | `managed` | `managed` (default, no signup), `gateway` (self-hosted), `click2mail`, or `lob`. |
| `MAIL_PROVIDERS` | — | Comma-separated ordered failover chain (overrides `MAIL_PROVIDER`), e.g. `click2mail,lob`. |
| `MAIL_API_BASE_URL` | `https://api.mailsnail.dev` | Backend for managed/gateway mode. Point at your own gateway to self-host. |
| `CLICK2MAIL_USERNAME` | — | Click2Mail account username. |
| `CLICK2MAIL_PASSWORD` | — | Click2Mail account password. |
| `LOB_API_KEY` | — | Lob API key. `test_*` is free; `live_*` actually mails. |
| `MAIL_MCP_ALLOW_LIVE` | `0` | Must be `1` to actually mail. Default is dry-run. |
| `MAIL_MCP_SPEND_CAP_USD` | `25` | Per-session estimated spend cap. Server refuses sends past this. |

## Safety notes

- **Spend cap is an estimate**, not a hard guarantee — it uses fixed per-piece prices (letter ~$1, certified ~$7, postcard ~$0.65). For a true cap, also set spend limits in the provider dashboard.
- **No KYC.** This server trusts whoever has the credentials. Don't expose it over a network interface; stdio only.
- **Provider terms apply.** Don't use this for spam, fraud, or anything that violates USPS regulations. Provider accounts get revoked.

## Roadmap

- Templates as MCP resources so agents can reuse letterhead by id.
- International delivery (US-only today).
- Delivery webhooks → MCP notifications.
- More providers (PostGrid, Stannp) for redundancy + price arbitrage — see the [adapter guide](https://github.com/iancollins27/mailsnail/blob/main/CONTRIBUTING.md).

## License

MIT.
