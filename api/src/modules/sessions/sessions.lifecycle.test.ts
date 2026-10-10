import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaunchTimeoutError } from "../../services/cdp/errors/launch-errors.js";
import {
  handleExitBrowserSession,
  handleGetBrowserContext,
  handleGetSessionLiveDetails,
  handleLaunchBrowserSession,
} from "./sessions.controller.js";

const apps: ReturnType<typeof Fastify>[] = [];
function fixture() {
  const app = Fastify();
  apps.push(app);
  const sessions = {
    activeSession: { id: "owned-B", status: "live" },
    endSession: vi.fn().mockResolvedValue({ id: "owned-B", status: "released" }),
    startSession: vi.fn().mockResolvedValue({ id: "owned-B", status: "live" }),
  };
  const cdp = {
    getAllPages: vi.fn().mockResolvedValue([]),
    getBrowserState: vi.fn().mockResolvedValue({ cookies: [] }),
  };
  app.decorate("sessionService", sessions as never);
  app.decorate("cdpService", cdp as never);
  app.post<{ Params: { sessionId?: string } }>("/sessions/:sessionId/release", (request, reply) =>
    handleExitBrowserSession(app, request, reply),
  );
  app.post<{ Params: { sessionId?: string } }>("/sessions/release", (request, reply) =>
    handleExitBrowserSession(app, request, reply),
  );
  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/context", (request, reply) =>
    handleGetBrowserContext(app, request, reply),
  );
  app.get<{ Params: { id: string } }>("/sessions/:id/live", (request, reply) =>
    handleGetSessionLiveDetails(app, request, reply),
  );
  app.post("/sessions", (request, reply) =>
    handleLaunchBrowserSession(app, request as never, reply),
  );
  return { app, sessions, cdp };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe("session HTTP ownership and delivery cancellation", () => {
  it("returns 404 for stale scoped release without invoking global release", async () => {
    const { app, sessions } = fixture();
    const response = await app.inject({ method: "POST", url: "/sessions/stale-A/release" });
    expect(response.statusCode).toBe(404);
    expect(sessions.endSession).not.toHaveBeenCalled();
  });
  it("passes the owned ID to scoped release", async () => {
    const { app, sessions } = fixture();
    const response = await app.inject({ method: "POST", url: "/sessions/owned-B/release" });
    expect(response.statusCode).toBe(200);
    expect(sessions.endSession).toHaveBeenCalledExactlyOnceWith("owned-B");
  });
  it("retains explicit global release compatibility", async () => {
    const { app, sessions } = fixture();
    const response = await app.inject({ method: "POST", url: "/sessions/release" });
    expect(response.statusCode).toBe(200);
    expect(sessions.endSession).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it("does not read another singleton's context or pages", async () => {
    const { app, cdp } = fixture();
    expect((await app.inject("/sessions/stale-A/context")).statusCode).toBe(404);
    expect((await app.inject("/sessions/stale-A/live")).statusCode).toBe(404);
    expect(cdp.getBrowserState).not.toHaveBeenCalled();
    expect(cdp.getAllPages).not.toHaveBeenCalled();
  });
  it("rejects a context read whose association changes while awaiting", async () => {
    const { app, sessions, cdp } = fixture();
    cdp.getBrowserState.mockImplementation(async () => {
      sessions.activeSession.id = "owned-C";
      return { cookies: [] };
    });
    expect((await app.inject("/sessions/owned-B/context")).statusCode).toBe(404);
  });
  it("rejects live details whose association changes during page discovery", async () => {
    const { app, sessions, cdp } = fixture();
    cdp.getAllPages.mockImplementation(async () => {
      sessions.activeSession.id = "owned-C";
      return [];
    });
    expect((await app.inject("/sessions/owned-B/live")).statusCode).toBe(404);
  });
  it.each([
    [Object.assign(new Error("busy"), { statusCode: 409 }), 409],
    [new LaunchTimeoutError(45_000), 504],
  ])("maps lifecycle failure %s to HTTP %s", async (error, status) => {
    const { app, sessions } = fixture();
    sessions.startSession.mockRejectedValue(error);
    expect((await app.inject({ method: "POST", url: "/sessions", payload: {} })).statusCode).toBe(
      status,
    );
  });
  it.each(["aborted", "close"])(
    "cancels startup on %s and detaches delivery listeners",
    async (event) => {
      const { app, sessions } = fixture();
      const pending = Promise.withResolvers<any>();
      sessions.startSession.mockReturnValue(pending.promise);
      const requestRaw = Object.assign(new EventEmitter(), { aborted: false });
      const replyRaw = Object.assign(new EventEmitter(), {
        writableFinished: false,
        destroyed: false,
      });
      const reply = { raw: replyRaw, code: vi.fn().mockReturnThis(), send: vi.fn() };
      const launch = handleLaunchBrowserSession(
        app,
        { body: {}, raw: requestRaw } as never,
        reply as never,
      );
      const signal = sessions.startSession.mock.calls[0][1].signal;
      (event === "aborted" ? requestRaw : replyRaw).emit(event);
      expect(signal.aborted).toBe(true);
      pending.reject(signal.reason);
      await launch;
      expect(reply.code).toHaveBeenCalledWith(408);
      expect(requestRaw.listenerCount("aborted")).toBe(0);
      expect(replyRaw.listenerCount("close")).toBe(0);
    },
  );
});
