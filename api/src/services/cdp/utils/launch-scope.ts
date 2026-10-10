import { LaunchTimeoutError } from "../errors/launch-errors.js";

/** A deadline is also a fence: work resolving late must never publish a browser. */
export class LaunchScope {
  private controller = new AbortController();
  private deadline: number;
  private timer: ReturnType<typeof setTimeout>;
  private pending = new Set<Promise<unknown>>();
  private resources = new Map<unknown, () => Promise<void>>();
  private cleanupError: unknown;
  private cancelled: Promise<never>;
  private detach: () => void;

  constructor(timeoutMs: number, signal?: AbortSignal) {
    this.deadline = Date.now() + timeoutMs;
    this.cancelled = new Promise((_, reject) => {
      this.controller.signal.addEventListener(
        "abort",
        () => {
          reject(this.controller.signal.reason);
          for (const resource of this.resources.keys()) this.closeResource(resource);
        },
        { once: true },
      );
    });
    // Cancellation can arrive before the first step is scheduled.
    void this.cancelled.catch(() => {});
    this.timer = setTimeout(() => this.abort(new LaunchTimeoutError(timeoutMs)), timeoutMs);
    const onAbort = () => this.abort(signal!.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    this.detach = () => signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) onAbort();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  remaining(): number {
    this.signal.throwIfAborted();
    return Math.max(1, this.deadline - Date.now());
  }

  abort(reason: unknown): void {
    if (!this.signal.aborted) this.controller.abort(reason);
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return task;
  }

  async step<T>(operation: () => T | Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const task = this.track(
      Promise.resolve().then(() => {
        this.signal.throwIfAborted();
        return operation();
      }),
    );
    const result = await Promise.race([task, this.cancelled]);
    this.signal.throwIfAborted();
    return result;
  }

  /** Register ownership before returning, including a browser delivered after cancellation. */
  async own<T>(operation: () => Promise<T>, close: (resource: T) => Promise<void>): Promise<T> {
    return this.step(() =>
      this.track(
        operation().then(async (resource) => {
          this.resources.set(resource, () => close(resource));
          if (this.signal.aborted) {
            await this.closeResource(resource);
            this.signal.throwIfAborted();
          }
          return resource;
        }),
      ),
    );
  }

  private closeResource(resource: unknown): Promise<void> {
    const close = this.resources.get(resource);
    if (!close) return Promise.resolve();
    this.resources.delete(resource);
    return this.track(
      Promise.resolve()
        .then(close)
        .catch((error) => {
          this.cleanupError = error;
        }),
    );
  }

  async closeResources(): Promise<void> {
    await Promise.all([...this.resources.keys()].map((resource) => this.closeResource(resource)));
    if (this.cleanupError) throw this.cleanupError;
  }

  /** Keep the singleton reserved until late work and owned-resource cleanup settle. */
  async drained(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    if (this.cleanupError) throw this.cleanupError;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.detach();
    this.resources.clear();
  }
}
