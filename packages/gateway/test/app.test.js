import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createGatewayApp } from "../src/app.js";
import { ProviderError } from "@mailsnail/core";

const addr = {
  name: "Jane Doe",
  address_line1: "123 Main St",
  address_city: "Springfield",
  address_state: "IL",
  address_zip: "62701",
};

function fakeProvider(overrides = {}) {
  return {
    name: "fake",
    isLive: false,
    calls: [],
    async verifyAddress(input) {
      this.calls.push(["verifyAddress", input]);
      return { deliverability: "deliverable", normalized: addr };
    },
    async sendLetter(input) {
      this.calls.push(["sendLetter", input]);
      return { id: "job-1", status: "queued", mode: "TEST" };
    },
    async sendPostcard(input) {
      this.calls.push(["sendPostcard", input]);
      return { id: "pc-1", status: "queued", mode: "TEST" };
    },
    async getLetter(id) {
      this.calls.push(["getLetter", id]);
      return { id, status: "processing" };
    },
    async cancelLetter(id) {
      this.calls.push(["cancelLetter", id]);
      return { id };
    },
    ...overrides,
  };
}

const servers = [];
async function start(provider, opts = {}) {
  const logs = [];
  const app = createGatewayApp({
    provider,
    log: (l) => logs.push(l),
    ...opts,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, logs };
}
after(() => servers.forEach((s) => s.close()));

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("healthz reports provider and mode", async () => {
  const { base } = await start(fakeProvider());
  const res = await fetch(`${base}/healthz`);
  assert.deepEqual(await res.json(), { ok: true, mode: "TEST", provider: "fake" });
});

test("verify requires address_line1 and passes through", async () => {
  const provider = fakeProvider();
  const { base } = await start(provider);
  const bad = await post(base, "/v1/verify", {});
  assert.equal(bad.status, 400);
  const good = await post(base, "/v1/verify", { address_line1: "123 Main St" });
  assert.equal(good.status, 200);
  assert.equal(good.body.deliverability, "deliverable");
});

test("letter with body_text is rendered and sent as pdf_buffer", async () => {
  const provider = fakeProvider();
  const { base, logs } = await start(provider);
  const res = await post(base, "/v1/letters", {
    to: addr,
    from: addr,
    body_text: "Hello from the gateway test.",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "job-1");
  const [op, input] = provider.calls.find(([o]) => o === "sendLetter");
  assert.equal(op, "sendLetter");
  assert.equal(input.file_url, undefined);
  assert.ok(Buffer.isBuffer(input.pdf_buffer) || input.pdf_buffer instanceof Uint8Array);
  const line = logs.find((l) => l.tool === "POST /v1/letters");
  assert.equal(line.ok, true);
  assert.equal(line.kind, "letter");
  assert.equal(line.provider, "fake");
});

test("letter validation failures are 400 with the field named", async () => {
  const { base } = await start(fakeProvider());
  const res = await post(base, "/v1/letters", { to: addr, from: addr });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /file_url or body_text/);
});

test("provider send failure surfaces safe_to_retry honestly", async () => {
  const provider = fakeProvider({
    async sendLetter() {
      throw new ProviderError("boom", { provider: "fake", status: 500, safeToRetry: false });
    },
  });
  const { base } = await start(provider);
  const res = await post(base, "/v1/letters", { to: addr, from: addr, body_text: "x" });
  assert.equal(res.status, 502);
  assert.equal(res.body.safe_to_retry, false);
});

test("preview falls back to render-only proof without a drafting provider", async () => {
  const { base } = await start(fakeProvider());
  const res = await post(base, "/v1/preview", { to: addr, from: addr, body_text: "Proof me" });
  assert.equal(res.status, 200);
  assert.equal(res.body.draft_id, undefined);
  assert.match(res.body.proof_url, /\/v1\/preview\//);
  // publicBaseUrl wasn't configured, so proof_url is relative to the gateway.
  const pdf = await fetch(new URL(res.body.proof_url, base));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
});

test("preview + confirm uses provider drafts when supported", async () => {
  const provider = fakeProvider({
    async createDraft(input) {
      this.calls.push(["createDraft", input]);
      return { jobId: "draft-9", jobStatus: "created", normalized: addr };
    },
    async submitDraft(id) {
      this.calls.push(["submitDraft", id]);
      return { id, status: "submitted", mode: "TEST" };
    },
  });
  const { base } = await start(provider);
  const prev = await post(base, "/v1/preview", { to: addr, from: addr, body_text: "Draft me" });
  assert.equal(prev.status, 200);
  assert.equal(prev.body.draft_id, "draft-9");
  const confirm = await post(base, "/v1/letters", { draft_id: "draft-9" });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.status, "submitted");
  const again = await post(base, "/v1/letters", { draft_id: "draft-9" });
  assert.equal(again.status, 404);
});

test("postcards validate and pass through", async () => {
  const provider = fakeProvider();
  const { base } = await start(provider);
  const bad = await post(base, "/v1/postcards", { to: addr, from: addr });
  assert.equal(bad.status, 400);
  const good = await post(base, "/v1/postcards", {
    to: addr,
    from: addr,
    front_url: "https://x.test/f.pdf",
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.id, "pc-1");
});

test("get and cancel letter round-trip", async () => {
  const provider = fakeProvider();
  const { base } = await start(provider);
  const got = await fetch(`${base}/v1/letters/job-1`);
  assert.equal((await got.json()).status, "processing");
  const del = await fetch(`${base}/v1/letters/job-1`, { method: "DELETE" });
  assert.equal((await del.json()).cancelled, true);
});
