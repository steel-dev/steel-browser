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
      const task = Promise.resolve("done").then(() => {});
      scheduler.waitUntil(task);

      // Drain should complete immediately since task is already resolved
      await scheduler.drain(1000);
    });

    it("should handle task errors gracefully", async () => {
      const task = Promise.reject(new Error("Background error"));
      scheduler.waitUntil(task);

      // Should not throw, just log
      await scheduler.drain(1000);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should track multiple tasks", async () => {
      const task1 = new Promise<void>((resolve) => setTimeout(resolve, 50));
      const task2 = new Promise<void>((resolve) => setTimeout(resolve, 100));

      scheduler.waitUntil(task1);
      scheduler.waitUntil(task2);

      await scheduler.drain(200);
    });
  });

  describe("drain", () => {
    it("should wait for all pending tasks", async () => {
      let completed = false;
      const task = new Promise<void>((resolve) => {
        setTimeout(() => {
          completed = true;
          resolve(undefined);
        }, 50);
      });

      scheduler.waitUntil(task);
      await scheduler.drain(200);

      expect(completed).toBe(true);
    });

    it("should timeout if tasks take too long", async () => {
      const task = new Promise<void>((resolve) => setTimeout(resolve, 200));
      scheduler.waitUntil(task);

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

  describe("cancelAll", () => {
    it("should clear all pending tasks", async () => {
      const task1 = new Promise<void>((resolve) => setTimeout(resolve, 1000));
      const task2 = new Promise<void>((resolve) => setTimeout(resolve, 1000));

      scheduler.waitUntil(task1);
      scheduler.waitUntil(task2);

      scheduler.cancelAll("test-cancel");

      // Drain should complete immediately since tasks were cancelled
      const start = Date.now();
      await scheduler.drain(100);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});
