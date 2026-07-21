# Publishing a release

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
