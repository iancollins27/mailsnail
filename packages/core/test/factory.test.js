import { test } from "node:test";
import assert from "node:assert/strict";
import { createProvider, DEFAULT_MANAGED_URL } from "../src/providers/index.js";

test("defaults to managed pointing at the hosted gateway", () => {
  const p = createProvider({});
  assert.equal(p.name, "managed");
  assert.equal(p.baseUrl, DEFAULT_MANAGED_URL);
});

test("managed respects MAIL_API_BASE_URL override", () => {
  const p = createProvider({
    MAIL_PROVIDER: "managed",
    MAIL_API_BASE_URL: "http://localhost:8080",
  });
  assert.equal(p.baseUrl, "http://localhost:8080");
});

test("gateway mode requires an explicit base URL", () => {
  assert.throws(() => createProvider({ MAIL_PROVIDER: "gateway" }), /MAIL_API_BASE_URL/);
  const p = createProvider({
    MAIL_PROVIDER: "gateway",
    MAIL_API_BASE_URL: "http://localhost:8080",
  });
  assert.equal(p.name, "gateway");
});

test("click2mail requires credentials", () => {
  assert.throws(() => createProvider({ MAIL_PROVIDER: "click2mail" }), /CLICK2MAIL/);
  const p = createProvider({
    MAIL_PROVIDER: "click2mail",
    CLICK2MAIL_USERNAME: "u",
    CLICK2MAIL_PASSWORD: "p",
  });
  assert.equal(p.name, "click2mail");
  assert.equal(p.isLive, false);
});

test("click2mail goes live only with MAIL_ALLOW_LIVE=1", () => {
  const p = createProvider({
    MAIL_PROVIDER: "click2mail",
    CLICK2MAIL_USERNAME: "u",
    CLICK2MAIL_PASSWORD: "p",
    MAIL_ALLOW_LIVE: "1",
  });
  assert.equal(p.isLive, true);
});

test("lob refuses a live key without MAIL_ALLOW_LIVE", () => {
  assert.throws(
    () => createProvider({ MAIL_PROVIDER: "lob", LOB_API_KEY: "live_abc" }),
    /Refusing to start/,
  );
  const p = createProvider({ MAIL_PROVIDER: "lob", LOB_API_KEY: "test_abc" });
  assert.equal(p.name, "lob");
});

test("MAIL_PROVIDERS builds a failover chain", () => {
  const p = createProvider({
    MAIL_PROVIDERS: "click2mail, lob",
    CLICK2MAIL_USERNAME: "u",
    CLICK2MAIL_PASSWORD: "p",
    LOB_API_KEY: "test_abc",
  });
  assert.equal(p.name, "failover(click2mail→lob)");
});

test("unknown provider names are rejected", () => {
  assert.throws(() => createProvider({ MAIL_PROVIDER: "pigeon" }), /Unknown provider/);
});
