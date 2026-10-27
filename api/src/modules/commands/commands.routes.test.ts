import fastifySwagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { CDPService } from "../../services/cdp/cdp.service.js";
import type { EngineHost } from "../../services/commands/engine.js";
import { ShutdownReason, type BasePlugin } from "../../services/cdp/plugins/core/base-plugin.js";
import type { SessionService } from "../../services/session.service.js";
import type { BrowserLauncherOptions } from "../../types/browser.js";
import { schemas } from "../../plugins/schemas.js";
import actionsRoutes from "../actions/actions.routes.js";
import sessionsRoutes from "../sessions/sessions.routes.js";
import commandsRoutes, { createCommandEngine } from "./commands.routes.js";
import commandsSchemas from "./commands.schema.js";

const chrome = process.env.CHROME_EXECUTABLE_PATH;

describe.skipIf(!chrome)("commands route", () => {
  let browser: Browser;
  let page: Page;
  let app: FastifyInstance;
  let plugin: BasePlugin;
  const session = { id: "live", status: "live" };
  const config = {} as BrowserLauncherOptions;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox"],
    });
    page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.setContent(`<button onclick="document.title = 'clicked'">Go</button>`);
    app = Fastify();
    app.decorate("cdpService", {
      getBrowserInstance: () => browser,
      waitForPageSetup: async () => undefined,
      registerPlugin: (registered: BasePlugin) => {
        plugin = registered;
      },
    } as unknown as CDPService);
    app.decorate("sessionService", { activeSession: session } as unknown as SessionService);
    app.decorate("commandEngine", createCommandEngine(app));
    for (const schema of schemas) {
      app.addSchema(schema);
    }
    await app.register(fastifySwagger, {
      openapi: { info: { title: "Commands", version: "1" } },
      refResolver: { buildLocalReference: (json) => String(json.$id) },
    });
    await app.register(actionsRoutes, { prefix: "/v1" });
    await app.register(sessionsRoutes, { prefix: "/v1" });
    await app.register(commandsRoutes, { prefix: "/v1" });
    await app.ready();
    await plugin.onSessionStart(config);
    await plugin.onBrowserReady(config);
  });

  afterAll(async () => {
    await app?.close();
    await browser?.close();
  });

  function post(sessionId: string, body: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/commands`,
      payload: body as object,
      headers,
    });
  }

  test("rejects a session that is not active", async () => {
    const response = await post("old", { commands: { command: "snapshot" } });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: { code: "session_ended" } });
  });

  test("rejects an invalid body", async () => {
    const response = await post("live", { commands: { command: "teleport", to: "moon" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("snapshots and clicks through the route", async () => {
    const snapshot = await post("live", { commands: [{ command: "snapshot" }] });
    expect(snapshot.statusCode).toBe(200);
    const ref = snapshot.json().results[0].snapshot.match(/button "Go" \[ref=(e\d+)\]/)[1];
    const click = await post(
      "live",
      { commands: { command: "click", target: ref } },
      { "idempotency-key": "route-1" },
    );
    expect(click.json()).toMatchObject({
      page: { tab: "t1", title: "clicked" },
      execution: { state: "completed", effect: "applied", replayed: false },
    });
    const replay = await post(
      "live",
      { commands: { command: "click", target: ref } },
      { "idempotency-key": "route-1" },
    );
    expect(replay.json()).toMatchObject({
      next: click.json().next,
      execution: { id: click.json().execution.id, replayed: true },
    });
  });

  test("answers a dialog in the documented shape", async () => {
    await page.setContent(
      `<button onclick="document.title = String(confirm('Sure?'))">Ask</button>`,
    );
    const clicked = await post("live", {
      commands: { command: "click", target: { role: "button", name: "Ask" } },
    });
    expect(commandsSchemas.CommandResponse.safeParse(clicked.json()).success).toBe(true);
    const answered = await post("live", {
      commands: { command: "dialog", dialog: clicked.json().dialog.id, action: "accept" },
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({ answered: { accepted: true, by: "command" } });
    expect(commandsSchemas.CommandDialogResponse.safeParse(answered.json()).success).toBe(true);
    const spec = app.swagger() as {
      paths: Record<string, { post: { responses: Record<string, any> } }>;
    };
    const ok = spec.paths["/v1/sessions/{sessionId}/commands"].post.responses["200"];
    expect(
      ok.content["application/json"].schema.anyOf.map((schema: { $ref: string }) => schema.$ref),
    ).toEqual([
      "#/components/schemas/CommandResponse",
      "#/components/schemas/CommandDialogResponse",
    ]);
  });

  test("publishes the request schema", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sessions/live/commands/schema" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBe(1);
    expect(JSON.stringify(body.schema)).toContain('"navigate"');
    expect(JSON.stringify(body.schema)).toContain('"eventsAfter"');
  });

  test("lets quick actions run between commands and reports them as a change", async () => {
    const listed = await post("live", { commands: { command: "tab", action: "list" } });
    for (const action of ["scrape", "sessions/scrape", "sessions/screenshot", "sessions/pdf"]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/${action}`,
        payload: { url: "https://example.com" },
      });
      expect(response.statusCode, action).not.toBe(409);
    }
    const later = await post("live", {
      commands: { command: "tab", action: "list" },
      after: listed.json().next,
    });
    expect(later.json()).toMatchObject({ epochChanged: true });
  });

  test("refuses quick actions while commands run", async () => {
    await plugin.onSessionStart(config);
    await plugin.onBrowserReady(config);
    const running = post("live", { commands: { command: "wait", ms: 1000 } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const during = await app.inject({
      method: "POST",
      url: "/v1/scrape",
      payload: { url: "https://example.com" },
    });
    expect(during.statusCode).toBe(409);
    expect((await running).statusCode).toBe(200);
    const after = await app.inject({
      method: "POST",
      url: "/v1/scrape",
      payload: { url: "https://example.com" },
    });
    expect(after.statusCode).not.toBe(409);
  });

  test("ends before the session ends", async () => {
    expect((await post("live", { commands: { command: "snapshot" } })).statusCode).toBe(200);
    await plugin.onBeforeSessionEnd(config);
    expect((await post("live", { commands: { command: "snapshot" } })).statusCode).toBe(410);
  });

  test("ends when the browser switches to Selenium", async () => {
    await plugin.onSessionStart(config);
    await plugin.onBrowserReady(config);
    const list = { commands: { command: "tab", action: "list" } };
    expect((await post("live", list)).statusCode).toBe(200);
    await plugin.onShutdown(ShutdownReason.MODE_SWITCH);
    expect((await post("live", list)).statusCode).toBe(410);
  });
});

describe("commands host", () => {
  test("ends only the live session the engine runs", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const activeSession = { id: "live", status: "live" };
    const server = {
      cdpService: { registerPlugin: () => undefined },
      sessionService: { activeSession, endSession },
    } as unknown as FastifyInstance;
    const host = (createCommandEngine(server) as unknown as { host: EngineHost }).host;
    await host.endSession("old");
    expect(endSession).not.toHaveBeenCalled();
    activeSession.status = "released";
    await host.endSession("live");
    expect(endSession).not.toHaveBeenCalled();
    activeSession.status = "live";
    await host.endSession("live");
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  test("treats a session as released once another session is live", () => {
    const activeSession = { id: "new", status: "live" };
    const server = {
      cdpService: { registerPlugin: () => undefined },
      sessionService: { activeSession },
    } as unknown as FastifyInstance;
    const host = (createCommandEngine(server) as unknown as { host: EngineHost }).host;
    expect(host.released("old")).toBe(true);
    expect(host.released("new")).toBe(false);
    activeSession.status = "released";
    expect(host.released("new")).toBe(true);
  });
});
