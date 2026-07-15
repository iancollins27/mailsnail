import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectMailManagerProvider } from "../src/providers/directmailmanager.js";
import { createProvider } from "../src/providers/index.js";
import { ProviderError, NotSupported } from "../src/errors.js";

// Fake-free: we instantiate the real adapter and stub the global fetch it calls.
// stubFetch swaps in a canned Response-shaped object and returns a restore fn.
function stubFetch(response) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

// Minimal Response stand-in: _request only reads .ok, .status, and .text().
function httpResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? "" : JSON.stringify(body)),
  };
}

const addr = {
  name: "Jane Doe",
  address_line1: "123 Main St",
  address_city: "Springfield",
  address_state: "IL",
  address_zip: "62701",
};
const letterInput = { to: addr, from: addr, file_url: "https://x.test/a.pdf" };

function newProvider(opts = {}) {
  return new DirectMailManagerProvider({ apiKey: "dmm_test_key", ...opts });
}

test("constructor requires an apiKey", () => {
  assert.throws(() => new DirectMailManagerProvider({}), /DMM_API_KEY/);
});

test("name and isLive reflect sandbox vs live", () => {
  const sandbox = newProvider(); // sandbox defaults to true
  assert.equal(sandbox.name, "directmailmanager");
  assert.equal(sandbox.isLive, false);
  assert.equal(sandbox.baseUrl, "https://sandbox.directmailmanager.com/api");

  const live = newProvider({ sandbox: false });
  assert.equal(live.isLive, true);
  assert.equal(live.baseUrl, "https://api.directmailmanager.com/api");
});

test("sendLetter throws NotSupported for certified mail (router fails over to C2M)", async () => {
  const provider = newProvider();
  for (const extra_service of ["certified", "certified_return_receipt"]) {
    await assert.rejects(
      () => provider.sendLetter({ ...letterInput, extra_service }),
      (err) => {
        assert.ok(err instanceof NotSupported, "expected NotSupported");
        assert.equal(err.provider, "directmailmanager");
        assert.equal(err.capability, "certified mail");
        return true;
      },
    );
  }
});

test("sendLetter rejects body_text (needs a gateway) and requires file_url", async () => {
  const provider = newProvider();
  await assert.rejects(
    () => provider.sendLetter({ to: addr, from: addr, body_text: "hi" }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.safeToRetry, true);
      return /body_text/.test(err.message);
    },
  );
  await assert.rejects(
    () => provider.sendLetter({ to: addr, from: addr }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.safeToRetry, true);
      return /file_url/.test(err.message);
    },
  );
});

test("a 4xx on send is safeToRetry:true (rejected, nothing created)", async () => {
  const provider = newProvider();
  const { restore } = stubFetch(httpResponse(422, { message: "bad address" }));
  try {
    await assert.rejects(
      () => provider.sendLetter(letterInput),
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.status, 422);
        assert.equal(err.safeToRetry, true);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("a 5xx on send is safeToRetry:false (unknown outcome, do not fail over)", async () => {
  const provider = newProvider();
  const { restore } = stubFetch(httpResponse(500, { message: "server error" }));
  try {
    await assert.rejects(
      () => provider.sendLetter(letterInput),
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.status, 500);
        assert.equal(err.safeToRetry, false);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("reads (getLetter) are safeToRetry even on a 5xx", async () => {
  const provider = newProvider();
  const { restore } = stubFetch(httpResponse(503, { message: "down" }));
  try {
    await assert.rejects(
      () => provider.getLetter("ltr_1"),
      (err) => {
        // GET is not a mutation → 5xx stays safe to retry (reads fail over freely).
        assert.equal(err.safeToRetry, true);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("sendLetter returns a standard SendResult on success", async () => {
  const provider = newProvider();
  const { calls, restore } = stubFetch(
    httpResponse(200, {
      id: "ltr_123",
      status: "queued",
      expected_delivery_date: "2026-07-20",
      tracking_number: "TRK9",
      url: "https://x.test/ltr_123.pdf",
    }),
  );
  try {
    const result = await provider.sendLetter(letterInput);
    assert.equal(result.id, "ltr_123");
    assert.equal(result.status, "queued");
    assert.equal(result.expected_delivery_date, "2026-07-20");
    assert.equal(result.tracking_number, "TRK9");
    assert.equal(result.url, "https://x.test/ltr_123.pdf");
    assert.equal(result.mode, "TEST"); // sandbox provider
    assert.ok(result.raw);
    // POSTed to the sandbox /letters endpoint.
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /sandbox\.directmailmanager\.com\/api\/letters$/);
    assert.equal(calls[0].init.method, "POST");
  } finally {
    restore();
  }
});

test("postcard / verify / preview / list methods are absent so the router falls through", () => {
  const provider = newProvider();
  // Present (DMM's capabilities):
  assert.equal(typeof provider.sendLetter, "function");
  assert.equal(typeof provider.getLetter, "function");
  assert.equal(typeof provider.cancelLetter, "function");
  // Absent by design → FailoverProvider routes these to click2mail / lob:
  assert.equal(typeof provider.sendPostcard, "undefined");
  assert.equal(typeof provider.verifyAddress, "undefined");
  assert.equal(typeof provider.preview, "undefined");
  assert.equal(typeof provider.listLetters, "undefined");
});

// --- registration wiring in providers/index.js -----------------------------

test("createProvider builds a sandbox DMM by default and refuses no key", () => {
  assert.throws(
    () => createProvider({ MAIL_PROVIDER: "directmailmanager" }),
    /DMM_API_KEY/,
  );
  const p = createProvider({
    MAIL_PROVIDER: "directmailmanager",
    DMM_API_KEY: "dmm_test_key",
  });
  assert.equal(p.name, "directmailmanager");
  assert.equal(p.isLive, false);
});

test("createProvider goes live only with MAIL_ALLOW_LIVE=1", () => {
  const p = createProvider({
    MAIL_PROVIDER: "directmailmanager",
    DMM_API_KEY: "dmm_prod_key",
    MAIL_ALLOW_LIVE: "1",
  });
  assert.equal(p.isLive, true);
});

test("DMM slots first in the failover chain", () => {
  const p = createProvider({
    MAIL_PROVIDERS: "directmailmanager,click2mail,lob",
    DMM_API_KEY: "dmm_test_key",
    CLICK2MAIL_USERNAME: "u",
    CLICK2MAIL_PASSWORD: "p",
    LOB_API_KEY: "test_abc",
  });
  assert.equal(p.name, "failover(directmailmanager→click2mail→lob)");
});
