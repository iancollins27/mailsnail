---
name: send-letter
description: Mail a real paper letter through USPS with MailSnail. Use when the user asks to mail, post, or send a letter, note, or notice to a US street address, or wants a letter they wrote with the agent printed and delivered. For notices that need proof of mailing or delivery, also use the certified-mail skill.
---

# Send a letter with MailSnail

Mailing a letter costs the user money and cannot be undone once it is mailed. Follow these steps in order. The `send_letter` tool charges nothing itself: it returns a page where the user pays by card, and the letter is mailed when that payment completes. Still, call it only once the user has approved the proof and the price.

## Before you start

This skill uses the `mailsnail` server's tools: `verify_address`, `preview_letter`, `send_letter` and `get_letter`. The server needs no account and no sign-in. If the tools are not available, the user may need to enable the plugin (`hermes plugins enable mailsnail`) and start a new session. Using it is free; the user pays only for the letters they mail.

## 1. Get the addresses

You need two complete US addresses: the recipient's and the sender's. For each one, get the name, street address, city, two-letter state code and ZIP code. MailSnail only mails to US addresses.

- Ask for anything that is missing. Never guess or fill in an address.
- The sender's address prints as the return address. Undeliverable mail comes back there, and so does a certified-mail green card.

## 2. Write the letter

If the user has not written the letter, draft it with them and agree on the text before you preview it.

Pass the text as `body_text`. MailSnail lays it out on US letter paper:

- Today's date prints at the top right automatically, so do not add a date line.
- The recipient's address prints on a separate cover page, so do not add an address block.
- Start with the greeting, such as "Dear Ms. Rivera,".
- End with a closing and the sender's full name.

Plain text only, up to 20,000 characters (about six pages). Each extra page adds to the cost, so keep letters tight.

## 3. Check the recipient's address

Call `verify_address`. It is free. The result's `deliverability` is one of:

- `deliverable`: USPS recognizes the address. Go on.
- `undeliverable`: USPS does not recognize it. Tell the user the `reason` and ask them to check the address. Go on only when they correct it or confirm it as written.
- `unknown`: the check could not run just now. Go on; the preview runs the same check again.

MailSnail does not rewrite addresses. The letter is addressed exactly as the user gave it.

## 4. Preview, then show the proof and price

Call `preview_letter` with `to`, `from` and `body_text`. For certified mail, also pass `extra_service`; see the certified-mail skill. Leave `color` and `double_sided` at their defaults (black and white, two-sided) unless the user asks otherwise.

Previewing is free. Give the user these from the result:

- `proof_url`: a PDF of exactly what will print. Ask them to open it. The link works for half an hour.
- `to_deliverability`: the USPS check on the recipient's address, read as in step 3.
- `price_cents`: the exact price of this letter, paid by card. Quote it in dollars.

## 5. Wait for a clear yes

Ask whether to mail it at that price. Only a clear go-ahead after the user has seen the proof and price counts as approval. Approving the wording earlier does not.

If they want changes, edit the text and call `preview_letter` again. Each preview returns a new `draft_id`; use the latest one.

A draft can be paid for until `draft_valid_until`. If the user comes back later than that, preview again and get approval again.

When mailing several letters, preview each one and get approval for each.

## 6. Hand over the payment page

Call `send_letter` with only the approved `draft_id`. It names exactly that proof at exactly that price.

The result has `pay_url`: a MailSnail page where the user pays for just this letter by card, on a Stripe-hosted checkout. No account is created and no card is saved. Give the user that link. The letter is mailed when the payment completes, and that step is theirs alone.

Read the result's `message` every time. Other cases:

- **`draft_not_found`.** Pass the `draft_id` exactly as `preview_letter` returned it, or preview again.
- **`draft_expired`.** The proof was not paid for in time. Nothing was charged. Preview again and get approval again.
- **`web_orders_paused`.** Paying this way is paused for now. Nothing was charged. Tell the user, and give them https://mailsnail.dev/setup for the other ways to use MailSnail.

## 7. Confirm, and only when it is true

After the user says they have paid, call `get_letter` with the same `draft_id`. Say a letter was mailed only once `get_letter` says so; before that, say it is awaiting payment. Give the user the `status_page` link from the result, where they can see the same status later (see the track-mail skill).

## Prices

MailSnail prices mail at its own cost. The preview always shows the exact price, which is what the user pays. Extra pages and color cost a little more. One-page prices, paid by card:

| Service | Price |
|---|---|
| First-class letter | $1.51 |
| Certified Mail | $8.83 |
| Certified Mail with an electronic return receipt | $11.83 |
| Certified Mail with the physical green-card return receipt | $14.42 |

Someone who mails often can open a MailSnail account instead, with a prepaid balance that makes each letter a little cheaper: https://mailsnail.dev/setup?utm_source=hermes has the options.

## Rules

- Nothing is mailed that the user has not approved after seeing the proof and price.
- Never invent, complete or "fix" an address without telling the user.
- Never mail threats, harassment, or anything meant to deceive or defraud the recipient. MailSnail's terms prohibit it.
