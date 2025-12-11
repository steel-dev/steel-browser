import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
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

    it("should log start and finish of critical task", async () => {
      await scheduler.runCritical(async () => "done", "my-critical-task");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Starting critical task: my-critical-task"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Completed critical task: my-critical-task"),
      );
    });

    it("should log error when critical task fails", async () => {
      const error = new Error("Critical failure");

      await expect(
        scheduler.runCritical(async () => {
          throw error;
        }, "failing-task"),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error }),
        expect.stringContaining("Critical task failed: failing-task"),
      );
    });

    it("should timeout critical task after specified duration", async () => {
      const slowTask = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "too late";
      };

      await expect(scheduler.runCritical(slowTask, "slow-task", 50)).rejects.toThrow(
        "Critical task timeout: slow-task",
      );
    });

    it("should use default timeout of 30000ms", async () => {
      vi.useFakeTimers();

      const neverResolves = new Promise(() => {});
      const taskPromise = scheduler.runCritical(
        () => neverResolves as Promise<void>,
        "infinite-task",
      );

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);

      await expect(taskPromise).rejects.toThrow("Critical task timeout");

      vi.useRealTimers();
    });

    it("should return result before timeout", async () => {
      const quickTask = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "quick result";
      };

      const result = await scheduler.runCritical(quickTask, "quick-task", 1000);
      expect(result).toBe("quick result");
    });

    it("should support different return types", async () => {
      const numberResult = await scheduler.runCritical(async () => 42, "number-task");
      expect(numberResult).toBe(42);

      const objectResult = await scheduler.runCritical(async () => ({ foo: "bar" }), "object-task");
      expect(objectResult).toEqual({ foo: "bar" });

      const arrayResult = await scheduler.runCritical(async () => [1, 2, 3], "array-task");
      expect(arrayResult).toEqual([1, 2, 3]);
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

    it("should log when no pending tasks", async () => {
      await scheduler.drain(100);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("No pending tasks to drain"),
      );
    });

    it("should log pending task count when draining", async () => {
      scheduler.waitUntil(async () => {});
      scheduler.waitUntil(async () => {});

      await scheduler.drain(100);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Draining 2 pending tasks"),
      );
    });

    it("should log success when all tasks complete", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await scheduler.drain(500);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("All pending tasks drained successfully"),
      );
    });

    it("should handle multiple drain calls in sequence", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      await scheduler.drain(100);
      await scheduler.drain(100);

      // Second drain should complete immediately
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("No pending tasks to drain"),
      );
    });

    it("should report remaining tasks count on timeout", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }, "long-task");

      await scheduler.drain(10);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("1 tasks still pending"),
      );
    });
  });

  describe("getPendingCount", () => {
    it("should return 0 initially", () => {
      expect(scheduler.getPendingCount()).toBe(0);
    });

    it("should count pending tasks", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(scheduler.getPendingCount()).toBe(2);

      await scheduler.drain(200);
      expect(scheduler.getPendingCount()).toBe(0);
    });

    it("should decrease count as tasks complete", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(scheduler.getPendingCount()).toBe(2);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(scheduler.getPendingCount()).toBe(1);

      await scheduler.drain(200);
      expect(scheduler.getPendingCount()).toBe(0);
    });
  });

  describe("getPendingTasks", () => {
    it("should return empty array initially", () => {
      expect(scheduler.getPendingTasks()).toEqual([]);
    });

    it("should return task info for pending tasks", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }, "task-1");
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }, "task-2");

      const tasks = scheduler.getPendingTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toHaveProperty("id");
      expect(tasks[0]).toHaveProperty("label", "task-1");
      expect(tasks[0]).toHaveProperty("type", "background");
      expect(tasks[0]).toHaveProperty("startedAt");
      expect(tasks[1].label).toBe("task-2");

      await scheduler.drain(200);
    });

    it("should include abortController in task info", async () => {
      scheduler.waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const tasks = scheduler.getPendingTasks();

      expect(tasks[0].abortController).toBeInstanceOf(AbortController);

      scheduler.cancelAll("cleanup");
    });
  });

  describe("Task Labels", () => {
    it("should use custom label when provided", async () => {
      scheduler.waitUntil(async () => {}, "my-custom-label");

      await scheduler.drain(100);

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("my-custom-label"));
    });

    it("should generate task ID as label when not provided", async () => {
      scheduler.waitUntil(async () => {});

      await scheduler.drain(100);

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("background-"));
    });
  });

  describe("Concurrent Task Operations", () => {
    it("should handle many concurrent tasks", async () => {
      const results: number[] = [];

      for (let i = 0; i < 50; i++) {
        const idx = i;
        scheduler.waitUntil(async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
          results.push(idx);
        });
      }

      expect(scheduler.getPendingCount()).toBe(50);

      await scheduler.drain(2000);

      expect(results).toHaveLength(50);
      expect(scheduler.getPendingCount()).toBe(0);
    });

    it("should isolate task failures", async () => {
      const completed: string[] = [];

      scheduler.waitUntil(async () => {
        completed.push("task1");
      }, "task1");

      scheduler.waitUntil(async () => {
        throw new Error("task2 failed");
      }, "task2");

      scheduler.waitUntil(async () => {
        completed.push("task3");
      }, "task3");

      await scheduler.drain(100);

      // task1 and task3 should complete despite task2 failing
      expect(completed).toContain("task1");
      expect(completed).toContain("task3");
    });
  });
});
