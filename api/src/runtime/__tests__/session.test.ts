import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSession } from "../session.js";
import { BrowserDriver } from "../browser-driver.js";
import { TaskScheduler } from "../task-scheduler.js";
import { FastifyBaseLogger } from "fastify";
import { SessionHooks } from "../hooks.js";
import {
  isIdle,
  isLaunching,
  isLive,
  isDraining,
  isError,
  isClosed,
  InvalidStateError,
  assertIdle,
  assertLive,
  assertError,
  LaunchError,
} from "../types.js";

describe("Type State Session", () => {
  let mockDriver: BrowserDriver;
  let mockScheduler: TaskScheduler;
  let mockLogger: FastifyBaseLogger;
  let mockBrowser: any;
  let mockPage: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    mockPage = {
      url: vi.fn().mockReturnValue("about:blank"),
      close: vi.fn(),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      close: vi.fn(),
      process: vi.fn().mockReturnValue({ kill: vi.fn() }),
    };

    mockDriver = {
      launch: vi.fn().mockResolvedValue({
        browser: mockBrowser,
        primaryPage: mockPage,
      }),
      close: vi.fn().mockResolvedValue(undefined),
      forceClose: vi.fn().mockResolvedValue(undefined),
      getBrowser: vi.fn().mockReturnValue(mockBrowser),
      getPrimaryPage: vi.fn().mockReturnValue(mockPage),
    } as any;

    mockScheduler = {
      runCritical: vi.fn((fn) => fn()),
      drain: vi.fn().mockResolvedValue(undefined),
      cancelAll: vi.fn(),
      waitUntil: vi.fn(),
    } as any;
  });

  describe("Type Guards", () => {
    it("should correctly identify idle session", () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(isIdle(session)).toBe(true);
      expect(isLaunching(session)).toBe(false);
      expect(isLive(session)).toBe(false);
      expect(isDraining(session)).toBe(false);
      expect(isError(session)).toBe(false);
      expect(isClosed(session)).toBe(false);
    });
  });

  describe("Idle → Launching transition", () => {
    it("should return LaunchingSession when start() is called", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const config = { options: {} };
      const launching = await idle.start(config);

      expect(launching._state).toBe("launching");
      expect(isLaunching(launching)).toBe(true);
      expect(launching.config).toBe(config);
    });
  });

  describe("Launching → Live transition", () => {
    it("should return LiveSession when launch succeeds", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const result = await launching.awaitLaunch();

      expect(result._state).toBe("live");
      expect(isLive(result)).toBe(true);

      if (isLive(result)) {
        expect(result.browser).toBe(mockBrowser);
        expect(result.primaryPage).toBe(mockPage);
      }
    });

    it("should return ErrorSession when launch fails", async () => {
      const launchError = new Error("Launch failed");
      mockDriver.launch = vi.fn().mockRejectedValue(launchError);

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const result = await launching.awaitLaunch();

      expect(result._state).toBe("error");
      expect(isError(result)).toBe(true);

      if (isError(result)) {
        expect(result.error).toBeDefined();
        expect(result.error.message).toContain("Browser launch failed");
        expect(result.failedFrom).toBe("launching");
      }
    });
  });

  describe("Live → Draining transition", () => {
    it("should return DrainingSession when end() is called", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test-reason");

      expect(draining._state).toBe("draining");
      expect(isDraining(draining)).toBe(true);
      expect(draining.reason).toBe("test-reason");
    });
  });

  describe("Draining → Closed transition", () => {
    it("should return ClosedSession when drain completes", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test-reason");
      const result = await draining.awaitDrain();

      expect(result._state).toBe("closed");
      expect(isClosed(result)).toBe(true);
      expect(mockScheduler.drain).toHaveBeenCalled();
      expect(mockDriver.close).toHaveBeenCalled();
      expect(mockScheduler.cancelAll).toHaveBeenCalledWith("test-reason");
    });

    it("should return ErrorSession when drain fails", async () => {
      mockDriver.close = vi.fn().mockRejectedValue(new Error("Close failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test-reason");
      const result = await draining.awaitDrain();

      expect(result._state).toBe("error");
      expect(isError(result)).toBe(true);

      if (isError(result)) {
        expect(result.failedFrom).toBe("draining");
      }
    });
  });

  describe("Closed → Idle transition", () => {
    it("should return IdleSession when restart() is called", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test");
      const result = await draining.awaitDrain();

      if (!isClosed(result)) {
        throw new Error("Expected ClosedSession");
      }

      const newIdle = result.restart();

      expect(newIdle._state).toBe("idle");
      expect(isIdle(newIdle)).toBe(true);
    });
  });

  describe("Error → Idle transition", () => {
    it("should return IdleSession when recover() is called", async () => {
      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Launch failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const result = await launching.awaitLaunch();

      if (!isError(result)) {
        throw new Error("Expected ErrorSession");
      }

      const newIdle = await result.recover();

      expect(newIdle._state).toBe("idle");
      expect(isIdle(newIdle)).toBe(true);
      expect(mockScheduler.cancelAll).toHaveBeenCalledWith("error-recovery");
    });

    it("should return ClosedSession when terminate() is called", async () => {
      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Launch failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const result = await launching.awaitLaunch();

      if (!isError(result)) {
        throw new Error("Expected ErrorSession");
      }

      const closed = await result.terminate();

      expect(closed._state).toBe("closed");
      expect(isClosed(closed)).toBe(true);
      expect(mockDriver.forceClose).toHaveBeenCalled();
      expect(mockScheduler.cancelAll).toHaveBeenCalledWith("error-terminate");
    });

    it("should call forceClose when recovering from live or draining failure", async () => {
      mockDriver.close = vi.fn().mockRejectedValue(new Error("Close failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test");
      const errorResult = await draining.awaitDrain();

      if (!isError(errorResult)) {
        throw new Error("Expected ErrorSession");
      }

      expect(errorResult.failedFrom).toBe("draining");

      // Reset mock to track the forceClose call during recover
      mockDriver.forceClose = vi.fn().mockResolvedValue(undefined);

      const newIdle = await errorResult.recover();

      expect(newIdle._state).toBe("idle");
      // forceClose should be called because failedFrom is 'draining'
      expect(mockDriver.forceClose).toHaveBeenCalled();
    });
  });

  describe("SessionHooks", () => {
    it("should call onEnterLive when transitioning to Live", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onEnterDraining: vi.fn(),
        onEnterError: vi.fn(),
        onClosed: vi.fn(),
        onLaunchFailed: vi.fn(),
      };

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      await launching.awaitLaunch();

      expect(hooks.onEnterLive).toHaveBeenCalled();
    });

    it("should call onExitLive when transitioning from Live to Draining", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onEnterDraining: vi.fn(),
        onEnterError: vi.fn(),
        onClosed: vi.fn(),
        onLaunchFailed: vi.fn(),
      };

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      await live.end("test");

      expect(hooks.onExitLive).toHaveBeenCalled();
      expect(hooks.onEnterDraining).toHaveBeenCalled();
    });

    it("should call onLaunchFailed and onEnterError when launch fails", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onEnterError: vi.fn(),
        onLaunchFailed: vi.fn(),
        onClosed: vi.fn(),
      };

      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      await launching.awaitLaunch();

      expect(hooks.onLaunchFailed).toHaveBeenCalled();
      expect(hooks.onEnterError).toHaveBeenCalled();
      expect(hooks.onEnterLive).not.toHaveBeenCalled();
    });

    it("should call onClosed when session closes", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onEnterError: vi.fn(),
        onClosed: vi.fn(),
      };

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test");
      await draining.awaitDrain();

      expect(hooks.onClosed).toHaveBeenCalled();
    });

    it("should call onEnterError when drain fails", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onEnterDraining: vi.fn(),
        onEnterError: vi.fn(),
        onClosed: vi.fn(),
      };

      mockDriver.close = vi.fn().mockRejectedValue(new Error("Close failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test");
      await draining.awaitDrain();

      expect(hooks.onEnterError).toHaveBeenCalled();
      expect(hooks.onClosed).not.toHaveBeenCalled();
    });
  });

  describe("Type Safety (compile-time)", () => {
    it("demonstrates that only allowed methods exist on each state", () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      // IdleSession only has start()
      expect(typeof idle.start).toBe("function");
      expect((idle as any).end).toBeUndefined();
      expect((idle as any).browser).toBeUndefined();
      expect((idle as any).restart).toBeUndefined();
    });
  });

  describe("Full lifecycle", () => {
    it("should complete full lifecycle: Idle → Launching → Live → Draining → Closed → Idle", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(idle._state).toBe("idle");

      const launching = await idle.start({ options: {} });
      expect(launching._state).toBe("launching");

      const live = await launching.awaitLaunch();
      expect(live._state).toBe("live");

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const draining = await live.end("full-cycle-test");
      expect(draining._state).toBe("draining");

      const result = await draining.awaitDrain();
      expect(result._state).toBe("closed");

      if (!isClosed(result)) throw new Error("Expected ClosedSession");

      const newIdle = result.restart();
      expect(newIdle._state).toBe("idle");
    });

    it("should handle error recovery: Idle → Launching → Error → Idle", async () => {
      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Launch failed"));

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(idle._state).toBe("idle");

      const launching = await idle.start({ options: {} });
      expect(launching._state).toBe("launching");

      const errorSession = await launching.awaitLaunch();
      expect(errorSession._state).toBe("error");

      if (!isError(errorSession)) throw new Error("Expected ErrorSession");

      const recoveredIdle = await errorSession.recover();
      expect(recoveredIdle._state).toBe("idle");
    });
  });

  describe("Browser crash handling", () => {
    it("should transition Live → Error when crash() is called", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const crashError = new Error("Browser crashed unexpectedly");
      const errorSession = await live.crash(crashError);

      expect(errorSession._state).toBe("error");
      expect(isError(errorSession)).toBe(true);
      expect(errorSession.error).toBe(crashError);
      expect(errorSession.failedFrom).toBe("crashed");
    });

    it("should call onCrash hook before onExitLive when crash() is called", async () => {
      const callOrder: string[] = [];

      const hooks: SessionHooks = {
        onCrash: vi.fn().mockImplementation(() => {
          callOrder.push("onCrash");
        }),
        onExitLive: vi.fn().mockImplementation(() => {
          callOrder.push("onExitLive");
        }),
        onEnterError: vi.fn().mockImplementation(() => {
          callOrder.push("onEnterError");
        }),
      };

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const crashError = new Error("Browser crashed");
      await live.crash(crashError);

      expect(hooks.onCrash).toHaveBeenCalledWith(live, crashError);
      expect(hooks.onExitLive).toHaveBeenCalledWith(live);
      expect(hooks.onEnterError).toHaveBeenCalled();

      // Verify call order: onCrash → onExitLive → onEnterError
      expect(callOrder).toEqual(["onCrash", "onExitLive", "onEnterError"]);
    });

    it("should call forceClose when recovering from crashed state", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const crashError = new Error("Browser crashed");
      const errorSession = await live.crash(crashError);

      expect(errorSession.failedFrom).toBe("crashed");

      // Reset mock to track forceClose call
      mockDriver.forceClose = vi.fn().mockResolvedValue(undefined);

      const recoveredIdle = await errorSession.recover();

      expect(recoveredIdle._state).toBe("idle");
      expect(mockDriver.forceClose).toHaveBeenCalled();
      expect(mockScheduler.cancelAll).toHaveBeenCalledWith("error-recovery");
    });

    it("should handle crash recovery cycle: Idle → Live → Error (crash) → Idle", async () => {
      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(idle._state).toBe("idle");

      const launching = await idle.start({ options: {} });
      const live = await launching.awaitLaunch();

      expect(live._state).toBe("live");

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const crashError = new Error("Unexpected disconnect");
      const errorSession = await live.crash(crashError);

      expect(errorSession._state).toBe("error");
      expect(errorSession.failedFrom).toBe("crashed");

      const recoveredIdle = await errorSession.recover();

      expect(recoveredIdle._state).toBe("idle");
    });
  });

  describe("Type Assertions", () => {
    it("assertIdle should pass for idle session", () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(() => assertIdle(session)).not.toThrow();
    });

    it("assertIdle should throw InvalidStateError for non-idle session", async () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      expect(() => assertIdle(live)).toThrow(InvalidStateError);
    });

    it("assertLive should pass for live session", async () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      expect(() => assertLive(live)).not.toThrow();
    });

    it("assertLive should throw InvalidStateError for non-live session", () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(() => assertLive(session)).toThrow(InvalidStateError);
    });

    it("assertError should pass for error session", async () => {
      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Launch failed"));

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const result = await launching.awaitLaunch();

      expect(() => assertError(result)).not.toThrow();
    });

    it("assertError should throw InvalidStateError for non-error session", () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      expect(() => assertError(session)).toThrow(InvalidStateError);
    });
  });

  describe("InvalidStateError", () => {
    it("should have correct properties", () => {
      const error = new InvalidStateError("live", "idle");

      expect(error.name).toBe("InvalidStateError");
      expect(error.currentState).toBe("live");
      expect(error.expectedState).toBe("idle");
      expect(error.message).toContain("live");
      expect(error.message).toContain("idle");
    });
  });

  describe("LaunchError", () => {
    it("should wrap cause error", () => {
      const cause = new Error("Original error");
      const launchError = new LaunchError("Browser launch failed", cause);

      expect(launchError.name).toBe("LaunchError");
      expect(launchError.message).toBe("Browser launch failed");
      expect(launchError.cause).toBe(cause);
    });

    it("should work without cause", () => {
      const launchError = new LaunchError("Browser launch failed");

      expect(launchError.name).toBe("LaunchError");
      expect(launchError.message).toBe("Browser launch failed");
      expect(launchError.cause).toBeUndefined();
    });
  });

  describe("Hook Error Handling", () => {
    it("should not throw when hook throws during onEnterLive", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const hooks: SessionHooks = {
        onEnterLive: vi.fn().mockRejectedValue(new Error("Hook failed")),
      };

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await session.start({ options: {} });
      const result = await launching.awaitLaunch();

      // Should still transition to live despite hook error
      expect(result._state).toBe("live");

      consoleSpy.mockRestore();
    });

    it("should not throw when hook throws during onExitLive", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const hooks: SessionHooks = {
        onExitLive: vi.fn().mockRejectedValue(new Error("Hook failed")),
      };

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const draining = await live.end("test");

      // Should still transition to draining despite hook error
      expect(draining._state).toBe("draining");

      consoleSpy.mockRestore();
    });

    it("should not throw when hook throws during onClosed", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const hooks: SessionHooks = {
        onClosed: vi.fn().mockRejectedValue(new Error("Hook failed")),
      };

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const draining = await live.end("test");
      const result = await draining.awaitDrain();

      // Should still transition to closed despite hook error
      expect(result._state).toBe("closed");

      consoleSpy.mockRestore();
    });
  });

  describe("Repeated awaitLaunch calls", () => {
    it("should return same result on repeated awaitLaunch calls", async () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });

      const result1 = await launching.awaitLaunch();
      const result2 = await launching.awaitLaunch();

      expect(result1).toBe(result2);
      expect(mockDriver.launch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Repeated awaitDrain calls", () => {
    it("should return same result on repeated awaitDrain calls", async () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const draining = await live.end("test");

      const result1 = await draining.awaitDrain();
      const result2 = await draining.awaitDrain();

      expect(result1).toBe(result2);
      expect(mockDriver.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("Session config preservation", () => {
    it("should preserve config through transitions", async () => {
      const config = {
        options: { headless: true },
        userAgent: "test-agent",
        dimensions: { width: 1280, height: 720 },
      };

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start(config);
      expect(launching.config).toBe(config);

      const live = await launching.awaitLaunch();
      if (!isLive(live)) throw new Error("Expected LiveSession");

      expect(live.config).toBe(config);
    });
  });

  describe("FailedFrom state tracking", () => {
    it("should set failedFrom to launching when launch fails", async () => {
      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Launch failed"));

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const result = await launching.awaitLaunch();

      if (!isError(result)) throw new Error("Expected ErrorSession");

      expect(result.failedFrom).toBe("launching");
    });

    it("should set failedFrom to draining when drain fails", async () => {
      mockDriver.close = vi.fn().mockRejectedValue(new Error("Close failed"));

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const draining = await live.end("test");
      const result = await draining.awaitDrain();

      if (!isError(result)) throw new Error("Expected ErrorSession");

      expect(result.failedFrom).toBe("draining");
    });

    it("should set failedFrom to crashed when crash() is called", async () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const result = await live.crash(new Error("Crashed"));

      expect(result.failedFrom).toBe("crashed");
    });
  });

  describe("Error recovery cleanup", () => {
    it("should NOT call forceClose when recovering from launching failure", async () => {
      mockDriver.launch = vi.fn().mockRejectedValue(new Error("Launch failed"));

      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const result = await launching.awaitLaunch();

      if (!isError(result)) throw new Error("Expected ErrorSession");

      // Reset mock to track
      mockDriver.forceClose = vi.fn().mockResolvedValue(undefined);

      await result.recover();

      // forceClose should NOT be called for launching failures
      // because browser was never successfully created
      expect(mockDriver.forceClose).not.toHaveBeenCalled();
    });

    it("should call forceClose when recovering from live failure", async () => {
      const session = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await session.start({ options: {} });
      const live = await launching.awaitLaunch();

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const error = await live.crash(new Error("Browser crashed"));

      // Reset mock to track
      mockDriver.forceClose = vi.fn().mockResolvedValue(undefined);

      await error.recover();

      // forceClose SHOULD be called for live/crashed failures
      expect(mockDriver.forceClose).toHaveBeenCalled();
    });
  });
});
