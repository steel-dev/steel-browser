# Steel REPL

This package provides a simple REPL to interact with the browser instance you've created using the API.

The API exposes a WebSocket endpoint, allowing you to connect to the browser using Chrome DevTools Protocol (CDP) and use Puppeteer as usual.

## Quick Start

1. Ensure you have **Steel Browser** running, either via Docker or locally.
2. Run `npm start` to execute the script.
3. Modify `src/script.ts` as needed and rerun `npm start` to see your changes.

> Note: You might need to update the WebSocket endpoint in `src/script.ts` if your services isn't exposed on your network

For more details, refer to [Steel Browser Documentation](https://docs.steel.dev/).