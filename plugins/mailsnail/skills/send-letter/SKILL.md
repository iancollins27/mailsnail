---
name: send-letter
description: Mail a real paper letter through USPS with MailSnail. Use when the user asks to mail, post, or send a letter, note, or document to a US street address, or wants a letter they wrote with Claude printed and delivered. For notices that need proof of mailing or delivery, also use the certified-mail skill.
---

# Send a letter with MailSnail

Sending mail costs the user money and can't be undone once it's mailed. Follow these steps in order, and never call `send_letter` without the user's explicit approval of the proof and price.

## 1. Get the addresses

You need two complete US addresses: the recipient's and the sender's. For each one, get the name, street address, city, two-letter state code and ZIP code. MailSnail only mails to US addresses.

- Ask for anything that's missing. Never guess or fill in an address.
- The sender's address prints as the return address. Undeliverable mail comes back there, and so does a certified-mail green card.

## 2. Write the letter

If the user hasn't written the letter, draft it with them and agree on the text before you preview it.

Pass the text as `body_text`. MailSnail lays it out on US letter paper:

- Today's date prints at the top right automatically, so don't add a date line.
- The recipient's address prints on a separate cover page, so don't add an address block.
- Start with the greeting, such as "Dear Ms. Rivera,".
- End with a closing and the sender's full name.

Plain text only, up to 20,000 characters (about six pages). Each extra page adds to the cost, so keep letters tight.

If the user already has a finished letter-size PDF at a public URL, pass it as `file_url` instead of `body_text`. Don't pass both.

## 3. Check the recipient's address

Call `verify_address`. It's free.

- If the result corrects the address, show the user what changed.
- If it says the address can't be delivered, stop and ask the user before going further.

## 4. Preview, then show the proof and price

Call `preview_letter` with `to`, `from` and `body_text` (or `file_url`). For certified mail, also pass `extra_service`; see the certified-mail skill. Leave `color` and `double_sided` at their defaults (black and white, two-sided) unless the user asks otherwise.

Previewing is free. The result has three things to give the user:

- `proof_url`: a PDF of exactly what will print. Ask them to open it.
- The verified recipient address.
- The exact price.

## 5. Wait for a clear yes

Ask whether to send it at that price. Only a clear go-ahead after the user has seen the proof and price counts as approval. Approving the wording earlier does not.

If they want changes, edit the text and call `preview_letter` again. Each preview returns a new `draft_id`; use the latest one.

When mailing several letters, preview each one. Then get approval for the whole batch with the number of letters and the total price stated.

## 6. Send

Call `send_letter` with only the approved `draft_id`. It mails exactly that proof at the quoted price. Don't send `to`, `from` or `body_text` again.

- **The result has `setup_url`:** the balance doesn't cover the letter. Give the user the link. It's a Stripe-hosted page where they fund a prepaid balance; MailSnail never sees the card number. After they finish, call `send_letter` again with the same `draft_id`.
- **The result says the draft expired or is unknown:** preview again and get approval again.
- **You can't tell whether a send went through,** for example after a timeout: call `send_letter` again with the same `draft_id`. A `draft_id` is only ever mailed once, so a retry returns the original result instead of mailing a second letter.
- **The result is `send_in_progress_or_unconfirmed`:** don't preview a new copy and don't send again. A new draft could mail the letter twice. Tell the user the send needs to be confirmed, and give them hello@mailsnail.dev.

## 7. Confirm

Tell the user that the letter was sent and what it cost. Give them its `receipt_token` and ask them to keep it: it's the only way to check the letter's status later (see the track-mail skill).

## Balance and payment

- `get_balance` shows the balance, whether a card is saved, and the auto-reload settings.
- `add_payment_method` returns a Stripe link to add funds. By default it's a one-time payment, and the card isn't saved.
  - Pass `auto_reload: true` only if the user asks for automatic reloads. The Stripe page then also saves the card and shows the reload terms the user agrees to.
  - When a card is already saved, the result also includes a link for updating the card and viewing receipts.
- `turn_off_auto_reload` stops automatic charges. Use it whenever the user asks.

None of these charges anything. There is no tool that charges a card on demand. Money is added only on Stripe's own pages, or by the auto-reload the user agreed to there.

## Prices

MailSnail prices mail at its own cost. The preview always shows the exact price, which is what the user pays. Extra pages and color cost a little more. These are the one-page prices:

| Service | Price |
|---|---|
| First-class letter | $1.21 |
| Certified Mail | $8.61 |
| Certified Mail with an electronic return receipt | $11.64 |
| Certified Mail with the physical green-card return receipt | $14.27 |

## Don't

- Don't send anything the user hasn't approved after seeing the proof and price.
- Don't invent, complete or "fix" an address without telling the user.
- Don't mail threats, harassment, or anything meant to deceive or defraud the recipient. MailSnail's terms prohibit it.
