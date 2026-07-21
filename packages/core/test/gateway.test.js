import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayProvider } from "../src/providers/gateway.js";
import { ERROR_CODES } from "../src/errors.js";

const LETTER = {
  to: { name: "A", address_line1: "1 Main", address_city: "Oakland", address_state: "CA", address_zip: "94601" },
  from: { name: "B", address_line1: "2 Main", address_city: "Oakland", address_state: "CA", address_zip: "94601" },
  body_text: "hi",
};

/** A fetch that answers with whatever the test wants, without any network. */
function fetchReturning({ status, body, headers = {} }) {
  return async () => ({
    status,
    headers: { get: (k) => headers[k.toLowerCase()] },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function fetchThrowing(code, message = "fetch failed") {
  return async () => {
    throw Object.assign(new TypeError(message), {
      cause: Object.assign(new Error(code), { code }),
    });
  };
}

function provider(fetchImpl, env = {}) {
  return new GatewayProvider({
    baseUrl: "https://api.mailsnail.dev",
    name: "managed",
    fetch: fetchImpl,
    env,
  });
}

test("preview: a proxy's bodyless 403 is not reported as `gateway 403`", async () => {
  const p = provider(fetchReturning({ status: 403, body: "" }));
  const err = await p.preview(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, "expected a rejection");
  assert.notEqual(err.message, "gateway 403");
  assert.equal(err.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.equal(err.status, 403);
  assert.match(err.message, /api\.mailsnail\.dev:443/);
  assert.match(err.hint, /allowlist|proxy/i);
});

test("preview: the gateway's own JSON error still surfaces verbatim", async () => {
  const p = provider(
    fetchReturning({ status: 422, body: { error: "invalid_address", message: "ZIP is not deliverable" } }),
  );
  const err = await p.preview(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.message, "ZIP is not deliverable");
  assert.equal(err.code, undefined, "a real gateway rejection carries no transport code");
});

test("send: a bare 403 is named as a block but still does NOT fail over", async () => {
  const p = provider(fetchReturning({ status: 403, body: "<html>denied</html>" }));
  const err = await p.sendLetter(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.equal(
    err.safeToRetry,
    false,
    "a 403 can also come from a filter in front of an origin that already saw the send",
  );
});

test("send: a 407 never reached the origin, so it may fail over", async () => {
  const p = provider(fetchReturning({ status: 407, body: "" }));
  const err = await p.sendLetter(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.equal(err.safeToRetry, true, "the proxy refused before tunneling anything");
});

test("send: an ambiguous reset does not fail over", async () => {
  const p = provider(fetchThrowing("ECONNRESET"));
  const err = await p.sendLetter(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, ERROR_CODES.UNREACHABLE);
  assert.equal(err.safeToRetry, false, "the gateway may have received it — a duplicate letter is worse");
  assert.match(err.message, /unknowable|ambiguous/);
});

test("send: a bodyless 502 stays unsafe to retry", async () => {
  const p = provider(fetchReturning({ status: 502, body: "<html>bad gateway</html>" }));
  const err = await p.sendLetter(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, ERROR_CODES.GATEWAY_UNAVAILABLE);
  assert.equal(err.safeToRetry, false, "a 502 may have been processed upstream");
});

test("send: 402 payment challenges are untouched by the interception check", async () => {
  const p = provider(
    fetchReturning({
      status: 402,
      body: {
        payment_request: { amount: 150, currency: "usd", methods: ["stripe.spt"], idempotency_key: "k" },
      },
    }),
  );
  const err = await p.sendLetter(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.status, 402);
  assert.equal(err.payment_required.amount_cents, 150);
  assert.equal(err.code, undefined);
});

test("a connect failure names the host and says nothing was sent", async () => {
  const p = provider(fetchThrowing("ECONNREFUSED"));
  const err = await p.preview(LETTER).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, ERROR_CODES.UNREACHABLE);
  assert.equal(err.safeToRetry, true, "the request never reached the gateway");
  assert.match(err.message, /api\.mailsnail\.dev:443/);
  assert.match(err.message, /Nothing was sent/);
});

test("407 anywhere in the API reads as a proxy, not as auth failure", async () => {
  const p = provider(
    fetchReturning({ status: 407, body: "", headers: { "proxy-authenticate": "Basic realm=corp" } }),
  );
  const err = await p.verifyAddress({ address_line1: "1 Main" }).then(
    () => null,
    (e) => e,
  );
  assert.equal(err.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.match(err.message, /proxy/i);
});

test("endpoints expose what to allowlist", () => {
  const p = provider(fetchReturning({ status: 200, body: { ok: true } }));
  assert.deepEqual(
    p.endpoints.map((e) => e.target),
    ["api.mailsnail.dev:443"],
  );
  assert.match(p.endpoints[0].url, /\/healthz$/);
});
