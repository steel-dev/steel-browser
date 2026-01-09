import { describe, it, expect, vi, beforeEach } from "vitest";
import { startTaskRegistry } from "../actors/task-registry.js";
import { pino } from "pino";

describe("TaskRegistry", () => {
  const mockLogger = pino({ level: "silent" });

  it("should track and complete background tasks", async () => {
    const registry = startTaskRegistry({ appLogger: mockLogger as any }, () => {});

    let completed = false;
    const task = async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed = true;
    };

    registry.waitUntil(task, "test-task");
    expect(registry.getPendingCount()).toBe(1);

    await new Promise((r) => setTimeout(r, 50));
    expect(completed).toBe(true);
    expect(registry.getPendingCount()).toBe(0);
  });

  it("should drain pending tasks", async () => {
    const registry = startTaskRegistry({ appLogger: mockLogger as any }, () => {});

    let completedCount = 0;
    const task = async () => {
      await new Promise((r) => setTimeout(r, 50));
      completedCount++;
    };

    registry.waitUntil(task, "task1");
    registry.waitUntil(task, "task2");

    await registry.drain(500);
    expect(completedCount).toBe(2);
    expect(registry.getPendingCount()).toBe(0);
  });

  it("should propagate abort signals", async () => {
    const registry = startTaskRegistry({ appLogger: mockLogger as any }, () => {});

    let aborted = false;
    const task = async (signal: AbortSignal) => {
      return new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });
    };

    registry.waitUntil(task, "cancel-task");
    registry.cancelAll("test-cancel");

    expect(aborted).toBe(true);
    expect(registry.getPendingCount()).toBe(0);
  });

  it("should timeout on slow drain", async () => {
    const registry = startTaskRegistry({ appLogger: mockLogger as any }, () => {});

    const slowTask = async () => {
      await new Promise((r) => setTimeout(r, 1000));
    };

    registry.waitUntil(slowTask, "slow-task");

    const startTime = Date.now();
    await registry.drain(50);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(200);
    expect(registry.getPendingCount()).toBe(1);
  });
});
