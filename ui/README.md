# Steel Browser UI

The dashboard the API serves at `/ui`. It shows the live browser, session details, logs, and Chrome DevTools for the active session, and it can start a new session.

## Development

Start the API on port 3000, then run:

```bash
npm run dev -w ui
```

The dev server proxies `/api` and `/ws` to `http://localhost:3000`.

## Configuration

| Variable       | Default | Purpose                            |
| -------------- | ------- | ---------------------------------- |
| `VITE_API_URL` | `/api`  | Base URL for HTTP requests         |
| `VITE_WS_URL`  | `/ws`   | Base URL for WebSocket connections |

The combined Docker image builds with both set to an empty string, so the UI talks to the API on the same origin.

## Dependencies

The UI ships React and nothing else at runtime. Styles are plain CSS. Dev tooling is Vite, the React plugin, and TypeScript, with exact versions pinned.

`src/styles/tokens.css` holds a snapshot of Steel's design tokens: colors, fonts, radii, and shadows. Components only reference these variables, so a visual refresh means editing this one file.

The fonts are Inter and Geist Mono, both under the SIL Open Font License. The font files and their licenses live in `src/fonts`.

## API types

`src/client` holds types generated from `api/openapi/schemas.json`. Regenerate them after the API schema changes:

```bash
npm run generate-api -w ui
```

The generator runs through `npx` at a pinned version, so it is not installed with the project. The script pins TypeScript for it too, because TypeScript 7 breaks the generator. `--prefix=/` makes npx install that TypeScript instead of reusing the project's copy, which the generator can't load. Prettier then formats the output.
