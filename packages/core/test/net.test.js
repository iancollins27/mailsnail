import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBlockedResponse,
  describeTransportError,
  detectProxy,
  noProxyMatches,
  redactUrl,
  targetOf,
} from "../src/net.js";
import { ERROR_CODES } from "../src/errors.js";

const GW = "https://api.mailsnail.dev/v1/preview";

function headers(map = {}) {
  return { get: (k) => map[k.toLowerCase()] };
}

test("targetOf names the host:port to allowlist", () => {
  assert.equal(targetOf("https://api.mailsnail.dev/v1/preview"), "api.mailsnail.dev:443");
  assert.equal(targetOf("http://localhost:8080"), "localhost:8080");
  assert.equal(targetOf("http://gw.internal"), "gw.internal:80");
});

test("proxy URLs are redacted before they reach an error message", () => {
  assert.equal(redactUrl("http://user:hunter2@proxy.corp:8080"), "http://***@proxy.corp:8080");
  assert.ok(!redactUrl("http://user:hunter2@proxy.corp:8080").includes("hunter2"));
});

test("NO_PROXY matches exact hosts, suffixes, and *", () => {
  assert.ok(noProxyMatches("api.mailsnail.dev", GW));
  assert.ok(noProxyMatches(".mailsnail.dev", GW));
  assert.ok(noProxyMatches("mailsnail.dev", GW));
  assert.ok(noProxyMatches("*", GW));
  assert.ok(noProxyMatches("foo.com, api.mailsnail.dev:443", GW));
  assert.ok(!noProxyMatches("api.mailsnail.dev:8080", GW));
  assert.ok(!noProxyMatches("evilmailsnail.dev", GW));
  assert.ok(!noProxyMatches("", GW));
});

test("detectProxy flags a proxy Node will silently ignore", () => {
  const p = detectProxy({ HTTPS_PROXY: "http://proxy.corp:8080" }, GW);
  assert.equal(p.configured, true);
  assert.equal(p.var, "HTTPS_PROXY");
  assert.equal(p.ignored, true, "Node's fetch ignores *_PROXY without NODE_USE_ENV_PROXY");

  const honored = detectProxy(
    { HTTPS_PROXY: "http://proxy.corp:8080", NODE_USE_ENV_PROXY: "1" },
    GW,
  );
  assert.equal(honored.ignored, false);

  const viaNodeOptions = detectProxy(
    { HTTPS_PROXY: "http://proxy.corp:8080", NODE_OPTIONS: "--use-env-proxy" },
    GW,
  );
  assert.equal(viaNodeOptions.ignored, false);

  // Scheme-matched, like undici's EnvHttpProxyAgent: HTTP_PROXY does not
  // govern an https:// URL, and vice versa.
  assert.equal(detectProxy({ HTTP_PROXY: "http://proxy.corp:8080" }, GW).configured, false);
  assert.equal(
    detectProxy({ HTTP_PROXY: "http://proxy.corp:8080" }, "http://gw.internal/v1").var,
    "HTTP_PROXY",
  );
  assert.equal(detectProxy({ ALL_PROXY: "http://proxy.corp:8080" }, GW).var, "ALL_PROXY");

  const exempt = detectProxy(
    { HTTPS_PROXY: "http://proxy.corp:8080", NO_PROXY: "mailsnail.dev" },
    GW,
  );
  assert.equal(exempt.bypassed, true);
  assert.equal(exempt.ignored, false);

  assert.equal(detectProxy({}, GW).configured, false);
});

test("a bodyless 403 is reported as an egress block, not an account rejection", () => {
  const c = classifyBlockedResponse({ status: 403, headers: headers(), body: "", url: GW });
  assert.equal(c.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.match(c.message, /api\.mailsnail\.dev:443/);
  assert.match(c.message, /not from the Mailsnail application/);
  assert.match(c.message, /network policy rather than your account/);
  assert.match(c.hint, /allowlist|proxy/i);
});

test("an HTML 403 from a filtering proxy is also an egress block", () => {
  const c = classifyBlockedResponse({
    status: 403,
    headers: headers({ via: "1.1 squid" }),
    body: "<html>Blocked by policy</html>",
    url: GW,
  });
  assert.equal(c.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.match(c.message, /via: 1\.1 squid/);
});

test("a gateway's own JSON 403 is left alone", () => {
  const c = classifyBlockedResponse({
    status: 403,
    headers: headers({ "content-type": "application/json" }),
    body: { error: "account_suspended" },
    url: GW,
  });
  assert.equal(c, null, "the gateway answered for itself — surface its message unchanged");
});

test("407 is always a proxy, even with a JSON body", () => {
  const c = classifyBlockedResponse({
    status: 407,
    headers: headers({ "proxy-authenticate": "Basic realm=corp" }),
    body: { error: "whatever" },
    url: GW,
  });
  assert.equal(c.code, ERROR_CODES.EGRESS_BLOCKED);
  assert.match(c.message, /Basic realm=corp/);
});

test("a bodyless 5xx is unavailable, not blamed on the firewall", () => {
  const c = classifyBlockedResponse({ status: 502, headers: headers(), body: "", url: GW });
  assert.equal(c.code, ERROR_CODES.GATEWAY_UNAVAILABLE);
  assert.match(c.message, /either the gateway is down or a hop in between/);
});

test("ordinary gateway errors are not reclassified", () => {
  for (const status of [400, 404, 422, 500]) {
    assert.equal(
      classifyBlockedResponse({ status, headers: headers(), body: null, url: GW }),
      null,
      `status ${status} should pass through`,
    );
  }
});

test("connect failures name the host:port to allow", () => {
  const err = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
  const d = describeTransportError({ url: GW, error: err, env: {} });
  assert.equal(d.code, ERROR_CODES.UNREACHABLE);
  assert.match(d.message, /refused/i);
  assert.match(d.message, /api\.mailsnail\.dev:443/);
  assert.match(d.message, /Nothing was sent/);
  assert.match(d.message, /mailsnail doctor/);
});

test("DNS failures say the request never left the machine", () => {
  const err = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
  });
  const d = describeTransportError({ url: GW, error: err, env: {} });
  assert.match(d.message, /DNS lookup for api\.mailsnail\.dev failed/);
  assert.match(d.message, /never left this machine/);
});

test("a configured-but-ignored proxy becomes the hint", () => {
  const err = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
  });
  const d = describeTransportError({
    url: GW,
    error: err,
    env: { HTTPS_PROXY: "http://user:secret@proxy.corp:8080" },
  });
  assert.match(d.message, /timed out/);
  assert.match(d.hint, /NODE_USE_ENV_PROXY/);
  assert.ok(!d.message.includes("secret"), "proxy credentials must not leak into errors");
});

test("only pre-transmission failures are marked safe to fail over", () => {
  const describe = (code) =>
    describeTransportError({
      url: GW,
      error: Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error(code), { code }),
      }),
      env: {},
    });

  // Provably never left the machine / never established a connection.
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]) {
    assert.equal(describe(code).safeToRetry, true, `${code} should be safe to fail over`);
  }
  // Indistinguishable from "the gateway got it and the answer was lost".
  for (const code of ["ECONNRESET", "ETIMEDOUT", "UND_ERR_HEADERS_TIMEOUT", "EPROTO"]) {
    assert.equal(describe(code).safeToRetry, false, `${code} is ambiguous — must not fail over`);
  }

  assert.equal(
    classifyBlockedResponse({ status: 407, headers: headers(), body: "", url: GW }).safeToRetry,
    true,
  );
  assert.equal(
    classifyBlockedResponse({ status: 403, headers: headers(), body: "", url: GW }).safeToRetry,
    false,
  );
  assert.equal(
    classifyBlockedResponse({ status: 502, headers: headers(), body: "", url: GW }).safeToRetry,
    false,
  );
});

test("TLS interception points at the CA bundle, not the firewall", () => {
  const err = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("self signed certificate in certificate chain"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    }),
  });
  const d = describeTransportError({ url: GW, error: err, env: {} });
  assert.equal(d.code, ERROR_CODES.TLS_UNTRUSTED);
  assert.match(d.message, /NODE_EXTRA_CA_CERTS/);
});
