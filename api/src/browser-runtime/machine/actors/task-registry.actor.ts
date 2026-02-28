import { FastifyBaseLogger } from "fastify";
import { fromCallback } from "xstate";
import { SupervisorEvent } from "../../types.js";

interface Task {
  id: string;
  label: string;
  promise: Promise<void>;
  abortController: AbortController;
  startedAt: number;
}

export interface TaskRegistryRef {
  waitUntil(fn: (signal: AbortSignal) => Promise<void>, label?: string): void;
  drain(timeoutMs: number): Promise<void>;
  cancelAll(reason: string): void;
  getPendingCount(): number;
}

export interface TaskRegistryInput {
  appLogger?: FastifyBaseLogger;
}

export const taskRegistryActor = fromCallback<SupervisorEvent, TaskRegistryInput>(
  ({ input, receive }) => {
    const tasks = new Map<string, Task>();
    let taskCounter = 0;
    const logger = input.appLogger;

    function waitUntil(fn: (signal: AbortSignal) => Promise<void>, label?: string): void {
      const taskId = `bg-${taskCounter++}`;
      const taskLabel = label || taskId;
      const abortController = new AbortController();

      logger?.debug(`[TaskRegistry] Scheduling background task: ${taskLabel} (${taskId})`);

      const promise = fn(abortController.signal).catch((error) => {
        if (error?.name === "AbortError") {
          logger?.debug(`[TaskRegistry] Background task aborted: ${taskLabel} (${taskId})`);
          return;
        }
        logger?.error(
          { err: error },
          `[TaskRegistry] Background task failed: ${taskLabel} (${taskId})`,
        );
      });

      const task: Task = {
        id: taskId,
        label: taskLabel,
        promise,
        abortController,
        startedAt: Date.now(),
      };

      tasks.set(taskId, task);
      promise.finally(() => {
        tasks.delete(taskId);
        logger?.debug(`[TaskRegistry] Background task completed: ${taskLabel} (${taskId})`);
      });
    }

    async function drain(timeoutMs: number): Promise<void> {
      const pendingTasks = Array.from(tasks.values());
      if (pendingTasks.length === 0) {
        logger?.debug("[TaskRegistry] No pending tasks to drain");
        return;
      }

      logger?.info(
        `[TaskRegistry] Draining ${pendingTasks.length} pending tasks (timeout: ${timeoutMs}ms)`,
      );

      const allSettled = Promise.allSettled(pendingTasks.map((t) => t.promise)).then(
        () => undefined,
      );
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("TaskRegistry drain timeout")), timeoutMs),
      );

      try {
        await Promise.race([allSettled, timeout]);
        logger?.info("[TaskRegistry] All pending tasks drained successfully");
      } catch (err) {
        logger?.warn(
          `[TaskRegistry] Drain timed out after ${timeoutMs}ms with ${tasks.size} tasks still pending`,
        );
      }
    }

    function cancelAll(reason: string): void {
      const count = tasks.size;
      if (count === 0) return;

      logger?.info(`[TaskRegistry] Cancelling ${count} pending tasks (reason: ${reason})`);

      for (const task of tasks.values()) {
        task.abortController.abort(reason);
      }

      tasks.clear();
    }

    // Handle messages to the actor
    receive((event: any) => {
      if (event.type === "WAIT_UNTIL") {
        waitUntil(event.fn, event.label);
      } else if (event.type === "DRAIN") {
        drain(event.timeoutMs).then(() => {
          event.resolve?.();
        });
      } else if (event.type === "CANCEL_ALL") {
        cancelAll(event.reason);
      } else if (event.type === "GET_STATUS") {
        event.resolve?.({
          count: tasks.size,
          tasks: Array.from(tasks.values()).map((t) => ({
            id: t.id,
            label: t.label,
            startedAt: t.startedAt,
          })),
        });
      }
    });

    // Return the ref for direct synchronous access if needed (though events are preferred)
    // In XState 5, we can also use 'output' or just interact via events.
    // For now, we'll expose the methods via the actor's system.

    return () => cancelAll("cleanup");
  },
);
