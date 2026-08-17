// Every certified variant must be recognised as certified by every provider.
//
// Missing one is silent: nothing errors, the piece is just mailed as an ordinary
// untracked first-class letter. That is how `certified_return_receipt_electronic`
// — sold by the managed API — would have been mailed by self-hosted BYO setups if
// this drift had shipped, and it is the same shape as the `registered` bug, where
// an advertised service was billed as plain mail and mailed without tracking.
//
// The assertion is on the mailClass actually sent to Click2Mail, not on a private
// helper, so it keeps working if the internals are refactored.
//
// If mail-api adds another extra_service, add it to SELLABLE and fix what breaks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Click2MailProvider } from "../src/providers/click2mail.js";
import { DirectMailManagerProvider } from "../src/providers/directmailmanager.js";

const SELLABLE = [
  "certified",
  "certified_return_receipt",
  "certified_return_receipt_electronic",
];

const addr = {
  name: "Test Recipient",
  address_line1: "1 Main St",
  address_city: "Brooklyn",
  address_state: "NY",
  address_zip: "11201",
};

const xml = (s) => ({ ok: true, status: 200, text: async () => s });

/**
 * Run createDraft against a stubbed Click2Mail and return the job-creation
 * parameters. NOTE: the provider calls the GLOBAL fetch, not an injected one.
 */
async function jobParamsFor(extra_service) {
  const realFetch = globalThis.fetch;
  let jobBody = null;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/addresses")) {
      return xml(
        "<address><address1>1 MAIN ST</address1><city>BROOKLYN</city>" +
          "<state>NY</state><zip>11201</zip></address>",
      );
    }
    if (u.includes("/addressLists/")) {
      return xml(
        "<addressList><id>202</id><status>3</status>" +
          "<statusDescription>CASS Standardized</statusDescription></addressList>",
      );
    }
    if (u.endsWith("/addressLists")) return xml("<addressList><id>202</id></addressList>");
    if (u.endsWith("/documents")) return xml("<document><id>101</id></document>");
    if (u.endsWith("/jobs")) {
      jobBody = String(init?.body ?? "");
      return xml("<job><id>303</id><status>Ready</status></job>");
    }
    throw new Error(`unexpected Click2Mail call: ${u}`);
  };

  try {
    const provider = new Click2MailProvider({ username: "u", password: "p" });
    await provider.createDraft({
      to: addr,
      pdf_buffer: Buffer.from("%PDF-1.4 fake"),
      extra_service,
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(jobBody, `no job was created for ${extra_service ?? "(plain)"}`);
  return new URLSearchParams(jobBody);
}

test("Click2Mail orders Certified Mail for every certified variant", async () => {
  for (const svc of SELLABLE) {
    const p = await jobParamsFor(svc);
    assert.equal(
      p.get("mailClass"),
      "Certified Mail",
      `${svc} must be mailed as Certified Mail, not "${p.get("mailClass")}"`,
    );
    assert.equal(
      p.get("documentClass"),
      "Certified Letter 8.5 x 11",
      `${svc} must upload under the certified document class`,
    );
  }
});

test("a plain letter is still mailed First Class (the control)", async () => {
  const p = await jobParamsFor(undefined);
  assert.equal(p.get("mailClass"), "First Class");
  assert.equal(p.get("documentClass"), "Letter 8.5 x 11");
});

// DMM does First-Class only. It must REFUSE every certified variant so the
// failover chain hands the piece to a provider that can actually do it —
// quietly accepting one would mail an untracked letter and charge for proof.
test("DirectMailManager refuses every certified variant so failover can take it", async () => {
  const provider = new DirectMailManagerProvider({
    apiKey: "k",
    fetchImpl: async () => {
      throw new Error("DMM must not attempt a certified send");
    },
  });

  for (const svc of SELLABLE) {
    await assert.rejects(
      () =>
        provider.sendLetter({
          to: addr,
          from: addr,
          file_url: "https://example.com/a.pdf",
          extra_service: svc,
        }),
      (err) => {
        assert.match(
          String(err?.code ?? err?.name ?? err?.message),
          /NotSupported|not_supported|unsupported/i,
          `${svc} must be refused as unsupported, got: ${err?.message}`,
        );
        return true;
      },
      `${svc} must be refused by DMM`,
    );
  }
});
