#!/usr/bin/env node
// Smoke test: spawns the MCP server with each provider, sends initialize + tools/list.
// Does NOT make real provider API calls.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");

async function smokeOne(envOverrides, expectProviderInLog) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...envOverrides },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  const responses = [];
  const pending = new Map();

  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        responses.push(msg);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id).resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        // ignore non-JSON
      }
    }
  });
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString("utf8");
  });

  function send(method, params, id) {
    const msg = { jsonrpc: "2.0", method, params };
    if (id != null) msg.id = id;
    child.stdin.write(JSON.stringify(msg) + "\n");
    if (id != null) {
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`timeout waiting for response to id=${id}`));
          }
        }, 5000);
      });
    }
  }

  try {
    await new Promise((r) => setTimeout(r, 200));
    await send(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      },
      1,
    );
    send("notifications/initialized", {});
    const toolsResp = await send("tools/list", {}, 2);
    const tools = toolsResp.result?.tools ?? [];
    if (tools.length !== 9) {
      throw new Error(`expected 9 tools, got ${tools.length}`);
    }
    if (!stderrBuf.includes(expectProviderInLog)) {
      throw new Error(
        `expected stderr to mention "${expectProviderInLog}", got: ${stderrBuf}`,
      );
    }
    return { tools, stderr: stderrBuf };
  } finally {
    child.kill();
  }
}

const cases = [
  {
    label: "click2mail",
    env: {
      MAIL_PROVIDER: "click2mail",
      CLICK2MAIL_USERNAME: "smoke_user",
      CLICK2MAIL_PASSWORD: "smoke_pass",
    },
    expect: "provider=click2mail",
  },
  {
    label: "lob",
    env: {
      MAIL_PROVIDER: "lob",
      LOB_API_KEY: "test_smoke",
    },
    expect: "provider=lob",
  },
  {
    label: "managed",
    env: {
      MAIL_PROVIDER: "managed",
      MAIL_API_BASE_URL: "http://localhost:8080",
    },
    expect: "provider=managed",
  },
  {
    label: "gateway (self-host)",
    env: {
      MAIL_PROVIDER: "gateway",
      MAIL_API_BASE_URL: "http://localhost:8080",
    },
    expect: "provider=gateway",
  },
  {
    label: "failover chain",
    env: {
      MAIL_PROVIDERS: "click2mail,lob",
      CLICK2MAIL_USERNAME: "smoke_user",
      CLICK2MAIL_PASSWORD: "smoke_pass",
      LOB_API_KEY: "test_smoke",
    },
    expect: "provider=failover(click2mail→lob)",
  },
];

let exitCode = 0;
for (const c of cases) {
  try {
    const { tools, stderr } = await smokeOne(c.env, c.expect);
    console.log(`✔ ${c.label}: ${tools.length} tools`);
    console.log(`  ${stderr.trim().split("\n").pop()}`);
  } catch (err) {
    console.error(`✘ ${c.label}: ${err.message}`);
    exitCode = 1;
  }
}
process.exit(exitCode);
