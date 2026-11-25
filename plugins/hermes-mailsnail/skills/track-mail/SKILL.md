---
name: track-mail
description: Check the status of a letter previewed and paid for with MailSnail. Use when the user asks whether their letter was paid for, printed, mailed, or delivered, or asks for certified-mail tracking.
---

# Track mail sent with MailSnail

## Look up a letter

Status lookups are free. Call `get_letter` with the letter's `draft_id`, the one `preview_letter` returned and `send_letter` was called with.

The server keeps no list of letters: the `draft_id` is the only way to find one. If the user does not have it, look for it earlier in this conversation. If it is not here, the payment page the user paid on shows the same status, and hello@mailsnail.dev can help with the recipient's name and the date.

## Explain the result

Give the status in plain words.

- `awaiting_payment`: the letter has not been paid for yet, so nothing has been mailed. The result's `pay_url` is where the user pays, until `pay_by`.
- Paid: the letter is with the printer, printed, or handed to USPS. Say it was mailed only once the status says so.
- Once the letter is with USPS, `tracking` shows its latest scan (`status`, `status_time`, `status_location`). Before that, `tracking.available` is false; that is normal for the first 1-2 business days. Tracking updates once a day.
- For a certified letter, give the user `tracking.tracking_number` (the USPS Certified Mail number) and `tracking.usps_tracking_url`, where they can see every scan.
- With an electronic return receipt, `return_receipt.url` is the recipient's signature PDF. It works only after delivery, sometimes a few days later. With a green-card receipt, the signed card is mailed back to the sender's address and is not online.
- `refunded`: the printer did not take the letter, and the payment went back to the card. Nothing was mailed. To try again, preview a new letter and get approval for it.
- Do not promise a delivery date. USPS First-Class Mail usually takes a few business days, but MailSnail cannot guarantee it.

## Stopping a letter

A paid letter cannot be cancelled from this server. If the user needs to stop one, they should write to hello@mailsnail.dev right away with the recipient's name and the date; a letter can be stopped only before the printer starts, usually about a day after payment.
