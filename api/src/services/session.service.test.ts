import { describe, expect, it, vi } from "vitest";
import os from "os";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { SessionService } from "./session.service.js";

function createSessionService() {
  const cdpService = {
    getUserAgent: vi.fn(() => "test-agent"),
    getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
    startNewSession: vi.fn().mockResolvedValue({}),
    shutdown: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn().mockResolvedValue({}),
    endSession: vi.fn().mockResolvedValue(undefined),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const service = new SessionService({
    cdpService: cdpService as any,
    seleniumService: { launch: vi.fn(), close: vi.fn() } as any,
    fileService: {} as any,
    logger: logger as any,
  });

  return { service, cdpService };
}

describe("SessionService", () => {
  it("uses an isolated temp userDataDir for non-persistent sessions", async () => {
    const { service, cdpService } = createSessionService();
    const sessionId = "11111111-1111-4111-8111-111111111111";

    await service.startSession({
      sessionId,
      timezone: "UTC",
      credentials: undefined,
    });

    expect(cdpService.startNewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userDataDir: path.join(os.tmpdir(), sessionId),
      }),
    );
  });

  it("preserves an explicit userDataDir", async () => {
    const { service, cdpService } = createSessionService();
    const userDataDir = path.join(os.tmpdir(), "custom-steel-profile");

    await service.startSession({
      sessionId: "22222222-2222-4222-8222-222222222222",
      userDataDir,
      timezone: "UTC",
      credentials: undefined,
    });

    expect(cdpService.startNewSession).toHaveBeenCalledWith(
      expect.objectContaining({ userDataDir }),
    );
  });

  it("uses the persistent profile path when persist is true", async () => {
    const { service, cdpService } = createSessionService();
    const persistentDir = path.join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "user-data-dir",
    );

    await service.startSession({
      sessionId: "33333333-3333-4333-8333-333333333333",
      persist: true,
      timezone: "UTC",
      credentials: undefined,
    });

    expect(cdpService.startNewSession).toHaveBeenCalledWith(
      expect.objectContaining({ userDataDir: persistentDir }),
    );
  });
});
