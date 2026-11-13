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

Call `verify_address`. It's free. The result's `deliverability` is one of:

- `deliverable`: USPS recognizes the address. Go on.
- `undeliverable`: USPS doesn't recognize it. Tell the user the `reason` and ask them to check the address. Go on only when they correct it or confirm it as written.
- `unknown`: the check couldn't run just now. Go on; the preview runs the same check again.

MailSnail doesn't rewrite addresses. The letter is addressed exactly as the user gave it.

## 4. Preview, then show the proof and price

Call `preview_letter` with `to`, `from` and `body_text` (or `file_url`). For certified mail, also pass `extra_service`; see the certified-mail skill. Leave `color` and `double_sided` at their defaults (black and white, two-sided) unless the user asks otherwise.

Previewing is free. Give the user these from the result:

- `proof_url`: a PDF of exactly what will print. Ask them to open it.
- `to_deliverability`: the USPS check on the recipient's address, read as in step 3.
- The exact price, which depends on how the user pays:
  - `amount_cents` is the price from a MailSnail balance.
  - `pay_per_letter_cents` is the price of paying for just this one letter by card. It's a little higher because that one payment carries the whole card fee.

  If `get_balance` shows a balance that covers the letter, quote `amount_cents`. Otherwise quote `pay_per_letter_cents`, and mention that adding funds to a balance brings each letter down to `amount_cents`.

## 5. Wait for a clear yes

Ask whether to send it at that price. Only a clear go-ahead after the user has seen the proof and price counts as approval. Approving the wording earlier does not.

If they want changes, edit the text and call `preview_letter` again. Each preview returns a new `draft_id`; use the latest one.

A draft expires 30 minutes after its preview (`expires_at`). If the user comes back later than that, preview again and get approval again.

When mailing several letters, preview each one. Then get approval for the whole batch with the number of letters and the total price stated.

## 6. Send

Call `send_letter` with only the approved `draft_id`. It mails exactly that proof. Don't send `to`, `from` or `body_text` again.

Read the result's `message` every time: it says what happened to the letter and to the money. These are the cases:

- **Sent.** The result has a `receipt_token` and `amount_charged_cents`. Go to step 7.
- **Payment needed (`payment_required`).** Nothing was charged or mailed. The result has links for the user to open:
  - `pay_url`: a MailSnail page where they pay for just this letter by card. No card is saved. Offer this first.
  - `setup_url`: a Stripe page where they add funds to a MailSnail balance instead, which makes each letter a little cheaper. Offer it to someone who expects to send more mail.

  MailSnail never sees the card number. After the user has paid, call `send_letter` again with the same `draft_id`.
- **The draft expired or is unknown (`draft_not_found`).** Preview again and get approval again.
- **You can't tell whether a send went through,** for example after a timeout. Call `send_letter` again with the same `draft_id`. A `draft_id` is only ever mailed once, so a retry returns the original result instead of mailing a second letter.
- **`send_in_progress_or_unconfirmed`.** An earlier call for this draft hasn't finished. Don't preview a new copy: a new draft could mail the letter twice. Wait a minute and call `send_letter` again with the same `draft_id`. If the answer stays the same, give the user hello@mailsnail.dev.
- **The printer didn't accept the letter** (an error that starts with `mail_failed`). Nothing was mailed, and the `message` says where the money went, normally back to the user's balance or card. To try again, make a new preview and get approval for it.
- **`mail_submission_unconfirmed`.** MailSnail couldn't confirm whether the printer took the letter. The payment is on hold and is never taken twice. Don't send this letter again. Tell the user that MailSnail checks the case by hand and either confirms the mailing or returns the money within two business days, and give them hello@mailsnail.dev and the `provider_job_id` from the result.

## 7. Confirm

Tell the user that the letter was sent and what it cost. Give them its `receipt_token` and ask them to keep it: it's the only way to check the letter's status later (see the track-mail skill).

## Balance and payment

Nobody has to add funds before sending: a send that the balance can't cover returns the payment links in step 6.

- `get_balance` shows the balance, whether a card is saved, and the auto-reload settings.
- `add_payment_method` returns a Stripe link (`setup_url`) for adding funds ahead of time. By default it's a one-time payment of $25, and the card isn't saved. Pass `amount_cents` for another amount, from $10 to $500.
  - Pass `auto_reload: true` only if the user asks for automatic reloads. The Stripe page then also saves the card and shows the reload terms the user agrees to.
  - When a card is already saved, the result also includes a link for updating the card and viewing receipts.
- `turn_off_auto_reload` stops automatic charges. Use it whenever the user asks.

None of these charges anything. There is no tool that charges a card on demand. Money moves only on a payment page the user opens, or by the auto-reload the user agreed to on Stripe's page.

## Prices

MailSnail prices mail at its own cost. The preview always shows the exact price, which is what the user pays. Extra pages and color cost a little more. These are the one-page prices:

| Service | From a balance | One letter by card |
|---|---|---|
| First-class letter | $1.21 | $1.51 |
| Certified Mail | $8.61 | $8.83 |
| Certified Mail with an electronic return receipt | $11.64 | $11.83 |
| Certified Mail with the physical green-card return receipt | $14.27 | $14.42 |

## Don't

- Don't send anything the user hasn't approved after seeing the proof and price.
- Don't invent, complete or "fix" an address without telling the user.
- Don't mail threats, harassment, or anything meant to deceive or defraud the recipient. MailSnail's terms prohibit it.
