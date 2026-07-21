import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, formatDiagnosis } from "../src/doctor.js";
import { ERROR_CODES } from "../src/errors.js";

function fakeFetch(handler) {
  return async (url, init) => handler(url, init);
}

// Keep the suite hermetic: no real DNS, no real sockets.
const fakeDns = async () => ({ address: "203.0.113.1", family: 4 });

const jsonOk = fakeFetch(async () => ({
  status: 200,
  headers: { get: () => undefined },
  text: async () => JSON.stringify({ ok: true, mode: "LIVE" }),
}));

test("healthy managed gateway reports ok and what it reached", async () => {
  const report = await diagnose({
    env: { MAIL_PROVIDER: "managed" },
    fetchImpl: jsonOk,
    dnsLookup: fakeDns,
  });
  assert.equal(report.ok, true);
  assert.equal(report.provider.name, "managed");
  assert.equal(report.provider.api_key, "absent");
  assert.deepEqual(report.allowlist, ["api.mailsnail.dev:443"]);
  assert.match(report.summary, /^OK/);
});

test("an egress block is diagnosed as a block, with the host to allow", async () => {
  const report = await diagnose({
    env: { MAIL_PROVIDER: "managed" },
    fetchImpl: fakeFetch(async () => ({
      status: 403,
      headers: { get: () => undefined },
      text: async () => "<html>Access denied</html>",
    })),
    dnsLookup: fakeDns,
  });
  assert.equal(report.ok, false);
  const reach = report.checks.find((c) => c.name === "reach");
  assert.equal(reach.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.ok(report.next_steps.length > 0);
  assert.match(formatDiagnosis(report), /api\.mailsnail\.dev:443/);
});

test("a 200 that isn't JSON is caught as interception", async () => {
  const report = await diagnose({
    env: { MAIL_PROVIDER: "managed" },
    fetchImpl: fakeFetch(async () => ({
      status: 200,
      headers: { get: () => undefined },
      text: async () => "<html>Sign in to the guest wifi</html>",
    })),
    dnsLookup: fakeDns,
  });
  assert.equal(report.ok, false);
  assert.match(report.checks.find((c) => c.name === "reach").detail, /isn't JSON/);
});

test("a configured proxy is reported, and credentials never are", async () => {
  const report = await diagnose({
    env: { MAIL_PROVIDER: "managed", HTTPS_PROXY: "http://user:secret@proxy.corp:8080" },
    fetchImpl: jsonOk,
    dnsLookup: fakeDns,
  });
  const proxyCheck = report.checks.find((c) => c.name === "proxy");

  // Either outcome is correct — which one depends on whether the optional
  // `undici` peer is installed. Both must be stated plainly.
  if (proxyCheck.ok) {
    assert.match(proxyCheck.detail, /in use/);
  } else {
    assert.match(proxyCheck.detail, /nothing is routing through it/);
    assert.match(proxyCheck.hint, /NODE_USE_ENV_PROXY|undici/);
  }

  const rendered = formatDiagnosis(report);
  assert.ok(!rendered.includes("secret"), "proxy credentials must not be printed");
  assert.ok(!JSON.stringify(report).includes("secret"), "…nor end up in the JSON report");
});

test("NO_PROXY exemption is not treated as a problem", async () => {
  const report = await diagnose({
    env: {
      MAIL_PROVIDER: "managed",
      HTTPS_PROXY: "http://proxy.corp:8080",
      NO_PROXY: "mailsnail.dev",
    },
    fetchImpl: jsonOk,
    dnsLookup: fakeDns,
  });
  assert.equal(report.checks.find((c) => c.name === "proxy").ok, true);
  assert.equal(report.ok, true);
});

test("misconfiguration is reported without touching the network", async () => {
  let called = false;
  const report = await diagnose({
    env: { MAIL_PROVIDER: "gateway" }, // missing MAIL_API_BASE_URL
    fetchImpl: fakeFetch(async () => {
      called = true;
      throw new Error("should not be called");
    }),
    dnsLookup: fakeDns,
  });
  assert.equal(report.ok, false);
  assert.equal(called, false);
  assert.match(report.summary, /MAIL_API_BASE_URL/);
});

test("BYOK providers report their own hosts", async () => {
  const report = await diagnose({
    env: { MAIL_PROVIDERS: "click2mail,lob", CLICK2MAIL_USERNAME: "u", CLICK2MAIL_PASSWORD: "p", LOB_API_KEY: "test_x" },
    fetchImpl: fakeFetch(async () => ({
      status: 401,
      headers: { get: () => undefined },
      text: async () => JSON.stringify({ error: "unauthorized" }),
    })),
    dnsLookup: fakeDns,
  });
  assert.deepEqual(report.allowlist, ["rest.click2mail.com:443", "api.lob.com:443"]);
  // A 401 from a provider API still proves the host is reachable.
  assert.equal(report.ok, true);
});
