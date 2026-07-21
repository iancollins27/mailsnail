// Transport diagnosis for gateway calls.
//
// Why this file exists: agents increasingly run inside sandboxes with an egress
// allowlist — CI runners, enterprise agent platforms, hosted agent sessions. In
// those environments the outbound CONNECT to the gateway is refused by the
// environment's own proxy, so the request never reaches Mailsnail at all. What
// comes back is a bare 403 (or 407), which is indistinguishable from "your
// account was rejected" unless you look at the body — and that sends people off
// debugging the wrong thing.
//
// The tell: the gateway answers every 4xx with a JSON body. A proxy answers with
// HTML, plain text, or nothing. So a bodyless/non-JSON 403 did not come from us,
// and we can say so and print the exact host:port to allowlist instead.
//
// Nothing here sends, charges, or retries; it only turns a failed transport into
// an accurate sentence.

import { ERROR_CODES } from "./errors.js";

// Which env var governs a given URL. Matches undici's EnvHttpProxyAgent (what
// NODE_USE_ENV_PROXY turns on) so `doctor` describes what would actually happen:
// scheme-appropriate var first, never crossing http <-> https. ALL_PROXY is a
// widely-used fallback that undici itself doesn't read; we honor it when we do
// the routing, and `doctor` says which one is in play.
const PROXY_VARS = {
  http: ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"],
  https: ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"],
};

function proxyVarsFor(url) {
  if (!url) return [...PROXY_VARS.https, ...PROXY_VARS.http];
  try {
    return new URL(url).protocol === "http:" ? PROXY_VARS.http : PROXY_VARS.https;
  } catch {
    return PROXY_VARS.https;
  }
}

/** "https://api.mailsnail.dev/v1" -> "api.mailsnail.dev:443" — what to allowlist. */
export function targetOf(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return String(url);
  }
}

/** Strip any user:pass from a proxy URL before it goes into a log or an error. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return String(url);
  }
}

/** NO_PROXY matching: "*", exact host, ".suffix"/"suffix", optional :port. */
export function noProxyMatches(noProxy, url) {
  if (!noProxy) return false;
  let host;
  let port;
  try {
    const u = new URL(url);
    host = u.hostname;
    port = u.port || (u.protocol === "https:" ? "443" : "80");
  } catch {
    return false;
  }
  return noProxy
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule === "*") return true;
      const [rHost, rPort] = rule.split(":");
      if (rPort && rPort !== port) return false;
      const bare = rHost.replace(/^\./, "");
      return host === bare || host.endsWith(`.${bare}`);
    });
}

/**
 * What the environment says about proxying, and whether Node will actually
 * honor it. Node's global fetch ignores *_PROXY unless NODE_USE_ENV_PROXY=1
 * (Node >= 22.21) or --use-env-proxy is passed — a footgun worth naming out
 * loud, because an allowlisted gateway still times out when it bites.
 */
export function detectProxy(env = {}, url) {
  const found = proxyVarsFor(url)
    .map((v) => [v, env[v]])
    .find(([, value]) => value);
  const noProxy = env.NO_PROXY ?? env.no_proxy;
  const bypassed = !!found && !!url && noProxyMatches(noProxy, url);
  const nodeHandlesIt =
    env.NODE_USE_ENV_PROXY === "1" ||
    !!env.NODE_OPTIONS?.includes("--use-env-proxy");
  return {
    configured: !!found,
    var: found?.[0],
    url: found ? redactUrl(found[1]) : undefined,
    raw: found?.[1],
    no_proxy: noProxy || undefined,
    bypassed,
    node_env_proxy: nodeHandlesIt,
    // True when a proxy is configured, applies to this URL, and nothing is
    // routing through it — the silent-timeout case.
    ignored: !!found && !bypassed && !nodeHandlesIt,
  };
}

function proxyHint(proxy) {
  if (!proxy?.ignored) return null;
  return (
    `${proxy.var} is set (${proxy.url}) but Node's fetch ignores it by default — ` +
    `set NODE_USE_ENV_PROXY=1 (Node >= 22.21), or install \`undici\` alongside ` +
    `mailsnail and it will be routed through the proxy automatically.`
  );
}

/** "api.mailsnail.dev:443" -> "TCP 443 / HTTPS CONNECT"; other ports say only what's true. */
export function describeTarget(target) {
  const port = String(target).split(":").pop();
  return port === "443" ? "TCP 443 / HTTPS CONNECT" : `TCP ${port}`;
}

function allowlistHint(target) {
  return (
    `If this environment uses an egress allowlist or firewall, permit ` +
    `${target} (${describeTarget(target)}). Run \`npx mailsnail doctor\` for a full report.`
  );
}

/** Walk an Error's `cause` chain (Node wraps fetch errors) collecting a field. */
function causeChain(error, pick) {
  const out = [];
  let e = error;
  for (let depth = 0; e && depth < 8; depth++) {
    for (const value of pick(e)) if (typeof value === "string") out.push(value);
    e = e.cause;
  }
  return out;
}

const causeCodes = (error) => causeChain(error, (e) => [e.code, e.name]);

// A proxy that refuses to open the tunnel reports it through the client library
// rather than as an HTTP response — undici says "Proxy response (403) !== 200
// when HTTP Tunneling", curl says "CONNECT tunnel failed, response 403". Same
// event as a bare 403, and the most literal form of "blocked before it arrived".
const TUNNEL_REFUSAL =
  /Proxy response \((\d{3})\)|CONNECT tunnel failed|tunneling socket could not be established/i;

const TLS_CODES = [
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
];

/**
 * Turn a thrown fetch error into an accurate, actionable description.
 * Returns { code, message, hint, detail, target, safeToRetry } — `message`
 * already contains `hint` so a caller that surfaces only the message still
 * shows the fix.
 *
 * `safeToRetry` follows the failover contract in errors.js and is true ONLY for
 * failures that provably happened *before* the request was transmitted: name
 * resolution, connection setup, TLS handshake. A reset or a mid-flight timeout
 * looks identical to "the gateway processed it and the answer got lost", so
 * those stay false — a duplicate letter is worse than an error.
 */
export function describeTransportError({ url, error, env = {} }) {
  const target = targetOf(url);
  const codes = causeCodes(error);
  const has = (...names) => names.some((n) => codes.includes(n));
  const proxy = detectProxy(env, url);
  const detail = codes.find((c) => c !== "Error" && c !== "TypeError") ?? error?.message;

  const tunnelRefusal = causeChain(error, (e) => [e.message]).find((m) =>
    TUNNEL_REFUSAL.test(m),
  );

  let code = ERROR_CODES.UNREACHABLE;
  let safeToRetry = false;
  let what;
  if (tunnelRefusal) {
    code = ERROR_CODES.EGRESS_BLOCKED;
    safeToRetry = true; // the tunnel never opened, so nothing was transmitted
    const status = tunnelRefusal.match(/\((\d{3})\)/)?.[1];
    what =
      `The HTTP proxy refused to open a tunnel to ${target}${status ? ` (answered ${status})` : ""}: ${tunnelRefusal}. ` +
      `The request never reached the Mailsnail gateway — nothing was sent or charged. This is an egress policy decision, not an account problem.`;
  } else if (has(...TLS_CODES)) {
    code = ERROR_CODES.TLS_UNTRUSTED;
    safeToRetry = true; // the handshake precedes the request
    what =
      `TLS handshake with ${target} was rejected (${detail}). Nothing was sent. ` +
      `This usually means a TLS-inspecting proxy is re-signing the connection with a CA Node doesn't trust — ` +
      `point NODE_EXTRA_CA_CERTS at your organization's CA bundle.`;
  } else if (has("ENOTFOUND", "EAI_AGAIN")) {
    safeToRetry = true;
    what = `DNS lookup for ${new URL(url).hostname} failed (${detail}). Nothing was sent — the request never left this machine.`;
  } else if (has("ECONNREFUSED")) {
    safeToRetry = true;
    what = `Connection to ${target} was refused (ECONNREFUSED). Nothing was sent.`;
  } else if (has("UND_ERR_CONNECT_TIMEOUT", "ConnectTimeoutError")) {
    safeToRetry = true; // the connection was never established
    what = `Connection to ${target} timed out before it was established (${detail}). Nothing was sent.`;
  } else if (has("ETIMEDOUT", "TimeoutError", "UND_ERR_HEADERS_TIMEOUT")) {
    what = `Request to ${target} timed out (${detail}). It may or may not have been received — this one is ambiguous, so nothing is retried automatically.`;
  } else if (has("ECONNRESET", "EPROTO", "UND_ERR_SOCKET")) {
    what = `Connection to ${target} was reset (${detail}) — a filtering middlebox often does this. Whether the request was received first is unknowable, so nothing is retried automatically.`;
  } else if (has("ABORT_ERR", "AbortError")) {
    what = `Request to ${target} was aborted before a response arrived.`;
  } else {
    what = `Couldn't reach ${target}: ${error?.message ?? detail}.`;
  }

  const hint = proxyHint(proxy) ?? (code === ERROR_CODES.TLS_UNTRUSTED ? null : allowlistHint(target));
  return {
    code,
    message: hint ? `${what} ${hint}` : what,
    hint,
    detail,
    target,
    safeToRetry,
  };
}

/**
 * Decide whether an HTTP response came from something other than the gateway.
 * Returns null when the response is the gateway's own (JSON) answer — the caller
 * should surface the gateway's message unchanged in that case.
 */
export function classifyBlockedResponse({ status, headers, body, url, env = {} }) {
  const target = targetOf(url);
  const header = (name) => {
    try {
      return headers?.get?.(name) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const fromGateway = !!body && typeof body === "object" && !Array.isArray(body);
  const proxy = detectProxy(env, url);
  const via = header("via");
  const viaNote = via ? ` (response carries \`via: ${via}\`)` : "";

  // safeToRetry mirrors describeTransportError: true only when the hop that
  // answered provably never forwarded the request. A proxy demanding auth (407)
  // or a captive portal (511) refuses before it tunnels anything. A bare 403
  // usually IS a refused CONNECT — but it can also come from a filter sitting in
  // front of an origin that already saw the request, so it stays unsafe: reads
  // fail over anyway, and a send is exactly where a duplicate would hurt.
  const blocked = (what, extraHint, { safeToRetry = false } = {}) => ({
    code: ERROR_CODES.EGRESS_BLOCKED,
    message: `${what} ${extraHint}`.trim(),
    hint: extraHint,
    status,
    target,
    safeToRetry,
  });

  // 407 is a proxy talking to us directly; the gateway never emits it.
  if (status === 407) {
    const auth = header("proxy-authenticate");
    return blocked(
      `An HTTP proxy between this process and ${target} demanded authentication (407${auth ? `, ${auth}` : ""}). ` +
        `The request never reached the Mailsnail gateway, so nothing was sent or charged.`,
      proxyHint(proxy) ??
        `Supply proxy credentials via HTTPS_PROXY (e.g. http://user:pass@proxy:8080) and set NODE_USE_ENV_PROXY=1, or allowlist ${target} so the proxy is bypassed.`,
      { safeToRetry: true },
    );
  }

  // Anything with a JSON object body is the gateway answering for itself.
  if (fromGateway) return null;

  if (status === 511) {
    return blocked(
      `The network returned 511 (Network Authentication Required) for ${target}${viaNote} — a captive portal or gateway auth page answered, not Mailsnail. Nothing was sent.`,
      allowlistHint(target),
      { safeToRetry: true },
    );
  }

  if (status === 403) {
    return blocked(
      // No "nothing was sent" promise here, unlike 407/511: a 403 can also come
      // from a filter in front of a backend that already saw the request. The
      // matching safeToRetry stays false for the same reason.
      `${target} answered 403 with no JSON body${viaNote}. The Mailsnail gateway always answers with JSON, so this 403 came from a hop in between — typically an egress proxy, firewall, or allowlist — and not from the Mailsnail application, which means it is almost certainly network policy rather than your account.`,
      proxyHint(proxy) ?? allowlistHint(target),
    );
  }

  if (status === 502 || status === 503 || status === 504) {
    const hint = proxyHint(proxy) ?? allowlistHint(target);
    return {
      code: ERROR_CODES.GATEWAY_UNAVAILABLE,
      message:
        `${target} answered ${status} with no JSON body${viaNote} — either the gateway is down or a hop in between answered for it. Nothing was sent. ${hint}`,
      hint,
      status,
      target,
      // A 5xx can be emitted after an origin processed the request.
      safeToRetry: false,
    };
  }

  return null;
}

// ── Optional proxy routing ───────────────────────────────────────────────────
// @mailsnail/core has zero required dependencies and keeps it that way: if
// `undici` happens to be installed (it very often is, as a transitive dep), we
// use its ProxyAgent so managed mode works through a corporate proxy. If it
// isn't, we don't install anything behind your back — we say so in the error
// and in `mailsnail doctor`.

const dispatcherCache = new Map();

export function resolveProxyDispatcher(env = {}, url) {
  const proxy = detectProxy(env, url);
  if (!proxy.ignored) {
    return Promise.resolve({ active: false, proxy });
  }
  const key = `${proxy.raw}|${targetOf(url)}`;
  if (!dispatcherCache.has(key)) {
    dispatcherCache.set(
      key,
      import("undici")
        .then(({ ProxyAgent }) => ({
          active: true,
          dispatcher: new ProxyAgent(proxy.raw),
          proxy,
        }))
        .catch(() => ({ active: false, unavailable: "undici", proxy })),
    );
  }
  return dispatcherCache.get(key);
}

/** Test seam / long-running processes: drop memoized ProxyAgents. */
export function resetProxyDispatchers() {
  dispatcherCache.clear();
}
