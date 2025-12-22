import { describe, it, expect, beforeEach, vi } from "vitest";
import { FastifyBaseLogger } from "fastify";
import { createSession } from "../session.js";
import { TaskScheduler } from "../task-scheduler.js";
import { SessionHooks } from "../hooks.js";
import { isIdle, isLaunching, isLive, isDraining, isClosed, isError } from "../types.js";

describe("SessionMachine", () => {
  let logger: FastifyBaseLogger;
  let scheduler: TaskScheduler;
  let driver: any;
  let browser: any;
  let page: any;

  beforeEach(() => {
    logger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    scheduler = new TaskScheduler(logger);

    browser = { close: vi.fn(), process: vi.fn().mockReturnValue({ kill: vi.fn() }) };
    page = { close: vi.fn(), url: vi.fn().mockReturnValue("about:blank") };

    driver = {
      launch: vi.fn().mockResolvedValue({ browser, primaryPage: page }),
      close: vi.fn().mockResolvedValue(undefined),
      forceClose: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("initial state should start in Idle state", async () => {
    const idle = createSession({ driver, scheduler, logger });
    expect(isIdle(idle)).toBe(true);
    expect(idle._state).toBe("idle");
  });

  it("launch flow should transition from Idle -> Launching -> Live", async () => {
    const idle = createSession({ driver, scheduler, logger });
    const launching = await idle.start({ options: {} });
    expect(isLaunching(launching)).toBe(true);

    const result = await launching.awaitLaunch();
    expect(isLive(result)).toBe(true);
  });

  it("end flow should transition from Live -> Draining -> Closed", async () => {
    const drainSpy = vi.spyOn(scheduler, "drain");

    const idle = createSession({ driver, scheduler, logger });
    const launching = await idle.start({ options: {} });
    const live = await launching.awaitLaunch();
    if (!isLive(live)) throw new Error("Expected Live session");

    const draining = await live.end("test-end");
    expect(isDraining(draining)).toBe(true);

    const closed = await draining.awaitDrain();
    expect(isClosed(closed)).toBe(true);
    expect(drainSpy).toHaveBeenCalled();
    expect(driver.close).toHaveBeenCalled();
  });

  it("crash flow should transition from Live -> Error", async () => {
    const idle = createSession({ driver, scheduler, logger });
    const launching = await idle.start({ options: {} });
    const live = await launching.awaitLaunch();
    if (!isLive(live)) throw new Error("Expected Live session");

    const errorSession = await live.crash(new Error("disconnect"));
    expect(isError(errorSession)).toBe(true);
  });

  it("hooks should run on transitions", async () => {
    const hooks: SessionHooks = {
      onEnterLive: vi.fn(),
      onExitLive: vi.fn(),
      onEnterDraining: vi.fn(),
      onClosed: vi.fn(),
    };

    const idle = createSession({ driver, scheduler, logger, hooks });
    const launching = await idle.start({ options: {} });
    const live = await launching.awaitLaunch();
    if (!isLive(live)) throw new Error("Expected Live session");

    expect(hooks.onEnterLive).toHaveBeenCalledTimes(1);

    const draining = await live.end("test");
    await draining.awaitDrain();

    expect(hooks.onExitLive).toHaveBeenCalledTimes(1);
    expect(hooks.onEnterDraining).toHaveBeenCalledTimes(1);
    expect(hooks.onClosed).toHaveBeenCalledTimes(1);
  });
});
