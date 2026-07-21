// Proves the corporate-proxy path end to end against a real local proxy: with
// `undici` available, a gateway request tunnels through *_PROXY instead of
// going direct — and NO_PROXY still wins. Node's own fetch ignores *_PROXY
// unless NODE_USE_ENV_PROXY=1, which is why this path exists at all.
//
// undici is an optional peer, so these skip when it isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { GatewayProvider } from "../src/providers/gateway.js";
import { resetProxyDispatchers } from "../src/net.js";
import { ERROR_CODES } from "../src/errors.js";

let undiciAvailable = true;
try {
  await import("undici");
} catch {
  undiciAvailable = false;
}
const skip = undiciAvailable ? false : "undici is not installed";

/** An origin that answers like a gateway. */
async function startOrigin() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

/** A proxy that records how it was reached and tunnels CONNECT through. */
async function startProxy() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`ABSOLUTE ${req.method} ${req.url}`);
    res.writeHead(502).end();
  });
  server.on("connect", (req, clientSocket, head) => {
    seen.push(`CONNECT ${req.url}`);
    const [host, port] = req.url.split(":");
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port, seen };
}

test("routes through HTTP_PROXY when undici is available", { skip }, async () => {
  resetProxyDispatchers();
  const origin = await startOrigin();
  const proxy = await startProxy();
  try {
    const p = new GatewayProvider({
      baseUrl: `http://127.0.0.1:${origin.port}`,
      env: { HTTP_PROXY: `http://127.0.0.1:${proxy.port}` },
    });
    const out = await p.verifyAddress({ address_line1: "1 Main St" });
    assert.equal(out.ok, true, "the response must still come back intact");
    assert.equal(out.path, "/v1/verify");
    assert.deepEqual(proxy.seen, [`CONNECT 127.0.0.1:${origin.port}`]);
  } finally {
    origin.server.close();
    proxy.server.close();
    resetProxyDispatchers();
  }
});

test("NO_PROXY sends the request direct", { skip }, async () => {
  resetProxyDispatchers();
  const origin = await startOrigin();
  const proxy = await startProxy();
  try {
    const p = new GatewayProvider({
      baseUrl: `http://127.0.0.1:${origin.port}`,
      env: {
        HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
        NO_PROXY: "127.0.0.1",
      },
    });
    const out = await p.verifyAddress({ address_line1: "1 Main St" });
    assert.equal(out.ok, true);
    assert.deepEqual(proxy.seen, [], "the proxy must not be involved");
  } finally {
    origin.server.close();
    proxy.server.close();
    resetProxyDispatchers();
  }
});

// The issue this whole module exists for: an egress allowlist refuses the
// CONNECT with a bare 403 (`curl: (56) CONNECT tunnel failed, response 403`).
// The client library raises that as a thrown error, not an HTTP response.
test("a refused CONNECT tunnel is reported as an egress block", { skip }, async () => {
  resetProxyDispatchers();
  const refusing = http.createServer((req, res) => res.writeHead(403).end());
  refusing.on("connect", (req, socket) => {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.end();
  });
  await new Promise((r) => refusing.listen(0, "127.0.0.1", r));
  try {
    const p = new GatewayProvider({
      baseUrl: "https://api.mailsnail.dev",
      env: { HTTPS_PROXY: `http://127.0.0.1:${refusing.address().port}` },
    });
    const err = await p.preview({ body_text: "hi" }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, "expected a rejection");
    assert.equal(err.code, ERROR_CODES.EGRESS_BLOCKED);
    assert.match(err.message, /refused to open a tunnel/);
    assert.match(err.message, /api\.mailsnail\.dev:443/);
    assert.match(err.message, /nothing was sent or charged/i);
    assert.equal(err.safeToRetry, true, "the tunnel never opened");
  } finally {
    refusing.close();
    resetProxyDispatchers();
  }
});

// When we ARE routing through the proxy, "install undici" is the wrong advice —
// the proxy itself is the thing to look at. Uses a dead local port; no network.
test("a broken proxy we're routing through blames the proxy", { skip }, async () => {
  resetProxyDispatchers();
  try {
    const p = new GatewayProvider({
      baseUrl: "https://api.mailsnail.dev",
      env: { HTTPS_PROXY: "http://127.0.0.1:1" },
    });
    const err = await p.preview({ body_text: "hi" }).then(
      () => null,
      (e) => e,
    );
    assert.match(err.message, /through the proxy at 127\.0\.0\.1:1/);
    assert.match(err.hint, /check that the proxy itself is reachable/);
    assert.ok(
      !/install `undici`/.test(err.message),
      "must not tell you to install what is already doing the routing",
    );
  } finally {
    resetProxyDispatchers();
  }
});

test("no proxy configured means no behavior change", async () => {
  resetProxyDispatchers();
  const origin = await startOrigin();
  try {
    const p = new GatewayProvider({ baseUrl: `http://127.0.0.1:${origin.port}`, env: {} });
    assert.equal((await p.verifyAddress({ address_line1: "1 Main St" })).ok, true);
  } finally {
    origin.server.close();
  }
});
