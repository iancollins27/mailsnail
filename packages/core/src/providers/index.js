import { LobProvider } from "./lob.js";
import { Click2MailProvider } from "./click2mail.js";
import { DirectMailManagerProvider } from "./directmailmanager.js";
import { GatewayProvider } from "./gateway.js";
import { FailoverProvider } from "./router.js";

export const DEFAULT_MANAGED_URL = "https://api.mailsnail.dev";

function createOne(name, env, { allowLive }) {
  if (name === "managed") {
    return new GatewayProvider({
      baseUrl: env.MAIL_API_BASE_URL ?? DEFAULT_MANAGED_URL,
      name: "managed",
      // Optional prepaid-account key. When set, sends debit the account balance and
      // get_balance/top_up work; when absent, behaviour is anonymous per-piece.
      apiKey: env.MAILSNAIL_API_KEY,
    });
  }

  if (name === "gateway") {
    // Self-hosted gateway: same wire protocol as managed, your URL, your creds.
    if (!env.MAIL_API_BASE_URL) {
      throw new Error(
        "MAIL_PROVIDER=gateway requires MAIL_API_BASE_URL pointing at your @mailsnail/gateway deployment.",
      );
    }
    return new GatewayProvider({
      baseUrl: env.MAIL_API_BASE_URL,
      name: "gateway",
      apiKey: env.MAILSNAIL_API_KEY,
    });
  }

  if (name === "lob") {
    const provider = new LobProvider({ apiKey: env.LOB_API_KEY });
    if (provider.isLive && !allowLive) {
      throw new Error(
        "Refusing to start: LOB_API_KEY is a live key but live mode is not enabled (set MAIL_ALLOW_LIVE=1).",
      );
    }
    return provider;
  }

  if (name === "click2mail") {
    return new Click2MailProvider({
      username: env.CLICK2MAIL_USERNAME,
      password: env.CLICK2MAIL_PASSWORD,
      allowLive,
    });
  }

  if (name === "directmailmanager") {
    // DMM keys are environment-specific, so allowLive picks the URL: sandbox
    // (never mails/bills) unless MAIL_ALLOW_LIVE=1, then the prod URL + prod key.
    const provider = new DirectMailManagerProvider({
      apiKey: env.DMM_API_KEY,
      sandbox: !allowLive,
    });
    if (provider.isLive && !allowLive) {
      throw new Error(
        "Refusing to start: DMM live mode without MAIL_ALLOW_LIVE=1.",
      );
    }
    return provider;
  }

  throw new Error(
    `Unknown provider: ${name}. Supported: managed, gateway, click2mail, lob, directmailmanager.`,
  );
}

/**
 * Build a provider from environment config.
 *
 *   MAIL_PROVIDER=managed|gateway|click2mail|lob|directmailmanager — single provider
 *   MAIL_PROVIDERS=directmailmanager,click2mail,lob                — ordered failover chain
 *   MAIL_ALLOW_LIVE=1                                              — allow real mail to move
 *
 * MAIL_PROVIDERS takes precedence over MAIL_PROVIDER. Each provider in the
 * chain reads its own credentials from the same env.
 */
export function createProvider(env = process.env) {
  const allowLive = env.MAIL_ALLOW_LIVE === "1";
  const spec = env.MAIL_PROVIDERS ?? env.MAIL_PROVIDER ?? "managed";
  const names = spec
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error("No provider configured (MAIL_PROVIDER / MAIL_PROVIDERS is empty).");
  }
  const providers = names.map((n) => createOne(n, env, { allowLive }));
  return providers.length === 1 ? providers[0] : new FailoverProvider(providers);
}

export {
  LobProvider,
  Click2MailProvider,
  DirectMailManagerProvider,
  GatewayProvider,
  FailoverProvider,
};
