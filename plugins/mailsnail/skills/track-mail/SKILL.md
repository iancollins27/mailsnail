---
name: track-mail
description: Check the status of a letter or postcard sent with MailSnail. Use when the user asks whether their mail was printed, mailed, or delivered, asks for certified-mail tracking, or wants to check their MailSnail balance.
---

# Track mail sent with MailSnail

## Look up a piece

Status lookups are free.

- For a letter, call `get_letter` with its `receipt_token`.
- For a postcard, call `get_postcard` with its `receipt_token`.

Each send's result includes a `receipt_token`. Use that, not the `id` field: `id` is the printer's job number and won't resolve.

If the user doesn't have the `receipt_token`, look for it earlier in this conversation. No tool lists past mail. If it isn't here, the user can email hello@mailsnail.dev with the recipient's name and the date sent.

## Explain the result

Give the status in plain words: for example, received by the printer, printed, or handed to USPS.

- Don't promise a delivery date. USPS First-Class Mail usually takes a few business days, but MailSnail can't guarantee it.
- For a certified letter, the status shows that it entered the mail. With a return receipt, proof of delivery comes from the recipient's signature: a PDF for an electronic receipt, or the green card mailed back to the sender's address.

## Balance

For "how much do I have left?", call `get_balance`. It's free, and it shows the balance, whether a card is saved, and the auto-reload settings.

If the user wants to add or change a card, call `add_payment_method` and give them the Stripe link it returns.
