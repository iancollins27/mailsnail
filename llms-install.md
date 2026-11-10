# Installing Mailsnail (for AI agents and IDE assistants)

Mailsnail lets an AI agent send real USPS letters and certified mail. There are two ways to install it. Use the hosted connector unless you have your own Click2Mail or Lob account.

## 1. Hosted connector (recommended, nothing to install)

Add this remote MCP server and sign in when prompted:

```
https://api.mailsnail.dev/mcp
```

Transport: Streamable HTTP. Auth: OAuth (the client opens a browser sign-in). Payment: the user pays per letter by card, or funds a prepaid balance; nothing is charged until `send_letter`.

Client configuration examples:

**Claude Code**
```bash
claude mcp add -t http mailsnail https://api.mailsnail.dev/mcp
```

**Cline, Cursor, VS Code, Windsurf and other clients that take a JSON config**
```json
{
  "mcpServers": {
    "mailsnail": {
      "url": "https://api.mailsnail.dev/mcp"
    }
  }
}
```
Some clients name the key `type: "streamable-http"` or `transport: "http"`; use the client's remote-server form. After adding it, run the client's authenticate step for the server.

**Claude Desktop, claude.ai, ChatGPT**: add `https://api.mailsnail.dev/mcp` as a custom connector. Step-by-step: https://mailsnail.dev/setup

Tools: `verify_address`, `preview_letter`, `send_letter`, `get_letter`, `cancel_letter`, `get_balance`, `add_payment_method`, `turn_off_auto_reload`.

Recommended flow: `verify_address` → `preview_letter` (free; returns a proof PDF and the exact price) → show the user the proof and price → `send_letter` with the `draft_id` only after the user approves. If the balance can't cover the letter, the `send_letter` result contains a `pay_url` the user opens to pay for just that letter; then call `send_letter` again.

Prices are at cost: $1.21 first-class letter from a balance ($1.51 by card per letter), certified $8.61, certified with electronic return receipt $11.64. US addresses only. Nothing is mailed without an explicit `send_letter` call.

## 2. Self-hosted (stdio) with your own print provider

Requires Node 18+ and your own Click2Mail or Lob credentials.

```json
{
  "mcpServers": {
    "mailsnail": {
      "command": "npx",
      "args": ["-y", "mailsnail"],
      "env": {
        "MAIL_PROVIDER": "lob",
        "LOB_API_KEY": "test_...",
        "MAIL_MCP_ALLOW_LIVE": "0"
      }
    }
  }
}
```

- `MAIL_PROVIDER`: `lob` or `click2mail` (`click2mail` needs `CLICK2MAIL_USERNAME` and `CLICK2MAIL_PASSWORD`).
- `MAIL_MCP_ALLOW_LIVE`: leave `0` (dry run) until you have checked a proof; set `1` to actually mail.
- `MAIL_MCP_SPEND_CAP_USD`: per-session spend cap, default 25.

Verify the setup with `npx mailsnail doctor`; it reports what it can reach and never mails anything.

The `managed` provider mode of the stdio package needs a Stripe Shared Payment Token, which most assistants can't create. Use the hosted connector instead.

## Support

Setup guide: https://mailsnail.dev/setup · Source: https://github.com/iancollins27/mailsnail · Issues: https://github.com/iancollins27/mailsnail/issues
