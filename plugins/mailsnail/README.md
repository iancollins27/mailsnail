# MailSnail

Send real USPS letters and certified mail from a conversation. Claude writes the letter, checks the address and shows you a PDF proof with the exact price. Nothing is charged or mailed until you approve it.

This plugin bundles two things:

- **The MailSnail connector:** the hosted MCP server at `https://api.mailsnail.dev/mcp`.
- **Three skills that tell Claude how to use it:**
  - `send-letter`: write, preview, approve and send a first-class letter.
  - `certified-mail`: choose between Certified Mail, an electronic return receipt and the green-card return receipt, and write a notice that holds up.
  - `track-mail`: check a sent letter's status, cancel one that hasn't been printed yet, and see your balance.

## Use it

1. Install the plugin. In Claude Code, run:

   ```text
   /plugin install mailsnail --marketplace iancollins27/mailsnail
   ```

   Then connect MailSnail: in Claude and Cowork from the plugin's **Connectors** tab, in Claude Code through `/mcp`.
2. Sign in. Your MailSnail account is created the first time you sign in.
3. Ask for what you need, for example:
   - "Mail a thank-you letter to my aunt at 12 Oak St, Dayton OH 45402."
   - "Send my landlord a certified letter giving 30 days' notice, with a return receipt."
   - "Has the letter I sent on Tuesday been delivered?"

You pay only when you send. The first time, Claude gives you a link to a page where you pay for just that letter by card. No card is saved and there's no subscription.

If you send mail often, you can add funds to a MailSnail balance instead, which makes each letter a little cheaper. Automatic reloads stay off unless you turn them on, and you can turn them off any time by asking Claude.

MailSnail prices mail at its own cost. The preview shows the exact price before anything is charged. Extra pages and color cost a little more.

| Service (one page) | From a balance | One letter by card |
|---|---|---|
| First-class letter | $1.21 | $1.51 |
| Certified Mail | $8.61 | $8.83 |
| Certified Mail with an electronic return receipt | $11.64 | $11.83 |
| Certified Mail with the physical green-card return receipt | $14.27 | $14.42 |

Paying for one letter by card costs a little more only because that one small payment carries the whole card processing fee.

US addresses only.

## Data

The plugin has no code of its own: only skills (Markdown instructions) and a connector address.

When Claude uses a MailSnail tool, the tool's inputs go to MailSnail at `api.mailsnail.dev`: names and addresses, the letter text or PDF link, and the options you chose. MailSnail never receives your chat history.

To print and mail a letter, MailSnail sends it to a third-party print partner (currently Click2Mail), which hands it to USPS. Card payments are made on Stripe's own pages, and MailSnail never sees your card number. Sign-in is handled by WorkOS.

Privacy policy: https://mailsnail.dev/privacy · Terms: https://mailsnail.dev/terms · Support: hello@mailsnail.dev

## License

MIT
