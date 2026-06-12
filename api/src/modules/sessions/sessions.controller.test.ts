import { describe, expect, it, vi } from "vitest";

import { handleLaunchBrowserSession } from "./sessions.controller.js";

describe("handleLaunchBrowserSession", () => {
  it("returns request-scoped public urls for launched sessions", async () => {
    const startSession = vi.fn().mockResolvedValue({
      id: "session-1",
      websocketUrl: "ws://localhost:3000/",
      debugUrl: "http://localhost:3000/v1/sessions/debug",
      debuggerUrl: "http://localhost:3000/v1/devtools/inspector.html",
      sessionViewerUrl: "http://localhost:3000/",
      createdAt: new Date().toISOString(),
      status: "live",
      duration: 0,
      eventCount: 0,
      timeout: 0,
      creditsUsed: 0,
      userAgent: "ua",
      proxy: "",
      proxyTxBytes: 0,
      proxyRxBytes: 0,
      solveCaptcha: false,
      isSelenium: false,
    });

    const server = {
      sessionService: { startSession },
      log: { error: vi.fn() },
    } as any;

    const request = {
      body: {
        sessionId: "session-1",
      },
      headers: {
        host: "steel.example.com",
        "x-forwarded-proto": "https",
      },
    } as any;

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    const result = await handleLaunchBrowserSession(server, request, reply);

    expect(startSession).toHaveBeenCalledOnce();
    expect(result.websocketUrl).toBe("wss://steel.example.com/");
    expect(result.debugUrl).toBe("https://steel.example.com/v1/sessions/debug");
    expect(result.debuggerUrl).toBe("https://steel.example.com/v1/devtools/inspector.html");
    expect(result.sessionViewerUrl).toBe("https://steel.example.com/");
  });
});
