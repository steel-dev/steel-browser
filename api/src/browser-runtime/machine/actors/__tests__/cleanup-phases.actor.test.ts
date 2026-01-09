import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  closeBrowser,
  closeProxy,
  flushLogs,
  notifyPluginsShutdown,
} from "../cleanup-phases.actor.js";

vi.mock("../../tracing/index.js", () => ({
  traceOperation: vi.fn((_name, _level, fn) => fn({ setAttribute: vi.fn(), end: vi.fn() })),
}));

describe("Cleanup Phases Actors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("closeBrowser", () => {
    it("should call launcher.close if browser is provided", async () => {
      const launcher = { close: vi.fn().mockResolvedValue(undefined) } as any;
      const browser = { id: "test" } as any;

      await closeBrowser({ launcher, browser });

      expect(launcher.close).toHaveBeenCalledWith(browser);
    });

    it("should not call launcher.close if browser is null", async () => {
      const launcher = { close: vi.fn() } as any;

      await closeBrowser({ launcher, browser: null });

      expect(launcher.close).not.toHaveBeenCalled();
    });
  });

  describe("closeProxy", () => {
    it("should call proxy.close if proxy is provided", async () => {
      const proxy = { close: vi.fn().mockResolvedValue(undefined) } as any;

      await closeProxy({ proxy });

      expect(proxy.close).toHaveBeenCalled();
    });

    it("should not throw if proxy is null", async () => {
      await expect(closeProxy({ proxy: null })).resolves.not.toThrow();
    });
  });

  describe("flushLogs", () => {
    it("should call instrumentationLogger.flush if provided", async () => {
      const logger = { flush: vi.fn().mockResolvedValue(undefined) } as any;

      await flushLogs({ instrumentationLogger: logger });

      expect(logger.flush).toHaveBeenCalled();
    });

    it("should not throw if logger is null", async () => {
      await expect(flushLogs({ instrumentationLogger: undefined })).resolves.not.toThrow();
    });
  });

  describe("notifyPluginsShutdown", () => {
    it("should call onShutdown for all plugins", async () => {
      const plugin1 = { name: "p1", onShutdown: vi.fn().mockResolvedValue(undefined) } as any;
      const plugin2 = { name: "p2", onShutdown: vi.fn().mockResolvedValue(undefined) } as any;
      const plugin3 = { name: "p3" } as any; // No onShutdown

      await notifyPluginsShutdown({ plugins: [plugin1, plugin2, plugin3] });

      expect(plugin1.onShutdown).toHaveBeenCalled();
      expect(plugin2.onShutdown).toHaveBeenCalled();
    });

    it("should not throw if a plugin onShutdown fails", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const failingPlugin = {
        name: "fail",
        onShutdown: vi.fn().mockRejectedValue(new Error("Shutdown failed")),
      } as any;

      await expect(notifyPluginsShutdown({ plugins: [failingPlugin] })).resolves.not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
