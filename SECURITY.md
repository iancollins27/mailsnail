# Security

## Reporting a problem

Email [hello@mailsnail.dev](mailto:hello@mailsnail.dev?subject=Security) with "Security" in the subject line. Tell us what you found, where, and how to reproduce it. If the problem exposes someone's letter, address or payment details, describe it without sending us the data itself.

Please do not open a public issue for a security problem. We read every report and investigate it. When you test, use your own account and your own addresses, and please give us the chance to fix a problem before you describe it in public.

The same policy is on the site at [mailsnail.dev/contact#security](https://mailsnail.dev/contact#security), and [mailsnail.dev/.well-known/security.txt](https://mailsnail.dev/.well-known/security.txt) names the contact.

## What this covers

- The hosted service: `api.mailsnail.dev` (the MCP server and the API behind it) and `mailsnail.dev`.
- The code in this repository: `@mailsnail/core`, `@mailsnail/gateway`, the `mailsnail` MCP server and the plugin in `plugins/mailsnail`.

## Supported versions

Fixes go into the latest release of each package on npm. The hosted service always runs the current code, so there is nothing to update there.
