# Singleton session lifecycle

The self-hosted API manages one active browser session. A creation request while
another session is live, starting, releasing, or awaiting cleanup returns HTTP
409. Release the owned session before creating its replacement. This change does
not introduce multiple isolated browsers or scoped CDP/viewer endpoints.

`POST /v1/sessions/:sessionId/release` now checks the active session ID, returning
404 for a mismatch without releasing another session. The explicit
`POST /v1/sessions/release` route retains its global release behavior. The
session-specific context and live-details handlers also check ownership before
and after asynchronous reads. Existing unknown-session details responses remain
compatible.

Session creation has a 45-second deadline, including proxy setup and session
hooks. CDP launch has a 60-second overall deadline shared across retries. The
native Puppeteer launch timeout is positive, at most 30 seconds, and capped by
the remaining deadline. Request abort or response closure during startup cancels
the operation; creation deadline failures return 504 and cancellation returns
408 when a response can still be delivered.

Cancellation fences subsequent launch steps and closes owned resources,
including a browser or proxy delivered after the deadline. Browser close is
bounded to five seconds, followed, when necessary, by killing only that browser's
owned process and waiting up to two seconds for its exit. Cleanup failure stops
retries. New operations remain blocked until outstanding work and cleanup settle;
unconfirmed cleanup quarantines the singleton rather than admitting another
launch. Non-cancellable third-party promises or plugins can therefore leave the
service reserved indefinitely. This is fail-closed behavior, not a guarantee
that arbitrary plugin code can be interrupted. Selenium and external plugin
process cancellation still require separate integration qualification.

A server timeout cannot resolve unknown HTTP delivery. Clients must still record
creation intent durably, send one creation POST, avoid automatic retries, and
retain uncertainty if the response is lost. Do not guess a session ID or use
global release to resolve an unknown outcome. No authentication, TLS, proxy,
network policy, or viewer isolation behavior changes here.

The lifecycle tests use fake browsers, processes, proxies, timers, and isolated
Fastify requests; they do not create real browser sessions. Run from `api`:

```sh
../node_modules/.bin/vitest run
../node_modules/.bin/tsc --noEmit -p tsconfig.json
```

These checks qualify the source candidate. They do not qualify a Docker image,
native application integration, or concurrent isolated-session support.
