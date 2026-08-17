# Publishing a release

> **The pending 0.7.0 release is now security-relevant — sequence it with the API.**
> `mailsnail` 0.7.0 / `@mailsnail/core` 0.2.0 were staged but never published (npm
> still serves 0.6.0 / 0.1.0), so this release also carries the client half of the
> status-lookup fix: `send_letter` surfaces `receipt_token`, and `get_letter` accepts
> it. The managed API stops accepting raw job ids for status lookup, which means
> **published 0.6.0's `get_letter` will 404 against the managed service from the moment
> that API change deploys.** Publish this release at or before that deploy. Self-hosted
> gateways and BYO Click2Mail/Lob are unaffected — they still look up by job id, and
> the client still passes it through.

npm 2FA on this account is enforced at publish time and **granular-token 2FA
bypass does not work** (the "Bypass 2FA" checkbox silently doesn't stick, and the
resulting token 403s with *"granular access token with bypass 2fa enabled is
required"*). Web-login tokens and CI tokens authenticate fine — `npm whoami`
succeeds — and then still 403 on publish.

What works is a real TTY: `npm login` opens a browser for the passkey, and each
`npm publish` opens a WebAuthn `auth/cli` ceremony. One tap generally covers the
next couple of publishes, so do the whole set in one sitting.

An agent shell can't complete it either, though not for the reason you'd guess.
`npm login --auth-type=web` *does* work without a TTY — it prints a login URL and
polls, rather than falling back to a username prompt. But that URL carries a live
session token, so an agent harness redacts it on the way to disk; the link an
agent can hand you is `.../login/cli/***`, which 404s. Tried on 2026-07-21.

**Logging in yourself does not then let an agent publish.** A fresh `npm login`
leaves a valid token an agent shell happily reads — `npm whoami` returns
`iancollins27` from the agent side — but `npm publish` still fails `EOTP`
("requires a one-time password from your authenticator"). The WebAuthn ceremony
needs a TTY to launch the browser; with none, npm falls back to prompting for a
typed OTP and dies instantly. `winpty` does not rescue it: the agent shell has no
console attached, so winpty aborts with *"stdin is not a tty"*. Tried on
2026-08-11. Don't re-test this — the publishes are yours to run.

So: run this yourself, in PowerShell.

```powershell
cd "C:\Users\ian\Code Projects\mailsnail\oss"

npm login                        # passkey via browser
npm whoami                       # expect: iancollins27

# Order matters: gateway and mailsnail depend on core ^0.2.0.
cd packages\core
npm publish --access public

cd ..\gateway
npm publish --access public

cd ..\mailsnail
npm publish --access public
```

Then confirm what users actually get:

```powershell
npx -y mailsnail@latest doctor   # expect 0.7.0 behavior: a reachability report
npm view mailsnail version       # expect 0.7.0
```

## Making this unattended (worth doing once)

npm **Trusted Publishing** (OIDC) removes the passkey from the loop entirely: a
GitHub Actions workflow publishes with a short-lived token minted from the run's
identity, no secret stored anywhere and no 2FA prompt. Setup is one browser visit
per package (npmjs.com → package → Settings → Trusted Publishers → this repo +
the release workflow) plus a workflow file. After that, cutting a release is a
tag push, and an agent can do the whole thing.

## Official MCP registry

`server.json` carries the version separately, so the registry needs its own push
(also a device-flow login — start it only when you can approve immediately; the
code expires):

```powershell
cd "C:\Users\ian\Code Projects\mailsnail\oss\packages\mailsnail"
C:\Users\ian\mcp-publisher.exe login github
C:\Users\ian\mcp-publisher.exe publish
```

Ownership is proven by the `mcpName` field in `packages/mailsnail/package.json`
matching the server name — keep them in sync.

## Checklist

- [ ] `npm test` green at the repo root
- [ ] Versions bumped in `packages/*/package.json` **and** `server.json`
- [ ] Inter-package dependency ranges point at the new core version
- [ ] Publish core → gateway → mailsnail
- [ ] `npx -y mailsnail@latest doctor` behaves as expected
- [ ] `mcp-publisher publish` for the registry
