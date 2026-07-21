# Publishing a release

npm 2FA on this account is enforced at publish time and **granular-token 2FA
bypass does not work** (the "Bypass 2FA" checkbox silently doesn't stick, and the
resulting token 403s with *"granular access token with bypass 2fa enabled is
required"*). Web-login tokens and CI tokens authenticate fine — `npm whoami`
succeeds — and then still 403 on publish.

What works is a real TTY: `npm login` opens a browser for the passkey, and each
`npm publish` opens a WebAuthn `auth/cli` ceremony. One tap generally covers the
next couple of publishes, so do the whole set in one sitting.

An agent shell can't host that ceremony. Run this yourself, in PowerShell:

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
