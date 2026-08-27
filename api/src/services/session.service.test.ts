import { FastifyBaseLogger } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CDPService } from "./cdp/cdp.service.js";
import { FileService } from "./file.service.js";
import { SeleniumService } from "./selenium.service.js";
import { SessionService } from "./session.service.js";

function createService() {
  const cdpService = {
    getUserAgent: () => "test-user-agent",
    getDimensions: () => ({ width: 1920, height: 1080 }),
    startNewSession: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn().mockResolvedValue(undefined),
  } as unknown as CDPService;

  const seleniumService = {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  } as unknown as SeleniumService;

  const fileService = {} as FileService;

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as FastifyBaseLogger;

  const service = new SessionService({ cdpService, seleniumService, fileService, logger });

  return { service, cdpService, seleniumService, logger };
}

describe("SessionService automatic timeout release", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records the requested timeout on the live session", async () => {
    const { service } = createService();

    const session = await service.startSession({
      timezone: "UTC",
      timeout: 60_000,
      credentials: {},
    });

    expect(session.timeout).toBe(60_000);
    expect(session.status).toBe("live");
  });

  it("releases the session once the timeout elapses", async () => {
    const { service, cdpService } = createService();

    const session = await service.startSession({
      timezone: "UTC",
      timeout: 60_000,
      credentials: {},
    });
    const sessionId = session.id;

    expect(cdpService.endSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(cdpService.endSession).toHaveBeenCalledTimes(1);
    expect(service.pastSessions).toHaveLength(1);
    expect(service.pastSessions[0].id).toBe(sessionId);
    expect(service.pastSessions[0].status).toBe("released");
    expect(service.activeSession.status).toBe("idle");
  });

  it("keeps the session alive when no timeout is provided", async () => {
    const { service, cdpService } = createService();

    await service.startSession({ timezone: "UTC", credentials: {} });

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(cdpService.endSession).not.toHaveBeenCalled();
    expect(service.activeSession.status).toBe("live");
    expect(service.activeSession.timeout).toBe(0);
  });

  it("does not let a previous timer release a newly started session", async () => {
    const { service, cdpService } = createService();

    await service.startSession({ timezone: "UTC", timeout: 60_000, credentials: {} });

    await vi.advanceTimersByTimeAsync(30_000);

    const replacement = await service.startSession({ timezone: "UTC", credentials: {} });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(cdpService.endSession).not.toHaveBeenCalled();
    expect(service.activeSession.id).toBe(replacement.id);
    expect(service.activeSession.status).toBe("live");
  });

  it("does not fire after the session was released manually", async () => {
    const { service, cdpService } = createService();

    await service.startSession({ timezone: "UTC", timeout: 60_000, credentials: {} });
    await service.endSession();

    expect(cdpService.endSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(cdpService.endSession).toHaveBeenCalledTimes(1);
  });
});
