# Steel Browser — Concurrent Multi-Session Fork

This is a modified fork of [steel-browser](https://github.com/steel-dev/steel-browser) (MIT license) that adds **concurrent multi-session support** within a single Docker container.

The upstream open-source version supports only a single active browser session at a time. This fork introduces a `BrowserPool` that manages multiple independent Chromium instances, each on its own CDP port, allowing N sessions to run simultaneously.

---

## Quick Start (Pre-Built Image)

If the image has already been built (tagged `steel-browser-api:latest`), start it with docker compose:

```bash
# From the steel-browser/ directory
MAX_SESSIONS=5 CDP_PORT_BASE=9222 DOMAIN=localhost:3000 \
  docker compose -f docker-compose.dev.yml up -d api
```

Or with the production compose file (uses the published GHCR image — note: the published image does **not** include these concurrency changes):

```bash
docker compose up -d api
```

### PowerShell (Windows)

```powershell
$env:MAX_SESSIONS = "5"
$env:CDP_PORT_BASE = "9222"
$env:DOMAIN = "localhost:3000"
docker compose -f docker-compose.dev.yml up -d api
```

The API will be available at `http://localhost:3000`.

---

## Building from Source

```bash
# From the steel-browser/ directory
docker compose -f docker-compose.dev.yml up -d --build api
```

This builds the image from `./api/Dockerfile` and starts the container. The build takes 5–15 minutes depending on network speed (it downloads Chromium inside the image).

### Build with custom settings

```bash
MAX_SESSIONS=10 CDP_PORT_BASE=9222 DOMAIN=localhost:3000 \
  docker compose -f docker-compose.dev.yml up -d --build api
```

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `MAX_SESSIONS` | `5` | Maximum number of concurrent browser sessions |
| `CDP_PORT_BASE` | `9222` | Base port for Chrome DevTools Protocol. Each session gets its own port: `CDP_PORT_BASE`, `CDP_PORT_BASE+1`, ..., `CDP_PORT_BASE+N-1` |
| `DOMAIN` | `localhost:3000` | Domain used to construct session URLs (debug, websocket, etc.) |
| `CDP_DOMAIN` | `localhost:9223` | Domain for external CDP access |

Sessions are allocated on demand — no memory or processes are pre-allocated. Setting `MAX_SESSIONS` to a high number is safe; each Chromium instance only launches when a session is created and shuts down when it is released. A single Chromium instance uses roughly **100–300 MB RAM** depending on page complexity.

### Docker resource requirements

- **`shm_size: "2gb"`** is set in both compose files. Chrome requires shared memory for rendering; without it, tabs will crash. Scale this up if running many sessions with heavy pages.
- **RAM**: Budget ~300 MB per concurrent session plus ~200 MB for the Node.js API server. For `MAX_SESSIONS=5`, allocate at least 2 GB to the container.

---

## API Usage

### Create a session

```bash
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response:

```json
{
  "id": "7ffb628a-bbd3-4363-950b-9972763ad81a",
  "status": "live",
  "websocketUrl": "ws://localhost:3000/v1/sessions/7ffb628a-.../cdp",
  "debugUrl": "http://localhost:3000/v1/sessions/7ffb628a-.../debug",
  "dimensions": { "width": 1920, "height": 1080 },
  "createdAt": "2026-03-15T00:15:25.531Z"
}
```

### List active sessions

```bash
curl http://localhost:3000/v1/sessions
```

### Get session details

```bash
curl http://localhost:3000/v1/sessions/{sessionId}
```

### Get live details (pages, browser state)

```bash
curl http://localhost:3000/v1/sessions/{sessionId}/live-details
```

### Release a session

```bash
curl -X POST http://localhost:3000/v1/sessions/{sessionId}/release
```

### Health check

```bash
curl http://localhost:3000/v1/health
```

Response includes pool status:

```json
{
  "status": "ok",
  "activeSessions": 2,
  "maxSessions": 5
}
```

### Pool exhaustion

When all slots are occupied, creating a new session returns **HTTP 503**:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "Session pool is full (max 5 sessions). Release an existing session and retry."
}
```

---

## Live Preview

Each session has a live screencast accessible in a browser:

```
http://localhost:3000/v1/sessions/{sessionId}/debug
```

Query parameters:
- `interactive=true|false` — enable/disable mouse/keyboard input forwarding
- `showControls=true|false` — show/hide the control bar
- `pageId={id}` or `pageIndex={n}` — target a specific tab

### Side-by-side preview

To view multiple sessions at once, embed iframes pointing to each session's debug URL. The test suite includes a `live-viewer.html` generator that does exactly this — see the Testing section below.

---

## Connecting via Puppeteer / Playwright

Each session exposes a session-specific WebSocket endpoint for CDP connections:

```javascript
import puppeteer from "puppeteer-core";

// Create a session first via the REST API, then connect:
const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://localhost:3000/v1/sessions/{sessionId}/cdp",
});

const page = (await browser.pages())[0];
await page.goto("https://example.com");
console.log(await page.title());

browser.disconnect(); // disconnect (don't close — the session keeps running)
```

For Playwright:

```javascript
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP(
  "ws://localhost:3000/v1/sessions/{sessionId}/cdp"
);
```

---

## Architecture

### What changed from upstream

The upstream steel-browser uses a **singleton** `CDPService` — one Chrome instance, one session at a time. This fork replaces that with:

1. **`BrowserPool`** (`api/src/services/browser-pool.service.ts`) — manages an array of `PoolSlot` objects, each containing a `CDPService` instance with a unique `--remote-debugging-port`. Slots are acquired/released by session ID.

2. **`SessionService`** — refactored from tracking a single `activeSession` to a `Map<string, Session>`. Each `Session` holds a reference to its own `CDPService` from the pool.

3. **Session-aware URL generation** — `getSessionUrl(sessionId, path, protocol)` constructs unique `websocketUrl` and `debugUrl` per session (e.g., `/v1/sessions/{id}/cdp`, `/v1/sessions/{id}/debug`).

4. **WebSocket routing** — the `WebSocketRegistry` matches incoming connections to the correct session via URL pattern matching (`/v1/sessions/:id/cast`, `/v1/sessions/:id/cdp`), then proxies to the correct Chrome instance.

5. **Casting handler** — connects Puppeteer to the session-specific Chrome via `cdpService.getWsEndpoint()` rather than a hardcoded port.

### Changed files

| File | Change |
|---|---|
| `api/src/services/browser-pool.service.ts` | **New.** Pool of CDPService instances |
| `api/src/services/session.service.ts` | Singleton → Map-based multi-session |
| `api/src/services/cdp/cdp.service.ts` | Parameterized `--remote-debugging-port`; added `getWsEndpoint()` |
| `api/src/env.ts` | Added `MAX_SESSIONS`, `CDP_PORT_BASE` |
| `api/src/utils/url.ts` | Added `getSessionUrl()` |
| `api/src/plugins/browser.ts` | Instantiates `BrowserPool` instead of singleton `CDPService` |
| `api/src/plugins/browser-session.ts` | Passes `browserPool` to `SessionService` |
| `api/src/modules/sessions/sessions.controller.ts` | Session-ID-aware handlers; 503 on pool full |
| `api/src/modules/sessions/sessions.routes.ts` | Added `/sessions/:sessionId/debug`; health reports pool stats |
| `api/src/services/websocket-registry.service.ts` | Added `matchHandlerWithSession()` for URL-based session routing |
| `api/src/plugins/browser-socket/browser-socket.ts` | Session-aware WebSocket upgrade routing |
| `api/src/plugins/browser-socket/casting.handler.ts` | Connects to session-specific Chrome via `getWsEndpoint()` |
| `api/src/types/fastify.d.ts` | Added `browserPool` to FastifyInstance |
| `api/src/types/websocket.ts` | Added `sessionId` to WebSocketHandlerContext |
| `api/src/steel-browser-plugin.ts` | Registered `browserPool` decorator |
| `docker-compose.yml` | Added `shm_size`, `MAX_SESSIONS`, `CDP_PORT_BASE` |
| `docker-compose.dev.yml` | Same as above (build variant) |

### Backward compatibility

- The Fastify instance still exposes `server.cdpService` pointing to the first pool slot's CDPService, so any legacy code referencing it continues to work.
- Routes that don't specify a session ID fall back to using the first active session.

---

## Testing

A comprehensive test suite lives in `../test-steel-browser-concurrency/`.

### Concurrency test (`test-concurrency.ts`)

An 8-step automated test that validates:

1. **Health check** — API reports `activeSessions=0`, `maxSessions=N`
2. **Concurrent session creation** — creates N sessions, verifies unique IDs and session-specific URLs
3. **List sessions** — `GET /v1/sessions` returns all N
4. **Pool exhaustion** — session N+1 returns HTTP 503
5. **CDP connections** — Puppeteer connects to each session, navigates to different URLs, verifies isolation
6. **Live details** — `GET /v1/sessions/:id/live-details` returns pages and browserState
7. **Release & reuse** — releases one session, creates a new one in the freed slot
8. **Teardown** — releases all, verifies list is empty

Run it (with the container already running):

```bash
cd test-steel-browser-concurrency
npm install
npx tsx test-concurrency.ts
```

### Mouse movement demo (`test-mouse-movement.ts`)

Creates 3 sessions, navigates each to a different page, injects a colored cursor indicator, and moves the mouse to random coordinates every 3 seconds for 60 seconds. Generates `live-viewer.html` — a side-by-side live preview page — and opens it in the default browser.

```bash
npx tsx test-mouse-movement.ts
```

### Full orchestrated run (`run-tests.ps1`)

PowerShell script that handles the full lifecycle: tear down existing containers, build and start the image, install dependencies, run the test suite, and tear down.

```powershell
cd test-steel-browser-concurrency
.\run-tests.ps1
```

---

## Stopping

```bash
docker compose -f docker-compose.dev.yml down
```

To also remove volumes:

```bash
docker compose -f docker-compose.dev.yml down -v
```
