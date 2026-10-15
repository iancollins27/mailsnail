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

- Once the letter is with USPS, `tracking` shows its latest scan (`status`, `status_time`, `status_location`). Before that, `tracking.available` is false; that's normal for the first 1-2 business days. Tracking updates once a day.
- For a certified letter, give the user `tracking.tracking_number` (the USPS Certified Mail number) and `tracking.usps_tracking_url`, where they can see every scan.
- With an electronic return receipt, `return_receipt.url` is the recipient's signature PDF. It works only after delivery, sometimes a few days later. With a green-card receipt, the signed card is mailed back to the sender's address and isn't online.
- Don't promise a delivery date. USPS First-Class Mail usually takes a few business days, but MailSnail can't guarantee it.

## Cancel a letter

If the user wants to stop a letter, call `cancel_letter` with its `receipt_token`. Confirm with them first: a cancelled letter is not mailed. It works only before the printer starts, usually about a day after sending, and only for letters paid from their MailSnail balance. The full price goes back to the balance. If the result is `too_late_to_cancel`, the letter is already being printed and will be mailed.

## Balance

For "how much do I have left?", call `get_balance`. It's free, and it shows the balance, whether a card is saved, and the auto-reload settings.

To add funds, call `add_payment_method` and give the user the Stripe link it returns. By default it's a one-time payment.

To stop automatic reloads, call `turn_off_auto_reload`.
