// The client half of the mail-api status-enumeration fix.
//
// The managed service used to look up letter status by the raw Click2Mail job id.
// Those ids are sequential integers and the route needs no credentials (the anonymous
// per-piece rail has no account and still has to poll), so anyone could count upward
// and read any customer's mail status. It now issues an unguessable `receipt_token`
// at send time and accepts only that.
//
// This client talks to THREE backends through the same methods, and only one of them
// changed, so the tests below pin both halves: the managed token flow works, and the
// self-hosted gateway's raw-id flow is untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayProvider } from "../src/providers/gateway.js";

const ADDR = {
  name: "A",
  address_line1: "1 Main",
  address_city: "Oakland",
  address_state: "CA",
  address_zip: "94601",
};
const LETTER = { to: ADDR, from: ADDR, body_text: "hi" };

const RECEIPT = `37403092.${"a1b2c3d4".repeat(6)}`; // <jobId>.<48 hex>

/** Records the paths requested so we can assert what the client actually asked for. */
function recordingFetch({ status = 200, body = {} } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET" });
    return {
      status,
      headers: { get: () => undefined },
      text: async () => JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

function provider(fetchImpl) {
  return new GatewayProvider({
    baseUrl: "https://api.mailsnail.dev",
    name: "managed",
    fetch: fetchImpl,
    env: {},
  });
}

// ── The capability must reach the caller ─────────────────────────────────────

test("sendLetter surfaces receipt_token and status_url at the TOP level", async () => {
  const f = recordingFetch({
    body: {
      id: "37403092",
      status: "queued",
      receipt_token: RECEIPT,
      status_url: `https://api.mailsnail.dev/v1/letters/${RECEIPT}`,
    },
  });
  const out = await provider(f).sendLetter(LETTER);

  // Top level, not buried in `raw`: on the managed service this is the only way to
  // read the piece later, and it cannot be recovered if the caller drops it.
  assert.equal(out.receipt_token, RECEIPT);
  assert.equal(out.status_url, `https://api.mailsnail.dev/v1/letters/${RECEIPT}`);
  assert.equal(out.id, "37403092", "the provider job id is still reported");
});

test("sendPostcard surfaces the capability too", async () => {
  const f = recordingFetch({
    body: { id: "37403092", status: "queued", receipt_token: RECEIPT, status_url: "u" },
  });
  const out = await provider(f).sendPostcard({ to: ADDR, from: ADDR, front_url: "https://x/f.pdf" });
  assert.equal(out.receipt_token, RECEIPT);
  assert.equal(out.status_url, "u");
});

test("a backend that issues no receipt (self-hosted gateway) still returns a clean result", async () => {
  const f = recordingFetch({ body: { id: "37403092", status: "queued" } });
  const out = await provider(f).sendLetter(LETTER);

  assert.equal(out.id, "37403092");
  assert.equal(out.receipt_token, undefined);
  assert.equal(out.status_url, undefined);
  assert.equal(out.status, "queued", "the rest of the response is unaffected");
});

// ── Lookup works for both backends ───────────────────────────────────────────

test("getLetter passes a receipt token through verbatim", async () => {
  const f = recordingFetch({ body: { status: "delivered" } });
  await provider(f).getLetter(RECEIPT);

  assert.equal(f.calls.length, 1);
  assert.ok(
    f.calls[0].url.endsWith(`/v1/letters/${encodeURIComponent(RECEIPT)}`),
    `unexpected path: ${f.calls[0].url}`,
  );
});

test("getLetter still accepts a RAW job id — self-hosted gateways were not changed", async () => {
  const f = recordingFetch({ body: { status: "delivered" } });
  await provider(f).getLetter("37403092");

  assert.ok(f.calls[0].url.endsWith("/v1/letters/37403092"));
});

test("getPostcard hits the postcard route, because receipts are namespaced per kind", async () => {
  const f = recordingFetch({ body: { status: "delivered" } });
  await provider(f).getPostcard(RECEIPT);

  assert.ok(
    f.calls[0].url.endsWith(`/v1/postcards/${encodeURIComponent(RECEIPT)}`),
    `a postcard receipt must not be looked up on the letters route: ${f.calls[0].url}`,
  );
});

// ── The 404 has to be self-explanatory ───────────────────────────────────────

test("the server's explanatory 404 message survives instead of collapsing to the bare code", async () => {
  // What the managed service actually returns when someone passes a raw job id.
  const f = recordingFetch({
    status: 404,
    body: {
      error: "letter_not_found",
      message:
        "Unknown letter. Look it up with the status_url (or receipt_token) returned " +
        "when the letter was sent — the provider job id is not a lookup key.",
    },
  });

  const err = await provider(f)
    .getLetter("37403092")
    .then(
      () => null,
      (e) => e,
    );

  assert.ok(err, "expected a rejection");
  // Without this the agent sees only "letter_not_found" and retries the same id
  // forever, because nothing tells it the id is the wrong KIND of value.
  assert.match(err.message, /receipt_token|status_url/);
  assert.equal(err.status, 404);
  assert.equal(err.body?.error, "letter_not_found", "structured body still available");
});

test("getPostcard carries the message through the same way", async () => {
  const f = recordingFetch({
    status: 404,
    body: { error: "postcard_not_found", message: "Unknown postcard. Use the status_url." },
  });
  const err = await provider(f)
    .getPostcard("37403092")
    .then(
      () => null,
      (e) => e,
    );
  assert.match(err.message, /status_url/);
});
