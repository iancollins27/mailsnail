import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAddress,
  validateLetterRequest,
  validatePostcardRequest,
} from "../src/schema.js";

const addr = {
  name: "Jane Doe",
  address_line1: "123 Main St",
  address_city: "Springfield",
  address_state: "IL",
  address_zip: "62701",
};

test("validateAddress accepts a complete address", () => {
  assert.equal(validateAddress(addr, "to"), null);
});

test("validateAddress names the missing field", () => {
  const { address_zip, ...partial } = addr;
  assert.match(validateAddress(partial, "to"), /to\.address_zip/);
  assert.match(validateAddress(null, "from"), /from is required/);
});

test("letter requires exactly one of file_url / body_text", () => {
  const base = { to: addr, from: addr };
  assert.match(validateLetterRequest(base), /file_url or body_text/);
  assert.equal(validateLetterRequest({ ...base, body_text: "hi" }), null);
  assert.equal(
    validateLetterRequest({ ...base, file_url: "https://x.test/a.pdf" }),
    null,
  );
  assert.match(
    validateLetterRequest({ ...base, body_text: "hi", file_url: "https://x.test/a.pdf" }),
    /only one/,
  );
});

test("postcard requires front_url", () => {
  assert.match(validatePostcardRequest({ to: addr, from: addr }), /front_url/);
  assert.equal(
    validatePostcardRequest({ to: addr, from: addr, front_url: "https://x.test/f.pdf" }),
    null,
  );
});
