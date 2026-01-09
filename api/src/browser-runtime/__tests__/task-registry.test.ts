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
});
