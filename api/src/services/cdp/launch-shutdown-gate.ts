import type { ChildProcess } from "node:child_process";
import {
  BrowserProcessError,
  BrowserProcessState,
  ConfigurationError,
} from "./errors/launch-errors.js";
interface BrowserHandle {
  process(): ChildProcess | null;
  close(): Promise<void>;
}

/** Permanent application-shutdown fence, independent of normal session relaunch cleanup. */
export class LaunchShutdownGate {
  private reason: Error | undefined;
  constructor(
    private readonly reportError: (error: unknown) => void,
    private readonly onUnconfirmedLaunch?: (error: Error) => void,
  ) {}
  seal(reason = new ConfigurationError("Application shutdown prevents browser launch")): void {
    this.reason ??= reason;
  }
  assertOpen(): void {
    if (this.reason) throw this.reason;
  }
  /** A failed launcher can return before its child process cleanup completes. */
  async launch<T extends BrowserHandle>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    try {
      return this.accept(await operation());
    } catch (cause) {
      if (this.reason) throw this.reason;
      const error = new BrowserProcessError(
        "Browser startup failed before process cleanup could be confirmed",
        BrowserProcessState.LAUNCH_FAILED,
        cause,
        undefined,
        false,
      );
      this.seal(error);
      this.onUnconfirmedLaunch?.(error);
      throw error;
    }
  }

  accept<T extends BrowserHandle>(browser: T): T {
    if (!this.reason) return browser;
    // Never publish a browser returned by a launch that outlived shutdown.
    // Do not wait for plugin/browser cleanup before rejecting this launch.
    try {
      const proc = browser.process();
      if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    } catch (error) {
      this.reportError(error);
    }
    void Promise.resolve()
      .then(() => browser.close())
      .catch(this.reportError);
    this.assertOpen();
    throw new Error("Unreachable shutdown fence");
  }
}
