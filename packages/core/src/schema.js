/**
 * Request validation for the Mailsnail mail-piece shapes.
 *
 * These mirror spec/mailpiece.schema.json at the repo root — the JSON Schema
 * documents the wire format; this module is the runtime implementation used
 * by the gateway and available to any consumer. Keep the two in sync.
 */

export const ADDRESS_FIELDS = [
  "name",
  "address_line1",
  "address_city",
  "address_state",
  "address_zip",
];

export function validateAddress(addr, label = "address") {
  if (!addr || typeof addr !== "object") return `${label} is required`;
  for (const f of ADDRESS_FIELDS) {
    if (!addr[f]) return `${label}.${f} is required`;
  }
  return null;
}

export function validateLetterRequest(body) {
  if (!body) return "request body is required";
  const e1 = validateAddress(body.to, "to");
  if (e1) return e1;
  const e2 = validateAddress(body.from, "from");
  if (e2) return e2;
  if (!body.file_url && !body.body_text) {
    return "either file_url or body_text is required";
  }
  if (body.file_url && body.body_text) {
    return "provide only one of file_url or body_text, not both";
  }
  return null;
}

export function validatePostcardRequest(body) {
  if (!body) return "request body is required";
  const e1 = validateAddress(body.to, "to");
  if (e1) return e1;
  const e2 = validateAddress(body.from, "from");
  if (e2) return e2;
  if (!body.front_url) return "front_url is required";
  return null;
}
