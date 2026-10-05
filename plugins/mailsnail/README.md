# MailSnail

Send real USPS letters and certified mail from a conversation. Claude writes the letter, checks the address and shows you a PDF proof with the exact price. Nothing is charged or mailed until you approve it.

This plugin bundles two things:

- **The MailSnail connector:** the hosted MCP server at `https://api.mailsnail.dev/mcp`.
- **Three skills that tell Claude how to use it:**
  - `send-letter`: write, preview, approve and send a first-class letter.
  - `certified-mail`: choose between Certified Mail, an electronic return receipt and the green-card return receipt, and write a notice that holds up.
  - `track-mail`: check a sent piece's status and your balance.

## Use it

1. Install the plugin. Then connect MailSnail from the plugin's **Connectors** tab, or in Claude Code, connect the `mailsnail` server through `/mcp`.
2. Sign in. Your MailSnail account is created the first time you sign in.
3. Ask for what you need, for example:
   - "Mail a thank-you letter to my aunt at 12 Oak St, Dayton OH 45402."
   - "Send my landlord a certified letter giving 30 days' notice, with a return receipt."
   - "Has the letter I sent on Tuesday been delivered?"

The first time you send, Claude gives you a Stripe link to fund a prepaid balance with a one-time payment. Each piece is then paid from the balance. There's no subscription, and your card isn't saved unless you choose automatic reloads. You can turn reloads off any time by asking Claude.

MailSnail prices mail at its own cost. The preview shows the exact price before anything is charged. Extra pages and color cost a little more.

| Service | Price (one page) |
|---|---|
| First-class letter | $1.21 |
| Certified Mail | $8.61 |
| Certified Mail with an electronic return receipt | $11.64 |
| Certified Mail with the physical green-card return receipt | $14.27 |

US addresses only.

## Data

The plugin has no code of its own: only skills (Markdown instructions) and a connector address.

When Claude uses a MailSnail tool, the tool's inputs go to MailSnail at `api.mailsnail.dev`: names and addresses, the letter text or PDF link, and the options you chose. MailSnail never receives your chat history.

To print and mail a letter, MailSnail sends it to its print-and-mail partner, Click2Mail, which hands it to USPS. Payments are handled on Stripe's own pages, and MailSnail never sees your card number. Sign-in is handled by WorkOS.

Privacy policy: https://mailsnail.dev/privacy · Terms: https://mailsnail.dev/terms · Support: hello@mailsnail.dev

## License

MIT
