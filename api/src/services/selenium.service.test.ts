import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
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
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("launch error handling", () => {
    it("rejects cleanly without uncaught exceptions on ENOENT (no PATH)", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({} as never);

      const spawnError = new Error("spawn java ENOENT");
      mockChild.emit("error", spawnError);

      await expect(launchPromise).rejects.toThrow("spawn java ENOENT");

      // Check logger captured the error (object form, consistent with service S3 logging)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: spawnError }),
        expect.stringContaining("Selenium process error"),
      );

      // Verify service remains in a safe idle state and subsequent close() does not throw
      expect(() => service.close()).not.toThrow();
    });

    it("rejects when the child process emits an error event", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({} as never);

      const spawnError = Object.assign(new Error("spawn java ENOENT"), {
        code: "ENOENT",
      });
      mockChild.emit("error", spawnError);

      await expect(launchPromise).rejects.toMatchObject({
        code: "ENOENT",
        message: expect.stringContaining("spawn java ENOENT"),
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: spawnError }),
        expect.stringContaining("Selenium process error"),
      );
      expect(() => service.close()).not.toThrow();
    });

    it("rejects when the child process exits prematurely before becoming ready", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({} as never);

      mockChild.emit("close", 1);

      await expect(launchPromise).rejects.toThrow(
        "Selenium process exited prematurely with code 1",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ code: 1 }),
        expect.stringContaining("Selenium process exited"),
      );
      expect(() => service.close()).not.toThrow();
    });

    it("resolves when the selenium standalone server starts successfully", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({} as never);

      mockChild.stdout.emit("data", Buffer.from("Started Selenium Standalone 4.25.0"));

      await expect(launchPromise).resolves.toBeUndefined();
      expect(service.getSeleniumServerUrl()).toBe("http://localhost:4444");

      // Verify transient startup listeners are cleaned up, leaving only permanent handlers
      expect(mockChild.listenerCount("error")).toBe(1);
      expect(mockChild.listenerCount("close")).toBe(1);
      expect(mockChild.stdout.listenerCount("data")).toBe(1);
      expect(mockChild.stderr.listenerCount("data")).toBe(1);

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

      const launchPromise = service.launch({} as never);

      // Fast-forward past 15 seconds
      vi.advanceTimersByTime(15000);

      await expect(launchPromise).rejects.toThrow(
        "Selenium server failed to start within the timeout period",
      );
      expect(mockChild.kill).toHaveBeenCalledWith("SIGINT");
    });

    it("resolves when startup message arrives in split chunks", async () => {
      const mockChild = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const launchPromise = service.launch({} as never);

      mockChild.stdout.emit("data", Buffer.from("Started Selenium "));
      mockChild.stdout.emit("data", Buffer.from("Standalone"));

      await expect(launchPromise).resolves.toBeUndefined();
      expect(service.getSeleniumServerUrl()).toBe("http://localhost:4444");
      service.close();
    });

    it("recovers and resolves after a failed launch", async () => {
      const mockChild1 = createMockChildProcess();
      const mockChild2 = createMockChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(mockChild1).mockReturnValueOnce(mockChild2);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const firstLaunch = service.launch({} as never);
      mockChild1.emit("error", new Error("spawn java ENOENT"));
      await expect(firstLaunch).rejects.toThrow("spawn java ENOENT");

      const secondLaunch = service.launch({} as never);
      mockChild2.stdout.emit("data", Buffer.from("Started Selenium Standalone"));
      await expect(secondLaunch).resolves.toBeUndefined();
      expect(service.getSeleniumServerUrl()).toBe("http://localhost:4444");
      service.close();
      expect(mockChild2.kill).toHaveBeenCalledWith("SIGINT");
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

      const firstLaunch = service.launch({} as never);
      mockChild1.stdout.emit("data", Buffer.from("Started Selenium Standalone"));
      await firstLaunch;

      const secondLaunch = service.launch({} as never);
      await Promise.resolve();

      expect(mockChild1.kill).toHaveBeenCalledWith("SIGINT");

      mockChild2.stdout.emit("data", Buffer.from("Started Selenium Standalone"));
      await secondLaunch;
    });

    it("does not kill or nullify a newer process if an older superseded process closes or fails", async () => {
      const mockChild1 = createMockChildProcess();
      const mockChild2 = createMockChildProcess();

      let spawnCount = 0;
      vi.mocked(spawn).mockImplementation((() => {
        spawnCount++;
        return spawnCount === 1 ? mockChild1 : mockChild2;
      }) as never);

      const logger = createMockLogger();
      const service = new SeleniumService(logger as never);

      const firstLaunch = service.launch({} as never);
      // Before firstLaunch settles, second launch starts and supersedes mockChild1
      const secondLaunch = service.launch({} as never);

      // Flush microtasks so the second spawn occurs before mockChild1 fails;
      // otherwise the test is vacuous (mockChild2 not yet spawned).
      await Promise.resolve();
      await Promise.resolve();

      // Non-vacuity proof: second launch actually spawned and cleaned up the first.
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(mockChild1.kill).toHaveBeenCalledWith("SIGINT");

      // Now mockChild1 fails during its startup
      mockChild1.emit("error", new Error("first launch failed"));
      await expect(firstLaunch).rejects.toThrow("first launch failed");

      // mockChild2 should NOT have been killed by mockChild1's catch block
      expect(mockChild2.kill).not.toHaveBeenCalled();

      // mockChild1 emits close
      mockChild1.emit("close", 1);

      // mockChild2 finishes startup
      mockChild2.stdout.emit("data", Buffer.from("Started Selenium Standalone"));
      await secondLaunch;

      // Closing service should target mockChild2 (it was not nullified by mockChild1's close)
      service.close();
      expect(mockChild2.kill).toHaveBeenCalledWith("SIGINT");
    });
  });
});
