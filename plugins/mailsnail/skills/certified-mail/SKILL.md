---
name: certified-mail
description: Send a letter by USPS Certified Mail, with or without a return receipt, when the user needs proof a letter was mailed or delivered. Use for notices to a landlord or tenant, demand letters, contract cancellations and terminations, disputes, and any notice a lease, contract, or law says must go by certified mail.
---

# Certified mail with MailSnail

Certified mail gives the user evidence that a letter was mailed or delivered. Writing and sending works exactly as in the send-letter skill. This skill covers the two things that differ: choosing the service level, and writing a notice that holds up.

## Choose the service level

Set `extra_service` on `preview_letter`, so the proof and price already include it.

| `extra_service` | What the sender gets | Price |
|---|---|---|
| `certified` | USPS tracking and proof of mailing | $8.61 |
| `certified_return_receipt_electronic` | Also a PDF of the recipient's delivery signature | $11.64 |
| `certified_return_receipt` | Also the physical green card (PS Form 3811), signed on delivery and mailed back to the sender's address | $14.27 |

Prices are for one page; the preview shows the exact price.

**Ask what the lease, contract or law says before choosing.** If it names a delivery method, match it exactly. "Certified mail, return receipt requested" asks for a return receipt, and the physical green card is the traditional form.

If the user isn't sure:
- Proof of delivery is stronger than proof of mailing.
- The green card is the most widely recognized.
- Don't present your choice as legal advice. For a high-stakes notice, such as an eviction, a lawsuit deadline or a large sum of money, suggest the user confirm the requirements with a lawyer.

MailSnail doesn't offer USPS Registered Mail.

## Write the notice

A notice that works is specific and dated. Include:

- **Who and what it's about.** Name both parties and identify the agreement: the lease, contract or account, its date, and the property address or account number.
- **What is happening.** State the action plainly: "I am ending my lease," "I am requesting the return of my $1,800 security deposit," "I am cancelling my membership."
- **Exact dates.** Use calendar dates such as "by November 15, 2026," not "within 30 days." Count from when the recipient will likely receive it, not from today. Certified mail usually takes several days.
- **The relevant term,** if the user knows it: "as required by section 12 of the lease."
- **How to respond:** a phone number, an email address or a mailing address.
- **A factual tone.** State the facts and any lawful next step ("If I don't receive payment by …, I will file in small claims court"). No insults and no threats.
- **The sender's full printed name** at the end.

Show the user the full text and have them confirm the facts, especially names, dates and amounts, before you preview it.

## After sending

Tell the user:

- Their `receipt_token`, for checking the status with `get_letter` (see the track-mail skill).
- To save the proof PDF from `proof_url` now, as their copy of exactly what was mailed.
- With `certified_return_receipt`, the signed green card arrives by mail at the sender's address after delivery.
