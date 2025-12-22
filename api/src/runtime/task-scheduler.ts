import { FastifyBaseLogger } from "fastify";
import { Task } from "./types.js";

export class TaskScheduler {
  private tasks: Map<string, Task>;
  private taskCounter: number;
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.tasks = new Map();
    this.taskCounter = 0;
    this.logger = logger;
  }

  public async runCritical<T>(
    fn: () => Promise<T>,
    label: string,
    timeoutMs: number = 30000,
  ): Promise<T> {
    const taskId = `critical-${this.taskCounter++}`;
    this.logger.debug(`[TaskScheduler] Starting critical task: ${label} (${taskId})`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Critical task timeout: ${label}`)), timeoutMs),
    );

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      this.logger.debug(`[TaskScheduler] Completed critical task: ${label} (${taskId})`);
      return result;
    } catch (error) {
      this.logger.error(
        { err: error },
        `[TaskScheduler] Critical task failed: ${label} (${taskId})`,
      );
      throw error;
    }
  }

  public waitUntil(fn: (signal: AbortSignal) => Promise<void>, label?: string): void {
    const taskId = `background-${this.taskCounter++}`;
    const taskLabel = label || taskId;
    const abortController = new AbortController();

    const promise = fn(abortController.signal).catch((error) => {
      // TODO: should we throw?
      if (error?.name === "AbortError") {
        this.logger.debug(`[TaskScheduler] Background task aborted: ${taskLabel} (${taskId})`);
        return;
      }
      this.logger.error(
        { err: error },
        `[TaskScheduler] Background task failed: ${taskLabel} (${taskId})`,
      );
    });

    const task: Task = {
      id: taskId,
      label: taskLabel,
      promise,
      abortController,
      type: "background",
      startedAt: Date.now(),
    };

    this.tasks.set(taskId, task);
    task.promise.finally(() => {
      this.tasks.delete(taskId);
      this.logger.debug(`[TaskScheduler] Background task completed: ${taskLabel} (${taskId})`);
    });

    this.logger.debug(`[TaskScheduler] Scheduled background task: ${taskLabel} (${taskId})`);
  }

  public async drain(timeoutMs: number = 5000): Promise<void> {
    const pendingTasks = Array.from(this.tasks.values());
    if (pendingTasks.length === 0) {
      this.logger.debug("[TaskScheduler] No pending tasks to drain");
      return;
    }

    this.logger.info(
      `[TaskScheduler] Draining ${pendingTasks.length} pending tasks (timeout: ${timeoutMs}ms)`,
    );

    const allSettled = Promise.allSettled(pendingTasks.map((t) => t.promise)).then(() => undefined);
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("TaskScheduler drain timeout")), timeoutMs),
    );

    try {
      await Promise.race([allSettled, timeout]);
      this.logger.info("[TaskScheduler] All pending tasks drained successfully");
    } catch (err) {
      this.logger.warn(
        `[TaskScheduler] Drain timed out after ${timeoutMs}ms with ${this.tasks.size} tasks still pending`,
      );
    }
  }

  public cancelAll(reason: string): void {
    const count = this.tasks.size;
    if (count === 0) return;

    this.logger.info(`[TaskScheduler] Cancelling ${count} pending tasks (reason: ${reason})`);

    for (const task of this.tasks.values()) {
      task.abortController.abort(reason);
    }

    this.tasks.clear();
  }

  public getPendingCount(): number {
    return this.tasks.size;
  }

  public getPendingTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}
