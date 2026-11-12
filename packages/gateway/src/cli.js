#!/usr/bin/env node
// Run a Mailsnail gateway from env config.
//
//   MAIL_PROVIDER=click2mail CLICK2MAIL_USERNAME=... CLICK2MAIL_PASSWORD=... \
//   MAIL_ALLOW_LIVE=0 npx mailsnail-gateway
//
// MAIL_API_ALLOW_LIVE is honored as an alias of MAIL_ALLOW_LIVE for parity
// with the managed deployment's env naming.

import { createProvider } from "@mailsnail/core";
import { createGatewayApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;

const env = {
  ...process.env,
  MAIL_ALLOW_LIVE: process.env.MAIL_ALLOW_LIVE ?? process.env.MAIL_API_ALLOW_LIVE,
};

// A self-hosted gateway must talk to a real print provider — pointing it at
// another gateway (managed mode) would just be a proxy. Default to requiring
// an explicit provider choice.
if (!env.MAIL_PROVIDER && !env.MAIL_PROVIDERS) {
  console.error(
    "[mailsnail-gateway] set MAIL_PROVIDER=click2mail|lob (or MAIL_PROVIDERS=a,b for failover) plus that provider's credentials.",
  );
  process.exit(1);
}

let provider;
try {
  provider = createProvider(env);
} catch (err) {
  console.error(`[mailsnail-gateway] ${err.message}`);
  process.exit(1);
}

const app = createGatewayApp({ provider, publicBaseUrl: PUBLIC_BASE_URL });

app.listen(PORT, () => {
  console.error(
    `[mailsnail-gateway] listening on ${PORT} (provider=${provider.name}, mode=${provider.isLive ? "LIVE" : "TEST"}, public=${PUBLIC_BASE_URL})`,
  );
});
