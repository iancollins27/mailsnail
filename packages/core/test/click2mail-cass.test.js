// Count shapes below match what Click2Mail returned from a live account on
// 2026-11-10 for a real address and for a made-up one.
import test from "node:test";
import assert from "node:assert/strict";
import { Click2MailProvider, cassDeliverability } from "../src/providers/click2mail.js";

const list = (c) =>
  `<addressList><id>1</id><status>3</status><description>CASS Standardized</description>` +
  `<total>1</total><standard>${c.standard ?? 0}</standard><nonstandard>${c.nonstandard ?? 0}</nonstandard>` +
  `<international>${c.international ?? 0}</international><noService>${c.noService ?? 0}</noService>` +
  `<nonmailable>${c.nonmailable ?? 0}</nonmailable></addressList>`;

test("an address USPS matched is deliverable", () => {
  assert.deepEqual(cassDeliverability(list({ standard: 1 })), { deliverability: "deliverable" });
});

test("an address USPS could not match is undeliverable, with a reason", () => {
  const r = cassDeliverability(list({ nonstandard: 1 }));
  assert.equal(r.deliverability, "undeliverable");
  assert.match(r.reason, /does not recognize/);
});

test("nonmailable and no-service addresses are undeliverable", () => {
  assert.equal(cassDeliverability(list({ nonmailable: 1 })).deliverability, "undeliverable");
  assert.equal(cassDeliverability(list({ noService: 1 })).deliverability, "undeliverable");
});

test("a finished list with no counts is unknown, never deliverable", () => {
  assert.equal(cassDeliverability("<addressList><status>3</status></addressList>").deliverability, "unknown");
});

test("verifyAddress reports the CASS outcome, not just that CASS finished", async () => {
  const p = Object.create(Click2MailProvider.prototype);
  p._createAddressList = async () => ({ id: "7" });
  p._waitForCass = async () => ({ status: "3", description: "CASS Standardized", raw: list({ nonstandard: 1 }) });
  const r = await p.verifyAddress({ address_line1: "99999 Nowhere Blvd" });
  assert.equal(r.deliverability, "undeliverable");
  assert.equal(r.normalized, null);
});
