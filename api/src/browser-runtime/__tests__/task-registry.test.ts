import { describe, it, expect, beforeEach } from "vitest";
import { createActor } from "xstate";
import { taskRegistryActor } from "../machine/actors/task-registry.actor.js";
import { pino } from "pino";

import { FastifyBaseLogger } from "fastify";

describe("TaskRegistry", () => {
  const mockLogger = pino({ level: "silent" }) as unknown as FastifyBaseLogger;

  it("should track and complete background tasks", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    let completed = false;
    const task = async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed = true;
    };

    actor.send({ type: "WAIT_UNTIL", fn: task, label: "test-task" });

    // Wait for task to complete
    await new Promise((r) => setTimeout(r, 100));
    expect(completed).toBe(true);
  });

  it("should drain pending tasks", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    let completedCount = 0;
    const task = async () => {
      await new Promise((r) => setTimeout(r, 50));
      completedCount++;
    };

    actor.send({ type: "WAIT_UNTIL", fn: task, label: "task1" });
    actor.send({ type: "WAIT_UNTIL", fn: task, label: "task2" });

    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 500, resolve });
    });

    expect(completedCount).toBe(2);
  });

  it("should propagate abort signals", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    let aborted = false;
    const task = async (signal: AbortSignal) => {
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        });
      });
    };

    actor.send({ type: "WAIT_UNTIL", fn: task, label: "cancel-task" });
    actor.send({ type: "CANCEL_ALL", reason: "test-cancel" });

    // Give it a moment to process
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
  });

  it("should handle task errors gracefully", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    const failingTask = async () => {
      throw new Error("Task failed");
    };

    actor.send({ type: "WAIT_UNTIL", fn: failingTask, label: "failing-task" });

    // Should not crash, just complete
    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 500, resolve });
    });
  });

  it("should handle drain timeout", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    const slowTask = async () => {
      await new Promise((r) => setTimeout(r, 1000));
    };

    actor.send({ type: "WAIT_UNTIL", fn: slowTask, label: "slow-task" });

    const start = Date.now();
    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 100, resolve });
    });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(500); // Should resolve after timeoutMs
  });

  it("should isolate task failures", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    let task1Completed = false;
    let task3Completed = false;

    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        task1Completed = true;
      },
      label: "task1",
    });
    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        throw new Error("fail");
      },
      label: "task2",
    });
    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        task3Completed = true;
      },
      label: "task3",
    });

    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 500, resolve });
    });

    expect(task1Completed).toBe(true);
    expect(task3Completed).toBe(true);
  });

  it("should return count and pending tasks", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        await new Promise((r) => setTimeout(r, 100));
      },
      label: "task1",
    });
    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        await new Promise((r) => setTimeout(r, 100));
      },
      label: "task2",
    });

    const status = await new Promise<any>((resolve) => {
      actor.send({ type: "GET_STATUS", resolve });
    });

    expect(status.count).toBe(2);
    expect(status.tasks).toHaveLength(2);
    expect(status.tasks[0].label).toBe("task1");
  });

  it("should generate default labels if not provided", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    actor.send({ type: "WAIT_UNTIL", fn: async () => {} });

    const status = await new Promise<any>((resolve) => {
      actor.send({ type: "GET_STATUS", resolve });
    });

    expect(status.tasks[0].label).toMatch(/^bg-/);
  });

  it("should handle large number of concurrent tasks", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    let completedCount = 0;
    for (let i = 0; i < 100; i++) {
      actor.send({
        type: "WAIT_UNTIL",
        fn: async () => {
          completedCount++;
        },
        label: `task-${i}`,
      });
    }

    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 1000, resolve });
    });

    expect(completedCount).toBe(100);
  });

  it("should have 0 count after CANCEL_ALL", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        await new Promise((r) => setTimeout(r, 1000));
      },
    });
    actor.send({ type: "CANCEL_ALL", reason: "test" });

    const status = await new Promise<any>((resolve) => {
      actor.send({ type: "GET_STATUS", resolve });
    });

    expect(status.count).toBe(0);
  });

  it("should handle drain with 0 timeout", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        await new Promise((r) => setTimeout(r, 1000));
      },
    });

    const start = Date.now();
    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 0, resolve });
    });

    expect(Date.now() - start).toBeLessThan(100);
  });

  it("should handle task completing after drain timeout", async () => {
    const actor = createActor(taskRegistryActor, {
      input: { appLogger: mockLogger },
    });
    actor.start();

    let completed = false;
    actor.send({
      type: "WAIT_UNTIL",
      fn: async () => {
        await new Promise((r) => setTimeout(r, 200));
        completed = true;
      },
    });

    await new Promise<void>((resolve) => {
      actor.send({ type: "DRAIN", timeoutMs: 50, resolve });
    });

    expect(completed).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(completed).toBe(true);
  });
});
