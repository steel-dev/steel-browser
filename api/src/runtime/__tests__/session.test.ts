import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSession } from "../session.js";
import { BrowserDriver } from "../browser-driver.js";
import { TaskScheduler } from "../task-scheduler.js";
import { FastifyBaseLogger } from "fastify";
import { SessionHooks } from "../hooks.js";
import { isIdle, isLaunching, isLive, isDraining, isClosed, InvalidStateError } from "../types.js";

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
      const result = await launching.launched;

      expect(result._state).toBe("live");
      expect(isLive(result)).toBe(true);

      if (isLive(result)) {
        expect(result.browser).toBe(mockBrowser);
        expect(result.primaryPage).toBe(mockPage);
      }
    });

    it("should return ClosedSession when launch fails", async () => {
      const launchError = new Error("Launch failed");
      mockDriver.launch = vi.fn().mockRejectedValue(launchError);

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
      });

      const launching = await idle.start({ options: {} });
      const result = await launching.launched;

      expect(result._state).toBe("closed");
      expect(isClosed(result)).toBe(true);

      if (isClosed(result)) {
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain("Browser launch failed");
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
      const live = await launching.launched;

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
      const live = await launching.launched;

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test-reason");
      const closed = await draining.drained;

      expect(closed._state).toBe("closed");
      expect(isClosed(closed)).toBe(true);
      expect(mockScheduler.drain).toHaveBeenCalled();
      expect(mockDriver.close).toHaveBeenCalled();
      expect(mockScheduler.cancelAll).toHaveBeenCalledWith("test-reason");
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
      const live = await launching.launched;

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test");
      const closed = await draining.drained;
      const newIdle = closed.restart();

      expect(newIdle._state).toBe("idle");
      expect(isIdle(newIdle)).toBe(true);
    });
  });

  describe("SessionHooks", () => {
    it("should call onEnterLive when transitioning to Live", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onEnterDraining: vi.fn(),
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
      await launching.launched;

      expect(hooks.onEnterLive).toHaveBeenCalled();
    });

    it("should call onExitLive when transitioning from Live to Draining", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onEnterDraining: vi.fn(),
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
      const live = await launching.launched;

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      await live.end("test");

      expect(hooks.onExitLive).toHaveBeenCalled();
      expect(hooks.onEnterDraining).toHaveBeenCalled();
    });

    it("should call onLaunchFailed when launch fails", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
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
      await launching.launched;

      expect(hooks.onLaunchFailed).toHaveBeenCalled();
      expect(hooks.onEnterLive).not.toHaveBeenCalled();
    });

    it("should call onClosed when session closes", async () => {
      const hooks: SessionHooks = {
        onEnterLive: vi.fn(),
        onExitLive: vi.fn(),
        onClosed: vi.fn(),
      };

      const idle = createSession({
        driver: mockDriver,
        scheduler: mockScheduler,
        logger: mockLogger,
        hooks,
      });

      const launching = await idle.start({ options: {} });
      const live = await launching.launched;

      if (!isLive(live)) {
        throw new Error("Expected LiveSession");
      }

      const draining = await live.end("test");
      await draining.drained;

      expect(hooks.onClosed).toHaveBeenCalled();
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

      const live = await launching.launched;
      expect(live._state).toBe("live");

      if (!isLive(live)) throw new Error("Expected LiveSession");

      const draining = await live.end("full-cycle-test");
      expect(draining._state).toBe("draining");

      const closed = await draining.drained;
      expect(closed._state).toBe("closed");

      const newIdle = closed.restart();
      expect(newIdle._state).toBe("idle");
    });
  });
});
