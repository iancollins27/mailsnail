import { LobProvider } from "./lob.js";
import { Click2MailProvider } from "./click2mail.js";
import { GatewayProvider } from "./gateway.js";
import { FailoverProvider } from "./router.js";

export const DEFAULT_MANAGED_URL = "https://api.mailsnail.dev";

function createOne(name, env, { allowLive }) {
  if (name === "managed") {
    return new GatewayProvider({
      baseUrl: env.MAIL_API_BASE_URL ?? DEFAULT_MANAGED_URL,
      name: "managed",
    });
  }

  if (name === "gateway") {
    // Self-hosted gateway: same wire protocol as managed, your URL, your creds.
    if (!env.MAIL_API_BASE_URL) {
      throw new Error(
        "MAIL_PROVIDER=gateway requires MAIL_API_BASE_URL pointing at your @mailsnail/gateway deployment.",
      );
    }
    return new GatewayProvider({ baseUrl: env.MAIL_API_BASE_URL, name: "gateway" });
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

  throw new Error(
    `Unknown provider: ${name}. Supported: managed, gateway, click2mail, lob.`,
  );
}

/**
 * Build a provider from environment config.
 *
 *   MAIL_PROVIDER=managed|gateway|click2mail|lob   — single provider
 *   MAIL_PROVIDERS=click2mail,lob                  — ordered failover chain
 *   MAIL_ALLOW_LIVE=1                              — allow real mail to move
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

export { LobProvider, Click2MailProvider, GatewayProvider, FailoverProvider };
