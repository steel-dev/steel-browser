import { describe, it, expect, vi, beforeEach } from "vitest";
import { invokeHook, SessionHooks } from "../hooks.js";
import { LiveSession, ErrorSession, DrainingSession, ClosedSession } from "../types.js";

describe("SessionHooks", () => {
  let mockLiveSession: LiveSession;
  let mockErrorSession: ErrorSession;
  let mockDrainingSession: DrainingSession;
  let mockClosedSession: ClosedSession;

  beforeEach(() => {
    mockLiveSession = {
      _state: "live",
      browser: {} as any,
      primaryPage: {} as any,
      config: { options: {} },
      end: vi.fn(),
      crash: vi.fn(),
    } as LiveSession;

    mockErrorSession = {
      _state: "error",
      error: new Error("Test error"),
      failedFrom: "launching",
      recover: vi.fn(),
      terminate: vi.fn(),
    } as ErrorSession;

    mockDrainingSession = {
      _state: "draining",
      browser: {} as any,
      reason: "test-drain",
      awaitDrain: vi.fn(),
    } as DrainingSession;

    mockClosedSession = {
      _state: "closed",
      restart: vi.fn(),
    } as ClosedSession;
  });

  describe("invokeHook", () => {
    it("should call the specified hook with correct arguments", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
      };

      await invokeHook(hooks, "onEnterLive", mockLiveSession);

      expect(hooks.onEnterLive).toHaveBeenCalledWith(mockLiveSession);
      expect(hooks.onEnterLive).toHaveBeenCalledTimes(1);
    });

    it("should handle async hooks", async () => {
      let completed = false;
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          completed = true;
        }),
      };

      await invokeHook(hooks, "onEnterLive", mockLiveSession);

      expect(completed).toBe(true);
    });

    it("should not throw when hooks is undefined", async () => {
      await expect(invokeHook(undefined, "onEnterLive", mockLiveSession)).resolves.not.toThrow();
    });

    it("should not throw when specific hook is undefined", async () => {
      const hooks: SessionHooks = {};

      await expect(invokeHook(hooks, "onEnterLive", mockLiveSession)).resolves.not.toThrow();
    });

    it("should catch and log errors from hooks without rethrowing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const hookError = new Error("Hook failed");

      const hooks: SessionHooks = {
        onEnterLive: vi.fn().mockRejectedValue(hookError),
      };

      await expect(invokeHook(hooks, "onEnterLive", mockLiveSession)).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("onEnterLive"), hookError);

      consoleSpy.mockRestore();
    });

    it("should catch and log synchronous errors from hooks", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const hookError = new Error("Sync hook failed");

      const hooks: SessionHooks = {
        onEnterLive: vi.fn().mockImplementation(() => {
          throw hookError;
        }),
      };

      await expect(invokeHook(hooks, "onEnterLive", mockLiveSession)).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("onEnterLive"), hookError);

      consoleSpy.mockRestore();
    });

    it("should call onExitLive with LiveSession", async () => {
      const hooks: SessionHooks = {
        onExitLive: vi.fn(),
      };

      await invokeHook(hooks, "onExitLive", mockLiveSession);

      expect(hooks.onExitLive).toHaveBeenCalledWith(mockLiveSession);
    });

    it("should call onEnterDraining with DrainingSession", async () => {
      const hooks: SessionHooks = {
        onEnterDraining: vi.fn(),
      };

      await invokeHook(hooks, "onEnterDraining", mockDrainingSession);

      expect(hooks.onEnterDraining).toHaveBeenCalledWith(mockDrainingSession);
    });

    it("should call onEnterError with ErrorSession", async () => {
      const hooks: SessionHooks = {
        onEnterError: vi.fn(),
      };

      await invokeHook(hooks, "onEnterError", mockErrorSession);

      expect(hooks.onEnterError).toHaveBeenCalledWith(mockErrorSession);
    });

    it("should call onLaunchFailed with Error", async () => {
      const launchError = new Error("Launch failed");
      const hooks: SessionHooks = {
        onLaunchFailed: vi.fn(),
      };

      await invokeHook(hooks, "onLaunchFailed", launchError);

      expect(hooks.onLaunchFailed).toHaveBeenCalledWith(launchError);
    });

    it("should call onClosed with ClosedSession", async () => {
      const hooks: SessionHooks = {
        onClosed: vi.fn(),
      };

      await invokeHook(hooks, "onClosed", mockClosedSession);

      expect(hooks.onClosed).toHaveBeenCalledWith(mockClosedSession);
    });

    it("should call onCrash with LiveSession and Error", async () => {
      const crashError = new Error("Browser crashed");
      const hooks: SessionHooks = {
        onCrash: vi.fn(),
      };

      await invokeHook(hooks, "onCrash", mockLiveSession, crashError);

      expect(hooks.onCrash).toHaveBeenCalledWith(mockLiveSession, crashError);
    });
  });

  describe("Hook Error Isolation", () => {
    it("should continue execution even if hook throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let afterHookExecuted = false;

      const hooks: SessionHooks = {
        onEnterLive: vi.fn().mockImplementation(() => {
          throw new Error("Hook error");
        }),
      };

      await invokeHook(hooks, "onEnterLive", mockLiveSession);
      afterHookExecuted = true;

      expect(afterHookExecuted).toBe(true);
      consoleSpy.mockRestore();
    });

    it("should handle hooks that return non-promise values", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn().mockReturnValue("not a promise"),
      };

      await expect(invokeHook(hooks, "onEnterLive", mockLiveSession)).resolves.not.toThrow();
    });
  });
});
