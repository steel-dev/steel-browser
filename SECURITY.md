# Security Policy

## Reporting a vulnerability

Please don't report security vulnerabilities in public issues, pull requests, discussions, or Discord.

Email [security@steel.dev](mailto:security@steel.dev) instead. Include as much of this as you can:

- The version, image tag, or commit you tested
- How you deploy Steel Browser and how it is exposed on the network
- Steps to reproduce, with raw requests and responses
- The impact, and the boundary it crosses (see [Security model](#security-model))

We'll reply by email and keep you updated until the issue is resolved. Please don't disclose the issue publicly until a fix is released.

## Supported versions

Only the latest release gets security fixes. Fixes land on `main` and ship in the next release. Please check that the issue still reproduces on the latest release or on `main`.

## Security model

Steel Browser is a single-instance browser control service. Its API intentionally lets callers navigate to any URL, scrape pages, control sessions, and use the Chrome DevTools Protocol (CDP) directly. It does not implement its own authentication.

Anyone who can reach the API can make the browser send network requests and read the responses. When you self-host Steel Browser:

- Don't expose ports `3000` (API and UI) and `9223` (debugger) to the public internet or other untrusted networks.
- Put your own authentication in front of it, such as a reverse proxy or a private network.
- Limit what the container can reach. For example, block cloud metadata endpoints such as `169.254.169.254`.

We assess reports against this model. A report that only shows what a direct API caller can already do through navigation, scraping, or CDP is not a vulnerability on its own. We still welcome hardening suggestions.

Steel Cloud is a separate deployment. Its API and gateway authenticate callers and route them to private browser instances. You can report Steel Cloud issues to the same address.
