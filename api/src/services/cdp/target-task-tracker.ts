interface TargetTaskRecord {
  promise: Promise<void>;
  suppressTargetClose: boolean;
}

export interface TargetTaskTrackerOptions {
  onError: (error: unknown) => void;
  onTimeout?: (pendingTasks: number) => void;
}

function targetCloseMessage(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const cause = "cause" in error ? targetCloseMessage(error.cause) : "";
  return `${error.name}: ${error.message}\n${cause}`;
}

export function isTargetCloseError(error: unknown): boolean {
  return /(?:TargetCloseError|Protocol error[^\n]*(?:Target|Session) closed|(?:Target|Session) closed)/i.test(
    targetCloseMessage(error),
  );
}

export class TargetTaskTracker {
  private readonly tasks = new Set<TargetTaskRecord>();
  private accepting = true;
  private generation = 0;

  constructor(private readonly options: TargetTaskTrackerOptions) {}

  get size(): number {
    return this.tasks.size;
  }

  schedule(task: (isActive: () => boolean) => Promise<void>): boolean {
    if (!this.accepting) return false;

    const generation = this.generation;
    const record: TargetTaskRecord = {
      promise: Promise.resolve(),
      suppressTargetClose: false,
    };
    const isActive = () => this.accepting && this.generation === generation;
    record.promise = Promise.resolve()
      .then(async () => await task(isActive))
      .catch((error) => {
        if (record.suppressTargetClose && isTargetCloseError(error)) return;
        try {
          this.options.onError(error);
        } catch {
          // Error reporting must never turn a contained target task into an unhandled rejection.
        }
      })
      .finally(() => {
        this.tasks.delete(record);
      });
    this.tasks.add(record);
    return true;
  }

  async stop(timeoutMs: number): Promise<boolean> {
    this.accepting = false;
    this.generation += 1;
    const pending = [...this.tasks];
    for (const record of pending) record.suppressTargetClose = true;
    if (pending.length === 0) return true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = Promise.allSettled(pending.map((record) => record.promise)).then(() => true);
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    });
    const completed = await Promise.race([drained, timedOut]);
    if (timer) clearTimeout(timer);
    if (!completed) {
      try {
        this.options.onTimeout?.(this.tasks.size);
      } catch {
        // Timeout reporting is best effort and must not break shutdown.
      }
    }
    return completed;
  }

  resume(): void {
    this.accepting = true;
  }
}
