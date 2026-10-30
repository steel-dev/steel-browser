import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn((...args: Parameters<typeof actual.spawn>) => actual.spawn(...args)),
  };
});

import { SeleniumService } from "./selenium.service.js";

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function createMockChildProcess(): ChildProcess & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const mockChild = new EventEmitter() as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  mockChild.stdout = new EventEmitter() as never;
  mockChild.stderr = new EventEmitter() as never;
  mockChild.kill = vi.fn().mockReturnValue(true) as never;
  return mockChild;
}

describe("SeleniumService", () => {
  let originalPath: string | undefined;
  let originalPathEnv: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalPathEnv = process.env.Path;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.Path = originalPathEnv;
    vi.restoreAllMocks();
  });

  describe("launch error handling", () => {
    it("rejects cleanly without uncaught exceptions when java is not in PATH", async () => {
      process.env.PATH = "";
      process.env.Path = "";

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      await expect(service.launch({})).rejects.toThrow();

      // Check logger captured the error
      expect(logger.error).toHaveBeenCalled();
      const errorCalls = logger.error.mock.calls.map((call) => call[0]);
      expect(errorCalls.some((msg) => typeof msg === "string" && msg.includes("Selenium process error"))).toBe(true);

      // Verify service remains in a safe idle state and subsequent close() does not throw
      expect(() => service.close()).not.toThrow();
    });

    it("rejects when the child process emits an error event", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({});

      const spawnError = new Error("spawn java ENOENT");
      mockChild.emit("error", spawnError);

      await expect(launchPromise).rejects.toThrow("spawn java ENOENT");
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Selenium process error: Error: spawn java ENOENT"));
      expect(() => service.close()).not.toThrow();
    });

    it("rejects when the child process exits prematurely before becoming ready", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({});

      mockChild.emit("close", 1);

      await expect(launchPromise).rejects.toThrow("Selenium process exited prematurely with code 1");
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Selenium process exited with code 1"));
      expect(() => service.close()).not.toThrow();
    });

    it("resolves when the selenium standalone server starts successfully", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({});

      mockChild.stdout.emit("data", Buffer.from("Started Selenium Standalone 4.25.0"));

      await expect(launchPromise).resolves.toBeUndefined();
      expect(service.getSeleniumServerUrl()).toBe("http://localhost:4444");

      // Verify close kills the running process
      service.close();
      expect(mockChild.kill).toHaveBeenCalledWith("SIGINT");
    });

    it("times out and cleans up if startup message is not received", async () => {
      vi.useFakeTimers();

      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({});

      // Fast-forward past 15 seconds
      vi.advanceTimersByTime(15000);

      await expect(launchPromise).rejects.toThrow("Selenium server failed to start within the timeout period");
      expect(mockChild.kill).toHaveBeenCalledWith("SIGINT");

      vi.useRealTimers();
    });

    it("closes existing process before launching a new one", async () => {
      const mockChild1 = createMockChildProcess();
      const mockChild2 = createMockChildProcess();

      let spawnCount = 0;
      vi.mocked(spawn).mockImplementation((() => {
        spawnCount++;
        return spawnCount === 1 ? mockChild1 : mockChild2;
      }) as never);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const firstLaunch = service.launch({});
      mockChild1.stdout.emit("data", Buffer.from("Started Selenium Standalone"));
      await firstLaunch;

      const secondLaunch = service.launch({});
      await Promise.resolve();

      expect(mockChild1.kill).toHaveBeenCalledWith("SIGINT");

      mockChild2.stdout.emit("data", Buffer.from("Started Selenium Standalone"));
      await secondLaunch;
    });
  });
});
