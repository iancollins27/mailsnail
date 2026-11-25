# MailSnail for Hermes

Send real USPS letters and certified mail from Hermes. The agent writes the letter, checks the address and shows you a PDF proof with the exact price. Nothing is charged or mailed until you pay for that one letter on a payment page, by card.

This is a portable Agent Plugins v1 package: `plugin.json`, `mcp.json` and three skills. It holds configuration only, no code. The tools are served by MailSnail's hosted MCP server at `https://api.mailsnail.dev/guest/mcp` (Streamable HTTP, no account, no sign-in, no API key).

## Install

```bash
hermes plugins install mailsnail
hermes plugins enable mailsnail
```

Then start a new session and ask, for example:

> Mail a thank-you letter to my aunt at 12 Oak St, Dayton OH 45402.

> Send my landlord a certified letter giving 30 days' notice, with a return receipt.

> Has the letter I paid for on Tuesday been delivered?

## What you get

**Three skills** that tell the agent how to use the server:

- `mailsnail:send-letter`: write, preview, approve and pay for a first-class letter.
- `mailsnail:certified-mail`: choose between Certified Mail, an electronic return receipt and the green-card return receipt, and write a notice that holds up.
- `mailsnail:track-mail`: check a letter's status and USPS tracking.

**The `mailsnail` MCP server**, with four tools:

| Tool | What it does | Charges |
| --- | --- | --- |
| `verify_address` | Checks a US address against USPS records. | Nothing |
| `preview_letter` | Makes a PDF proof of exactly what will print, with the exact price and a `draft_id`. | Nothing |
| `send_letter` | Returns the page where you pay for that one proof at that price. The letter is mailed when the payment completes. | Nothing itself; you pay on the page |
| `get_letter` | The letter's status, and its USPS tracking once mailed. | Nothing |

## Approvals

The package marks the `mailsnail` server `untrusted`, so Hermes asks you before `preview_letter` and `send_letter` run (`verify_address` and `get_letter` are read-only). Neither tool moves money: the only paid step is the payment page, which you open yourself. In cron jobs and other unattended runs, Hermes refuses the two asking tools instead of running them.

## Prices

MailSnail prices mail at its own cost. The proof shows the exact price before you pay. Extra pages and color cost a little more. One-page prices, paid by card:

| Service | Price |
| --- | --- |
| First-class letter | $1.51 |
| Certified Mail | $8.83 |
| Certified Mail with an electronic return receipt | $11.83 |
| Certified Mail with the physical green-card return receipt | $14.42 |

US addresses only.

If you mail often, a MailSnail account with a prepaid balance makes each letter a little cheaper, and an agent that runs with nobody at the keyboard can use an API key and a balance a person has funded by card. Both are described at [mailsnail.dev/setup](https://mailsnail.dev/setup?utm_source=hermes) and [mailsnail.dev/developers](https://mailsnail.dev/developers?utm_source=hermes).

## Disclosure

- Every tool call goes over HTTPS to `api.mailsnail.dev`, which MailSnail runs. Nothing else is contacted, and the package stores nothing on your machine.
- The tool's inputs go to MailSnail: the names and addresses, the letter text and the options you chose. MailSnail never receives your chat history.
- To print and mail a letter, MailSnail sends it to a print partner, which hands it to USPS. Card payments are made on Stripe's own pages; MailSnail never sees your card number. The companies involved are listed at [mailsnail.dev/subprocessors](https://mailsnail.dev/subprocessors).
- The server keeps no account, no list of letters and no card for callers of this address. A `draft_id` is the only handle on a letter; the payment page shows the same status.
- Rate limits apply per caller: a limited number of proofs in ten minutes. The server answers `too_many_proofs` or `too_many_checks` and charges nothing.
- The tool set is served by the remote server at runtime and is not covered by the catalog's pinned commit.

Privacy policy: https://mailsnail.dev/privacy · Terms: https://mailsnail.dev/terms · Support: hello@mailsnail.dev

## Other clients

The same server works in any MCP client that speaks Streamable HTTP. MailSnail's other addresses, with an account or an API key, and setup for Claude, ChatGPT, Cursor and others are at [mailsnail.dev/setup](https://mailsnail.dev/setup?utm_source=hermes).

## License

MIT.
