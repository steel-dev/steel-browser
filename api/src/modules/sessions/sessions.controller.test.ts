import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { handleGetSessionStream } from "./sessions.controller.js";

const SESSION_ID = "9bf184a4-b624-4c5e-ab50-4d028cf85957";
const require = createRequire(import.meta.url);
const ejs = require("ejs") as {
  render: (template: string, data: Record<string, unknown>) => string;
};
const streamerTemplate = readFileSync(
  new URL("../../templates/live-session-streamer.ejs", import.meta.url),
  "utf8",
);

function viewerUrlBuilder(wsUrl: string, singlePageMode: boolean) {
  const html = ejs.render(streamerTemplate, {
    wsUrl,
    showControls: true,
    theme: "dark",
    interactive: true,
    dimensions: { width: 1920, height: 1080 },
    singlePageMode,
  });
  const source = html.match(/function createWebSocketUrl\(pageId\) \{[\s\S]*?\n {10}\}/)?.[0];
  if (!source) throw new Error("createWebSocketUrl not found in the streamer template");

  return new Function("baseWsUrl", "singlePageMode", `${source}; return createWebSocketUrl;`)(
    wsUrl,
    singlePageMode,
  ) as (pageId: string) => string;
}

function setup(sessionId = SESSION_ID) {
  const server = {
    sessionService: {
      activeSession: {
        id: sessionId,
        dimensions: { width: 1920, height: 1080 },
      },
    },
  } as any;
  const view = vi.fn();
  const reply = { view } as any;
  return { server, view, reply };
}

describe("handleGetSessionStream", () => {
  it("includes the active session id in the discovery websocket URL", async () => {
    const { server, view, reply } = setup();

    await handleGetSessionStream(server, { query: {} } as any, reply);

    expect(view).toHaveBeenCalledTimes(1);
    const [template, data] = view.mock.calls[0];
    expect(template).toBe("live-session-streamer.ejs");
    expect(data.wsUrl).toMatch(/^wss?:\/\//);
    expect(data.wsUrl.endsWith(`/v1/sessions/${SESSION_ID}/cast`)).toBe(true);
    expect(data.singlePageMode).toBe(false);
  });

  it("keeps the session id in the path when a pageId is requested", async () => {
    const { server, view, reply } = setup();

    await handleGetSessionStream(server, { query: { pageId: "ABC 123" } } as any, reply);

    const [, data] = view.mock.calls[0];
    expect(data.wsUrl.endsWith(`/v1/sessions/${SESSION_ID}/cast?pageId=ABC%20123`)).toBe(true);
    expect(data.singlePageMode).toBe(true);
  });

  it("keeps the session id in the path when a pageIndex is requested", async () => {
    const { server, view, reply } = setup();

    await handleGetSessionStream(server, { query: { pageIndex: "2" } } as any, reply);

    const [, data] = view.mock.calls[0];
    expect(data.wsUrl.endsWith(`/v1/sessions/${SESSION_ID}/cast?pageIndex=2`)).toBe(true);
    expect(data.singlePageMode).toBe(true);
  });

  it("uses the session that is active when the stream page is rendered", async () => {
    const first = setup("11111111-1111-4111-8111-111111111111");
    const second = setup("22222222-2222-4222-8222-222222222222");

    await handleGetSessionStream(first.server, { query: {} } as any, first.reply);
    await handleGetSessionStream(second.server, { query: {} } as any, second.reply);

    expect(first.view.mock.calls[0][1].wsUrl).toContain(
      "/v1/sessions/11111111-1111-4111-8111-111111111111/cast",
    );
    expect(second.view.mock.calls[0][1].wsUrl).toContain(
      "/v1/sessions/22222222-2222-4222-8222-222222222222/cast",
    );
    expect(first.view.mock.calls[0][1].wsUrl).not.toContain("22222222-2222-4222-8222-222222222222");
  });

  it("does not enable single-page mode without a page parameter", async () => {
    const { server, view, reply } = setup();

    await handleGetSessionStream(server, { query: { theme: "light" } } as any, reply);

    const [, data] = view.mock.calls[0];
    expect(data.singlePageMode).toBe(false);
    expect(data.wsUrl).not.toContain("?");
  });
});

describe("live-session-streamer WebSocket URL builder", () => {
  const wsUrl = `wss://steel.example/v1/sessions/${SESSION_ID}/cast`;

  it("adds tabInfo to the session-scoped discovery URL", () => {
    expect(viewerUrlBuilder(wsUrl, false)("tab-discovery")).toBe(`${wsUrl}?tabInfo=true`);
  });

  it("keeps the session id and encodes a concrete page id", () => {
    expect(viewerUrlBuilder(wsUrl, false)("page id")).toBe(
      `${wsUrl}?pageId=page%20id&format=binary`,
    );
  });

  it("appends format=binary to the existing single-page query", () => {
    const singlePageUrl = `${wsUrl}?pageIndex=0`;

    expect(viewerUrlBuilder(singlePageUrl, true)("tab-discovery")).toBe(
      `${singlePageUrl}&format=binary`,
    );
  });
});
