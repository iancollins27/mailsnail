import { test } from "node:test";
import assert from "node:assert/strict";
import { FailoverProvider } from "../src/providers/router.js";
import { ProviderError, NotSupported } from "../src/errors.js";

function fake(name, overrides = {}) {
  return {
    name,
    isLive: false,
    verifyAddress: async () => ({ deliverability: "deliverable", by: name }),
    sendLetter: async () => ({ id: `${name}-1`, status: "queued", by: name }),
    sendPostcard: async () => ({ id: `${name}-1`, status: "queued", by: name }),
    getLetter: async (id) => ({ id, by: name }),
    listLetters: async () => ({ data: [], by: name }),
    cancelLetter: async (id) => ({ id, cancelled: true, by: name }),
    preview: async () => ({ by: name }),
    ...overrides,
  };
}

test("requires a non-empty providers array", () => {
  assert.throws(() => new FailoverProvider([]), /non-empty/);
});

test("uses the first provider when it succeeds", async () => {
  const router = new FailoverProvider([fake("a"), fake("b")]);
  const result = await router.sendLetter({});
  assert.equal(result.by, "a");
});

test("send fails over when the error is safeToRetry", async () => {
  const events = [];
  const router = new FailoverProvider(
    [
      fake("a", {
        sendLetter: async () => {
          throw new ProviderError("preflight boom", {
            provider: "a",
            safeToRetry: true,
          });
        },
      }),
      fake("b"),
    ],
    { onFailover: (e) => events.push(e) },
  );
  const result = await router.sendLetter({});
  assert.equal(result.by, "b");
  assert.equal(events.length, 1);
  assert.equal(events[0].from, "a");
  assert.equal(events[0].to, "b");
});

test("send does NOT fail over on ambiguous errors", async () => {
  const router = new FailoverProvider([
    fake("a", {
      sendLetter: async () => {
        throw new ProviderError("network drop mid-submit", {
          provider: "a",
          safeToRetry: false,
        });
      },
    }),
    fake("b"),
  ]);
  await assert.rejects(() => router.sendLetter({}), /mid-submit/);
});

test("send fails over on NotSupported", async () => {
  const router = new FailoverProvider([
    fake("a", {
      sendPostcard: async () => {
        throw new NotSupported("a", "sendPostcard");
      },
    }),
    fake("b"),
  ]);
  const result = await router.sendPostcard({});
  assert.equal(result.by, "b");
});

test("reads fail over freely", async () => {
  const router = new FailoverProvider([
    fake("a", {
      getLetter: async () => {
        throw new ProviderError("not found", {
          provider: "a",
          status: 404,
          safeToRetry: false,
        });
      },
    }),
    fake("b"),
  ]);
  const result = await router.getLetter("id-1");
  assert.equal(result.by, "b");
});

test("cancel fails over on 404 but not on other errors", async () => {
  const notMine = new FailoverProvider([
    fake("a", {
      cancelLetter: async () => {
        throw new ProviderError("unknown id", { provider: "a", status: 404 });
      },
    }),
    fake("b"),
  ]);
  const result = await notMine.cancelLetter("id-1");
  assert.equal(result.by, "b");

  const hardFail = new FailoverProvider([
    fake("a", {
      cancelLetter: async () => {
        throw new ProviderError("already in production", {
          provider: "a",
          status: 409,
        });
      },
    }),
    fake("b"),
  ]);
  await assert.rejects(() => hardFail.cancelLetter("id-1"), /production/);
});

test("last provider's error surfaces when all fail", async () => {
  const router = new FailoverProvider([
    fake("a", {
      verifyAddress: async () => {
        throw new ProviderError("a down", { provider: "a" });
      },
    }),
    fake("b", {
      verifyAddress: async () => {
        throw new ProviderError("b down", { provider: "b" });
      },
    }),
  ]);
  await assert.rejects(() => router.verifyAddress({}), /b down/);
});

test("isLive is true when any provider is live", () => {
  assert.equal(
    new FailoverProvider([fake("a"), fake("b", { isLive: true })]).isLive,
    true,
  );
  assert.equal(new FailoverProvider([fake("a"), fake("b")]).isLive, false);
});

test("name describes the chain", () => {
  const router = new FailoverProvider([fake("a"), fake("b")]);
  assert.equal(router.name, "failover(a→b)");
});
