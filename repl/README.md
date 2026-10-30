# Steel REPL

This package provides simple scripts to interact with the browser instance you've created using the API.

- `npm start` runs `src/script.ts`. The API exposes a WebSocket endpoint, allowing you to connect to the browser using Chrome DevTools Protocol (CDP) and use Puppeteer as usual.
- `npm run commands` runs `src/commands.ts`. It drives the browser with the [Commands API](../docs/COMMANDS.md).
- `npm run demo` runs `src/demo.ts`. It records the demo GIF in the main README.

## Quick Start

1. Ensure you have **Steel Browser** running, either via Docker or locally.
2. Run `npm install` at the repo root to install the dependencies.
3. Run `npm start` in this folder to execute the script.
4. Modify `src/script.ts` as needed and rerun `npm start` to see your changes.

The script connects to `ws://localhost:3000`. Set `STEEL_WS_URL` to connect to another server:

```bash
STEEL_WS_URL=ws://192.168.1.20:3000 npm start
```

## Commands API

The Commands API is experimental and off by default. Start the server with `ENABLE_COMMANDS_API=true`:

```bash
# Docker
docker run -e ENABLE_COMMANDS_API=true -p 3000:3000 -p 9223:9223 ghcr.io/steel-dev/steel-browser

# Local, from the repo root
ENABLE_COMMANDS_API=true npm run dev -w api
```

Then run the example:

```bash
npm run commands
```

It creates a session, opens https://example.com, prints an interactive snapshot, clicks the first link by its ref, and releases the session. It calls `http://localhost:3000` by default. Set `STEEL_API_URL` to use another server.

For more details, refer to the [Commands API docs](../docs/COMMANDS.md) and the [Steel Browser Documentation](https://docs.steel.dev/).
