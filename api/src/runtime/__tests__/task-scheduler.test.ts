import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskScheduler } from "../task-scheduler.js";
import { FastifyBaseLogger } from "fastify";

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    scheduler = new TaskScheduler(mockLogger);
  });

  describe("runCritical", () => {
    it("should execute critical task and return result", async () => {
      const result = await scheduler.runCritical(async () => "success", "test-task");
      expect(result).toBe("success");
    });

    it("should throw error if critical task fails", async () => {
      const error = new Error("Task failed");
      await expect(
        scheduler.runCritical(async () => {
          throw error;
        }, "test-task"),
      ).rejects.toThrow("Task failed");
    });
  });

  describe("waitUntil", () => {
    it("should track background task", async () => {
      scheduler.waitUntil(async () => {});

      // Drain should complete immediately since task is already resolved
      await scheduler.drain(1000);
    });

    it("should handle task errors gracefully", async () => {
      scheduler.waitUntil(async () => {
        throw new Error("Background error");
      });

      // Should not throw, just log
      await scheduler.drain(1000);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should track multiple tasks", async () => {
      scheduler.waitUntil(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      });
      scheduler.waitUntil(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      });

      await scheduler.drain(200);
    });

    it("should pass AbortSignal to task function", async () => {
      let receivedSignal: AbortSignal | undefined;

      scheduler.waitUntil(async (signal) => {
        receivedSignal = signal;
      });

      await scheduler.drain(100);

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("cancelAll", () => {
    it("should clear all pending tasks", async () => {
      scheduler.waitUntil(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      });
      scheduler.waitUntil(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      });

      scheduler.cancelAll("test-cancel");

      // Drain should complete immediately since tasks were cancelled
      const start = Date.now();
      await scheduler.drain(100);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it("should abort all pending tasks with reason", async () => {
      const abortReasons: string[] = [];

      scheduler.waitUntil(async (signal) => {
        signal.addEventListener("abort", () => {
          abortReasons.push(signal.reason);
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      });

      scheduler.waitUntil(async (signal) => {
        signal.addEventListener("abort", () => {
          abortReasons.push(signal.reason);
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      });

      scheduler.cancelAll("shutdown-reason");

      // Give time for abort handlers to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(abortReasons).toEqual(["shutdown-reason", "shutdown-reason"]);
    });

    it("should not log error for aborted tasks", async () => {
      let taskStarted = false;

      scheduler.waitUntil(async (signal) => {
        taskStarted = true;
        // Create a promise that rejects with AbortError when signal is aborted
        return new Promise<void>((resolve, reject) => {
          const checkAbort = () => {
            if (signal.aborted) {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            }
          };
          signal.addEventListener("abort", checkAbort);
          // Also check immediately in case already aborted
          checkAbort();
          // Keep task running until aborted
          setTimeout(resolve, 1000);
        });
      });

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(taskStarted).toBe(true);

      scheduler.cancelAll("test-abort");

      // Wait for abort to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should log debug for abort, not error
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("aborted"));
      // Should not have logged error for the abort
      const errorCalls = (mockLogger.error as any).mock.calls;
      const abortErrorCalls = errorCalls.filter(
        (call: any[]) => call[0]?.err?.name === "AbortError",
      );
      expect(abortErrorCalls.length).toBe(0);
    });
  });

  describe("drain", () => {
    it("should wait for all pending tasks", async () => {
      let completed = false;

      scheduler.waitUntil(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            completed = true;
            resolve(undefined);
          }, 50);
        });
      });

      await scheduler.drain(200);

      expect(completed).toBe(true);
    });

    it("should timeout if tasks take too long", async () => {
      scheduler.waitUntil(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      });

      await scheduler.drain(50);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Drain timed out"));
    });

    it("should complete immediately if no pending tasks", async () => {
      const start = Date.now();
      await scheduler.drain(1000);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});
