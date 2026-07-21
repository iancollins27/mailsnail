#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createProvider,
  diagnose,
  formatDiagnosis,
  ProviderError,
  NotSupported,
} from "@mailsnail/core";

const pkg = createRequire(import.meta.url)("../package.json");

const SPEND_CAP_USD = Number(process.env.MAIL_MCP_SPEND_CAP_USD ?? "25");

// MAIL_MCP_ALLOW_LIVE is this server's documented flag; core reads the
// provider-neutral MAIL_ALLOW_LIVE. Honor both.
const env = {
  ...process.env,
  MAIL_ALLOW_LIVE:
    process.env.MAIL_MCP_ALLOW_LIVE ?? process.env.MAIL_ALLOW_LIVE,
};

// CLI subcommands. MCP clients launch this with no arguments and get the stdio
// server; a human running `npx mailsnail doctor` gets the preflight instead.
const [command, ...commandArgs] = process.argv.slice(2);

const USAGE = `mailsnail ${pkg.version}

  npx mailsnail             start the MCP server on stdio (what MCP clients do)
  npx mailsnail doctor      check connectivity to the configured mail backend
                            (--json for machine-readable output)
  npx mailsnail --version   print version
`;

if (command === "doctor") {
  const report = await diagnose({ env });
  console.log(
    commandArgs.includes("--json")
      ? JSON.stringify(report, null, 2)
      : formatDiagnosis(report),
  );
  process.exit(report.ok ? 0 : 1);
}

if (command === "help" || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(pkg.version);
  process.exit(0);
}

// A typo'd subcommand must not silently boot a stdio server that then looks hung.
if (command && !command.startsWith("-")) {
  console.error(`[mailsnail] unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

let provider;
try {
  provider = createProvider(env);
} catch (err) {
  console.error(`[mailsnail] ${err.message}`);
  process.exit(1);
}

let spentCents = 0;
const ESTIMATED_COST_CENTS = {
  letter: 100,
  certified_letter: 700,
  postcard: 65,
};

function checkSpend(kind) {
  if (!provider.isLive) return;
  const next = spentCents + (ESTIMATED_COST_CENTS[kind] ?? 200);
  if (next > Math.round(SPEND_CAP_USD * 100)) {
    throw new Error(
      `Per-session spend cap of $${SPEND_CAP_USD} would be exceeded. Raise MAIL_MCP_SPEND_CAP_USD or restart the server.`,
    );
  }
  spentCents = next;
}

const AddressSchema = z.object({
  name: z.string().min(1).describe("Full name of recipient or sender"),
  company: z.string().optional(),
  address_line1: z.string().min(1),
  address_line2: z.string().optional(),
  address_city: z.string().min(1),
  address_state: z.string().min(2).max(2).describe("Two-letter US state code"),
  address_zip: z.string().min(5),
  address_country: z.string().default("US"),
});

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err) {
  const payload = {
    error: err.message,
    provider: err instanceof ProviderError ? err.provider : provider.name,
    status: err instanceof ProviderError ? err.status : undefined,
    // Transport-level flavor (unreachable / egress_blocked / tls_untrusted).
    // Present means the request never reached the backend: nothing mailed,
    // nothing charged, and the fix is in this environment's network — not the
    // account. See the `doctor` tool.
    code: err.code,
    hint: err.hint,
    not_supported: err instanceof NotSupported ? err.capability : undefined,
    payment_required: err.payment_required,
  };
  if (err.code) payload.next_step = "Run the `doctor` tool for a full connectivity report.";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

const server = new McpServer({
  name: "mailsnail",
  version: pkg.version,
});

server.tool(
  "doctor",
  "Preflight: check that this server can actually reach its mail backend, and report exactly what to allowlist if it can't. FREE and read-only — never charges, never mails. Run this FIRST in sandboxed, CI, or corporate-network environments, and any time another tool fails with a `code` of `unreachable`, `egress_blocked`, or `tls_untrusted` (those mean the request never reached the backend, so the problem is network policy, not the account or the letter).",
  {},
  async () => {
    try {
      return ok(await diagnose({ env, provider }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "verify_address",
  "Verify and normalize a US mailing address. Run this on user-provided addresses before sending mail.",
  {
    address_line1: z.string(),
    address_line2: z.string().optional(),
    address_city: z.string().optional(),
    address_state: z.string().optional(),
    address_zip: z.string().optional(),
  },
  async (input) => {
    try {
      return ok(await provider.verifyAddress(input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "preview_letter",
  "Generate a PROOF of a letter WITHOUT charging or mailing. Returns `proof_url` (a viewable PDF of exactly what will be printed and mailed, including the address cover sheet), the CASS-verified recipient address, the exact price, and a `draft_id`. Best practice: call this FIRST, show the user the proof_url and price, get explicit confirmation, then call send_letter with the returned draft_id + a payment_token. Managed/gateway mode only.",
  {
    to: AddressSchema,
    from: AddressSchema,
    body_text: z
      .string()
      .optional()
      .describe("Plain text body. Rendered to a letter-sized PDF server-side. Managed/gateway provider only."),
    file_url: z
      .string()
      .url()
      .optional()
      .describe("Public URL to a pre-rendered PDF letter. Letter-size 8.5x11 expected."),
    color: z.boolean().default(false),
    double_sided: z.boolean().default(true),
    extra_service: z
      .enum(["certified", "registered", "certified_return_receipt"])
      .optional()
      .describe("Adds tracking. `certified` for legal/compliance mail."),
    description: z.string().optional(),
  },
  async (input) => {
    try {
      return ok(await provider.preview(input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "send_letter",
  "Send a physical letter via USPS. RECOMMENDED FLOW: first call preview_letter, show the user the returned proof_url + price, get explicit confirmation, then call send_letter with the returned `draft_id` and a `payment_token` — this charges and mails exactly the proofed letter. You may also send one-shot by providing the full letter (to, from, and body_text or file_url) plus payment_token, without a draft_id. `body_text` (plain text, rendered server-side) is managed/gateway-mode only; click2mail/lob require file_url. Use `extra_service: 'certified'` for certified mail (recommended for legal notices).",
  {
    draft_id: z
      .string()
      .optional()
      .describe(
        "Confirm a letter previewed via preview_letter. Provide this plus payment_token to charge and mail exactly that proof. Omit for a one-shot send.",
      ),
    to: AddressSchema.optional(),
    from: AddressSchema.optional(),
    body_text: z
      .string()
      .optional()
      .describe(
        "Plain text body of the letter. Newlines preserved. Rendered to a letter-sized PDF server-side. Managed/gateway provider only.",
      ),
    file_url: z
      .string()
      .url()
      .optional()
      .describe("Public URL to a pre-rendered PDF letter. Letter-size 8.5x11 expected."),
    color: z.boolean().default(false),
    double_sided: z.boolean().default(true),
    extra_service: z
      .enum(["certified", "registered", "certified_return_receipt"])
      .optional()
      .describe(
        "Adds tracking. `certified` is the most common; useful for legal/compliance mail.",
      ),
    description: z.string().optional(),
    payment_token: z
      .string()
      .optional()
      .describe(
        "Stripe Shared Payment Token (spt_...). OPTIONAL: if your managed account has a prepaid balance (see get_balance/top_up), the piece is debited from it automatically and no payment_token is needed. Provide one to pay this piece one-off instead. If omitted with no/insufficient balance, you get a payment_required error offering top-up OR per-piece payment.",
      ),
  },
  async (input) => {
    try {
      checkSpend(input.extra_service ? "certified_letter" : "letter");
      return ok(await provider.sendLetter(input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "send_postcard",
  "Send a physical postcard. Provide a public URL to a PDF (front + back combined for Click2Mail; separate front/back for Lob).",
  {
    to: AddressSchema,
    from: AddressSchema,
    front_url: z.string().url().describe("URL to PDF for the postcard front (or combined front+back for Click2Mail)."),
    back_url: z.string().url().optional().describe("URL to PDF for the postcard back. Required for Lob; ignored for Click2Mail."),
    size: z.enum(["4x6", "6x9", "6x11"]).default("4x6"),
    description: z.string().optional(),
    payment_token: z
      .string()
      .optional()
      .describe(
        "Stripe Shared Payment Token (spt_...). OPTIONAL: if your managed account has a prepaid balance (see get_balance/top_up), the piece is debited from it automatically and no payment_token is needed. Provide one to pay this piece one-off instead. If omitted with no/insufficient balance, you get a payment_required error offering top-up OR per-piece payment.",
      ),
  },
  async (input) => {
    try {
      checkSpend("postcard");
      return ok(await provider.sendPostcard(input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_balance",
  "Get your managed prepaid balance (in cents). Managed mode with a MAILSNAIL_API_KEY only. When you hold a balance, send_letter/send_postcard debit it automatically with no payment_token and no per-send Stripe fee.",
  {},
  async () => {
    try {
      if (typeof provider.getBalance !== "function") {
        throw new NotSupported(provider.name, "getBalance");
      }
      return ok(await provider.getBalance());
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "top_up",
  "Add funds to your managed prepaid balance. `method` defaults to 'stripe.spt': pass a `payment_token` (spt_...) minted for `amount_cents` to credit instantly. Without a payment_token you get a payment_required challenge quoting the amount to mint an SPT for. 'stripe.ach'/'x402' are async/returned as pending. Managed mode with a MAILSNAIL_API_KEY only.",
  {
    amount_cents: z.number().int().positive().describe("Top-up amount in USD cents (e.g. 5000 = $50)."),
    method: z
      .enum(["stripe.spt", "stripe.ach", "x402"])
      .optional()
      .describe("Funding rail. Defaults to stripe.spt (card via Shared Payment Token)."),
    payment_token: z
      .string()
      .optional()
      .describe("Stripe Shared Payment Token (spt_...) minted for amount_cents. Required for stripe.spt to credit instantly."),
  },
  async (input) => {
    try {
      if (typeof provider.topUp !== "function") {
        throw new NotSupported(provider.name, "topUp");
      }
      return ok(await provider.topUp(input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_letter",
  "Fetch the status of a previously sent letter by id.",
  { id: z.string().describe("Provider letter/job id.") },
  async ({ id }) => {
    try {
      return ok(await provider.getLetter(id));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "list_letters",
  "List recent letters (Lob only — Click2Mail does not expose a list endpoint).",
  {
    limit: z.number().int().min(1).max(100).default(20),
    before: z.string().optional(),
    after: z.string().optional(),
  },
  async (input) => {
    try {
      return ok(await provider.listLetters(input));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "cancel_letter",
  "Cancel a letter before it enters production. Cancellation windows are short and provider-specific.",
  { id: z.string().describe("Provider letter/job id.") },
  async ({ id }) => {
    try {
      return ok(await provider.cancelLetter(id));
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[mailsnail] ready (provider=${provider.name}, mode=${provider.isLive ? "LIVE" : "TEST"}, spend_cap=$${SPEND_CAP_USD})`,
);
