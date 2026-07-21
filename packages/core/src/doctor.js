// Preflight connectivity check: "can this process actually reach its mail
// backend, and if not, exactly what do I have to allow?"
//
// Built for the sandboxed-agent case. An agent running behind an egress
// allowlist can't tell a network refusal from an account rejection, and finding
// that out by attempting a real send is an expensive way to learn it. `diagnose`
// answers it up front and for free: it only reads config and pings
// unauthenticated endpoints — it never sends mail, never charges, never needs a
// payment token.

import { createProvider } from "./providers/index.js";
import {
  classifyBlockedResponse,
  describeTarget,
  describeTransportError,
  detectProxy,
  resolveProxyDispatcher,
  targetOf,
} from "./net.js";

const DEFAULT_TIMEOUT_MS = 8000;

function unique(values) {
  return [...new Set(values)];
}

async function defaultLookup(hostname) {
  const dns = await import("node:dns/promises");
  return dns.lookup(hostname);
}

async function resolveDns(hostname, lookup) {
  try {
    const { address, family } = await lookup(hostname);
    return { ok: true, detail: `${hostname} → ${address} (IPv${family})` };
  } catch (err) {
    return {
      ok: false,
      detail: `${hostname} did not resolve (${err.code ?? err.message})`,
      code: err.code,
    };
  }
}

async function probe(endpoint, { env, timeoutMs, fetchImpl }) {
  const url = endpoint.url;
  const target = endpoint.target ?? targetOf(url);
  const init = {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  };
  const route = await resolveProxyDispatcher(env, url);
  if (route.dispatcher) init.dispatcher = route.dispatcher;

  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    const d = describeTransportError({ url, error: err, env, route });
    return { ok: false, target, code: d.code, detail: d.message, hint: d.hint };
  }

  const text = await res.text().catch(() => "");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  const blocked = classifyBlockedResponse({
    status: res.status,
    headers: res.headers,
    body,
    url,
    env,
    route,
  });
  if (blocked) {
    return {
      ok: false,
      target,
      status: res.status,
      code: blocked.code,
      detail: blocked.message,
      hint: blocked.hint,
    };
  }

  // A gateway health endpoint must answer with JSON. HTML here means a captive
  // portal or interception page reached us with a 200 — worth catching, since
  // every later call would fail confusingly.
  if (endpoint.expectJson && (!body || typeof body !== "object")) {
    return {
      ok: false,
      target,
      status: res.status,
      code: "egress_blocked",
      detail: `${target} answered ${res.status} but the body isn't JSON — something other than the gateway responded (captive portal or interception page).`,
      hint: `Allow ${target} (TCP 443 / HTTPS CONNECT) for this environment.`,
    };
  }

  // Any HTTP response at all proves the transport works. A 401/404 from a
  // provider API is a reachable host, which is all this check claims.
  return {
    ok: true,
    target,
    status: res.status,
    detail: endpoint.expectJson
      ? `${target} reachable — health ${res.status} ${JSON.stringify(body)}`
      : `${target} reachable (HTTP ${res.status})`,
  };
}

/**
 * Run the preflight. Returns a structured report; nothing throws.
 *
 *   const report = await diagnose();          // uses process.env
 *   if (!report.ok) console.error(formatDiagnosis(report));
 */
export async function diagnose({
  env = typeof process !== "undefined" ? process.env : {},
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = (...args) => fetch(...args),
  dnsLookup = defaultLookup,
} = {}) {
  const report = {
    ok: true,
    node: typeof process !== "undefined" ? process.version : "unknown",
    provider: null,
    proxy: null,
    allowlist: [],
    checks: [],
    next_steps: [],
    summary: "",
  };

  const add = (check) => {
    report.checks.push(check);
    if (!check.ok) report.ok = false;
    if (check.hint && !report.next_steps.includes(check.hint)) {
      report.next_steps.push(check.hint);
    }
    return check;
  };

  let p = provider;
  if (!p) {
    try {
      p = createProvider(env);
    } catch (err) {
      add({ name: "config", ok: false, detail: err.message, hint: err.message });
      report.summary = `Configuration error: ${err.message}`;
      return report;
    }
  }

  report.provider = {
    name: p.name,
    mode: p.isLive ? "LIVE" : "TEST",
    base_url: p.baseUrl,
    // Presence only — never echo the key itself.
    api_key: env.MAILSNAIL_API_KEY ? "set" : "absent",
  };
  add({
    name: "config",
    ok: true,
    detail: `provider "${p.name}" (${p.isLive ? "LIVE — real mail, real money" : "TEST — dry run"})`,
  });

  const endpoints = p.endpoints ?? [];
  report.allowlist = unique(endpoints.map((e) => e.target ?? targetOf(e.url)));

  if (endpoints.length === 0) {
    report.summary = `Provider "${p.name}" exposes no network endpoints to check.`;
    return report;
  }

  // `raw` holds the proxy URL verbatim, credentials and all. The report is
  // printed, logged, and handed to agents — drop it and keep the redacted form.
  const { raw: _rawProxyUrl, ...proxyReport } = detectProxy(env, endpoints[0].url);
  report.proxy = proxyReport;
  if (report.proxy.configured) {
    const routed = await resolveProxyDispatcher(env, endpoints[0].url);
    report.proxy.routed_via_undici = !!routed.dispatcher;
    const usable =
      report.proxy.bypassed || report.proxy.node_env_proxy || !!routed.dispatcher;
    add({
      name: "proxy",
      ok: usable,
      detail: report.proxy.bypassed
        ? `${report.proxy.var}=${report.proxy.url} is set but NO_PROXY exempts this host — connecting directly.`
        : report.proxy.node_env_proxy
          ? `${report.proxy.var}=${report.proxy.url} in use (NODE_USE_ENV_PROXY enabled).`
          : routed.dispatcher
            ? `${report.proxy.var}=${report.proxy.url} in use via undici ProxyAgent.`
            : `${report.proxy.var}=${report.proxy.url} is set, but nothing is routing through it.`,
      hint: usable
        ? undefined
        : `Node's fetch ignores ${report.proxy.var} by default. Set NODE_USE_ENV_PROXY=1 (Node >= 22.21), or \`npm i undici\` next to mailsnail so requests are routed through the proxy.`,
    });
  }

  for (const endpoint of endpoints) {
    const hostname = (() => {
      try {
        return new URL(endpoint.url).hostname;
      } catch {
        return endpoint.url;
      }
    })();
    const label = endpoint.provider ? `${endpoint.provider}:` : "";

    const dns = await resolveDns(hostname, dnsLookup);
    // Behind a proxy, DNS is the proxy's job — a local failure proves nothing.
    const dnsIsAdvisory = report.proxy?.configured && !report.proxy?.bypassed;
    add({
      name: `${label}dns`,
      ok: dns.ok || dnsIsAdvisory,
      advisory: !dns.ok && dnsIsAdvisory ? true : undefined,
      detail:
        !dns.ok && dnsIsAdvisory
          ? `${dns.detail} — expected when a proxy resolves names on your behalf.`
          : dns.detail,
      hint:
        dns.ok || dnsIsAdvisory
          ? undefined
          : `Allow DNS resolution for ${hostname}, or point MAIL_API_BASE_URL at a reachable gateway.`,
    });

    const reach = await probe(endpoint, { env, timeoutMs, fetchImpl });
    add({
      name: `${label}reach`,
      ok: reach.ok,
      code: reach.code,
      status: reach.status,
      detail: `${endpoint.purpose}: ${reach.detail}`,
      hint: reach.hint,
    });
  }

  report.summary = report.ok
    ? `OK — ${report.provider.name} reachable (${report.allowlist.join(", ")}).`
    : `Cannot reach ${report.allowlist.join(", ")}. ${report.next_steps[0] ?? ""}`.trim();
  return report;
}

/** Render a diagnosis for a terminal. */
export function formatDiagnosis(report) {
  const lines = [];
  const mark = (c) => (c.ok ? (c.advisory ? "~" : "✔") : "✘");

  lines.push("mailsnail doctor");
  lines.push(`  node        ${report.node}`);
  if (report.provider) {
    lines.push(`  provider    ${report.provider.name} (${report.provider.mode})`);
    if (report.provider.base_url) lines.push(`  gateway     ${report.provider.base_url}`);
    lines.push(
      `  api key     ${report.provider.api_key === "set" ? "set" : "not set (anonymous, pay per piece)"}`,
    );
  }
  if (report.proxy?.configured) {
    lines.push(`  proxy       ${report.proxy.var}=${report.proxy.url}`);
    if (report.proxy.no_proxy) lines.push(`  no_proxy    ${report.proxy.no_proxy}`);
  }
  lines.push("");

  for (const c of report.checks) {
    lines.push(`${mark(c)} ${c.name.padEnd(11)} ${c.detail}`);
  }

  if (report.allowlist.length) {
    lines.push("");
    lines.push("Hosts this configuration needs to reach:");
    for (const t of report.allowlist) lines.push(`  ${t}   (${describeTarget(t)})`);
  }

  if (report.next_steps.length) {
    lines.push("");
    lines.push("Next steps:");
    report.next_steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }

  lines.push("");
  lines.push(report.ok ? `✔ ${report.summary}` : `✘ ${report.summary}`);
  return lines.join("\n");
}
