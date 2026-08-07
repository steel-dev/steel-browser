import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { schemas } from "../../plugins/schemas.js";
import cdpRoutes from "./cdp.routes.js";

const DEBUGGER_URL = "https://browser.example.com/devtools/devtools_app.html";

/**
 * Builds a bare Fastify instance with only the CDP routes and a stubbed cdpService,
 * so the redirect can be asserted without booting a real browser.
 */
async function buildApp(debuggerWsUrl: string): Promise<FastifyInstance> {
  const app = Fastify();

  for (const schema of schemas) {
    app.addSchema(schema);
  }

  app.decorate("cdpService", {
    getDebuggerUrl: () => DEBUGGER_URL,
    getDebuggerWsUrl: (_pageId?: string) => debuggerWsUrl,
  } as FastifyInstance["cdpService"]);

  await app.register(cdpRoutes);
  await app.ready();

  return app;
}

describe("GET /devtools/inspector.html", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("uses the wss query param without the scheme when the endpoint is secure", async () => {
    app = await buildApp("wss://browser.example.com/devtools/page/page-123");

    const response = await app.inject({
      method: "GET",
      url: "/devtools/inspector.html?pageId=page-123",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `${DEBUGGER_URL}?wss=browser.example.com/devtools/page/page-123`,
    );
  });

  it("uses the ws query param without the scheme when the endpoint is insecure", async () => {
    app = await buildApp("ws://localhost:9223/devtools/page/page-123");

    const response = await app.inject({
      method: "GET",
      url: "/devtools/inspector.html?pageId=page-123",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `${DEBUGGER_URL}?ws=localhost:9223/devtools/page/page-123`,
    );
  });
});
