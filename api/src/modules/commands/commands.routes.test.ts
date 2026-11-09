import fastifySwagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { CDPService } from "../../services/cdp/cdp.service.js";
import type { CommandEngine, EngineHost } from "../../services/commands/engine.js";
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

  test("reports a dialog and has no route to answer it", async () => {
    await page.setContent(
      `<button onclick="document.title = String(confirm('Sure?'))">Ask</button>`,
    );
    const clicked = await post("live", {
      commands: { command: "click", target: { role: "button", name: "Ask" } },
    });
    expect(commandsSchemas.CommandResponse.safeParse(clicked.json()).success).toBe(true);
    const id = clicked.json().dialog.id;
    const answer = await app.inject({
      method: "POST",
      url: `/v1/sessions/live/commands/dialogs/${id}/answer`,
      payload: { action: "accept" },
    });
    expect(answer.statusCode).toBe(404);
    await (
      page as unknown as {
        _client(): { send(method: string, params?: object): Promise<unknown> };
      }
    )
      ._client()
      .send("Page.handleJavaScriptDialog", { accept: true });
    const spec = app.swagger() as unknown as {
      paths: Record<string, Record<string, { responses: Record<string, any> }>>;
    };
    const ok = (path: string, method: string) =>
      spec.paths[path][method].responses["200"].content["application/json"].schema.$ref;
    expect(ok("/v1/sessions/{sessionId}/commands", "post")).toBe(
      "#/components/schemas/CommandResponse",
    );
    expect(ok("/v1/sessions/{sessionId}/commands/executions/{executionId}", "get")).toBe(
      "#/components/schemas/CommandResponse",
    );
    expect(Object.keys(spec.paths).filter((path) => path.includes("dialogs"))).toEqual([]);
  });

  test("reads and cancels executions on their own routes", async () => {
    const listed = await post("live", { commands: { command: "tab", action: "list" } });
    const id = listed.json().execution.id;
    const status = await app.inject({
      method: "GET",
      url: `/v1/sessions/live/commands/executions/${id}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id, execution: { id, state: "completed" } });
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/sessions/live/commands/executions/${id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ execution: { id, state: "completed" } });
    const typed = await app.inject({
      method: "POST",
      url: `/v1/sessions/live/commands/executions/${id}/cancel`,
      headers: { "content-type": "application/json" },
    });
    expect(typed.statusCode, typed.body).toBe(200);
    const empty = await app.inject({
      method: "POST",
      url: "/v1/sessions/live/commands",
      headers: { "content-type": "application/json" },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: { code: "invalid_request" } });
    const unknown = await app.inject({
      method: "GET",
      url: "/v1/sessions/live/commands/executions/x-999999",
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ error: { code: "unknown_execution" } });
    const ended = await app.inject({
      method: "POST",
      url: `/v1/sessions/old/commands/executions/${id}/cancel`,
    });
    expect(ended.statusCode).toBe(410);
  });

  test("answers an internal error with 500 and says whether a retry is safe", async () => {
    const engine = app.commandEngine!;
    const spy = vi
      .spyOn(engine as unknown as { dispatch(): Promise<unknown> }, "dispatch")
      .mockRejectedValue(new Error("Fixture failure"));
    try {
      const bare = await post("live", { commands: { command: "snapshot" } });
      expect(bare.statusCode).toBe(500);
      expect(bare.headers["x-should-retry"]).toBe("false");
      expect(bare.json()).toEqual({
        error: { code: "internal_error", message: "Fixture failure" },
      });
      const keyed = await post(
        "live",
        { commands: { command: "snapshot" } },
        { "idempotency-key": "route-500" },
      );
      expect(keyed.headers["x-should-retry"]).toBe("true");
      const after = await post("live", { commands: { command: "snapshot" }, after: "op_x" });
      expect(after.headers["x-should-retry"]).toBe("true");
    } finally {
      spy.mockRestore();
    }
  });

  test("publishes the request schema", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sessions/live/commands/schema" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBe(1);
    expect(JSON.stringify(body.schema)).toContain('"navigate"');
    expect(JSON.stringify(body.schema)).not.toContain('"eventsAfter"');
    expect(JSON.stringify(body.schema)).not.toContain('"status"');
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

describe("commands body parsing", () => {
  test("answers bodies it cannot read in the commands error shape", async () => {
    const app = Fastify();
    app.decorate("commandEngine", {
      handle: async () => ({ status: 200, headers: {}, body: {} }),
    } as unknown as CommandEngine);
    await app.register(commandsRoutes, { prefix: "/v1" });
    const broken = await app.inject({
      method: "POST",
      url: "/v1/sessions/live/commands",
      headers: { "content-type": "application/json" },
      payload: "{nope",
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(broken.json().error.message).not.toBe("");
    const csv = await app.inject({
      method: "POST",
      url: "/v1/sessions/live/commands",
      headers: { "content-type": "text/csv" },
      payload: "a,b",
    });
    expect(csv.statusCode).toBe(415);
    expect(csv.json()).toMatchObject({ error: { code: "invalid_request" } });
    await app.close();
  });

  test("answers an engine that throws in the commands error shape", async () => {
    const app = Fastify();
    app.decorate("commandEngine", {
      handle: async () => {
        throw new Error("Fixture failure");
      },
    } as unknown as CommandEngine);
    await app.register(commandsRoutes, { prefix: "/v1" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/live/commands",
      payload: { commands: { command: "snapshot" } },
    });
    expect(response.statusCode).toBe(500);
    expect(response.headers["x-should-retry"]).toBe("false");
    expect(response.json()).toEqual({
      error: { code: "internal_error", message: "Fixture failure" },
    });
    await app.close();
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
