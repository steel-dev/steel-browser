import { FastifyBaseLogger } from "fastify";
import { Browser, Page } from "puppeteer-core";
import { BrowserLauncherOptions } from "../types/browser.js";
import { BrowserDriver } from "./browser-driver.js";
import { SessionHooks, invokeHook } from "./hooks.js";
import { TaskScheduler } from "./task-scheduler.js";
import {
  ClosedSession,
  DrainingSession,
  ErrorSession,
  FailedFromState,
  IdleSession,
  LaunchError,
  LaunchingSession,
  LiveSession,
} from "./types.js";

interface SessionContext {
  driver: BrowserDriver;
  scheduler: TaskScheduler;
  logger: FastifyBaseLogger;
  hooks?: SessionHooks;
}

class IdleSessionImpl implements IdleSession {
  readonly _state = "idle" as const;

  constructor(private readonly ctx: SessionContext) {}

  async start(config: BrowserLauncherOptions): Promise<LaunchingSession> {
    this.ctx.logger.info("[Session] Idle → Launching");
    return new LaunchingSessionImpl(this.ctx, config);
  }
}

class LaunchingSessionImpl implements LaunchingSession {
  readonly _state = "launching" as const;
  private launchPromise: Promise<LiveSession | ErrorSession> | null = null;

  constructor(
    private readonly ctx: SessionContext,
    readonly config: BrowserLauncherOptions,
  ) {}

  async awaitLaunch(): Promise<LiveSession | ErrorSession> {
    if (!this.launchPromise) {
      this.launchPromise = this.performLaunch();
    }
    return this.launchPromise;
  }

  private async performLaunch(): Promise<LiveSession | ErrorSession> {
    try {
      const { browser, primaryPage } = await this.ctx.scheduler.runCritical(
        () => this.ctx.driver.launch(this.config),
        "browser-launch",
        60000,
      );

      this.ctx.logger.info("[Session] Launching → Live");

      const liveSession = new LiveSessionImpl(this.ctx, this.config, browser, primaryPage);

      await invokeHook(this.ctx.hooks, "onEnterLive", liveSession);

      return liveSession;
    } catch (error) {
      this.ctx.logger.error({ err: error }, "[Session] Launch failed → Error");

      const launchError = error instanceof Error ? error : new Error(String(error));

      await invokeHook(this.ctx.hooks, "onLaunchFailed", launchError);

      const errorSession = new ErrorSessionImpl(
        this.ctx,
        new LaunchError("Browser launch failed", launchError),
        "launching",
      );

      await invokeHook(this.ctx.hooks, "onEnterError", errorSession);

      return errorSession;
    }
  }
}

class LiveSessionImpl implements LiveSession {
  readonly _state = "live" as const;

  constructor(
    private readonly ctx: SessionContext,
    readonly config: BrowserLauncherOptions,
    readonly browser: Browser,
    readonly primaryPage: Page,
  ) {}

  async end(reason: string): Promise<DrainingSession> {
    this.ctx.logger.info(`[Session] Live → Draining (reason: ${reason})`);

    await invokeHook(this.ctx.hooks, "onExitLive", this);

    const drainingSession = new DrainingSessionImpl(this.ctx, this.browser, reason);

    await invokeHook(this.ctx.hooks, "onEnterDraining", drainingSession);

    return drainingSession;
  }
}

class DrainingSessionImpl implements DrainingSession {
  readonly _state = "draining" as const;
  private drainPromise: Promise<ClosedSession | ErrorSession> | null = null;

  constructor(
    private readonly ctx: SessionContext,
    readonly browser: Browser,
    readonly reason: string,
  ) {}

  async awaitDrain(): Promise<ClosedSession | ErrorSession> {
    if (!this.drainPromise) {
      this.drainPromise = this.performDrain();
    }
    return this.drainPromise;
  }

  private async performDrain(): Promise<ClosedSession | ErrorSession> {
    try {
      this.ctx.logger.info("[Session] Draining pending tasks...");

      // 1. Drain pending tasks with timeout
      await this.ctx.scheduler.drain(5000);

      // 2. Close browser
      this.ctx.logger.info("[Session] Closing browser...");
      await this.ctx.driver.close();

      // 3. Cancel any remaining tasks
      this.ctx.scheduler.cancelAll(this.reason);

      this.ctx.logger.info("[Session] Draining → Closed");

      const closedSession = new ClosedSessionImpl(this.ctx);

      await invokeHook(this.ctx.hooks, "onClosed", closedSession);

      return closedSession;
    } catch (error) {
      this.ctx.logger.error({ err: error }, "[Session] Drain failed → Error");

      const drainError = error instanceof Error ? error : new Error(String(error));

      const errorSession = new ErrorSessionImpl(this.ctx, drainError, "draining");

      await invokeHook(this.ctx.hooks, "onEnterError", errorSession);

      return errorSession;
    }
  }
}

class ErrorSessionImpl implements ErrorSession {
  readonly _state = "error" as const;

  constructor(
    private readonly ctx: SessionContext,
    readonly error: Error,
    readonly failedFrom: FailedFromState,
  ) {}

  async recover(): Promise<IdleSession> {
    this.ctx.logger.info(`[Session] Error → Idle (recover, failedFrom: ${this.failedFrom})`);

    if (this.failedFrom === "live" || this.failedFrom === "draining") {
      this.ctx.logger.info("[Session] Cleaning up browser resources before recovery");
      await this.ctx.driver.forceClose();
    }

    this.ctx.scheduler.cancelAll("error-recovery");

    return new IdleSessionImpl(this.ctx);
  }

  async terminate(): Promise<ClosedSession> {
    this.ctx.logger.info(`[Session] Error → Closed (terminate, failedFrom: ${this.failedFrom})`);

    this.ctx.logger.info("[Session] Force closing browser on terminate");
    await this.ctx.driver.forceClose();

    this.ctx.scheduler.cancelAll("error-terminate");

    return new ClosedSessionImpl(this.ctx);
  }
}

class ClosedSessionImpl implements ClosedSession {
  readonly _state = "closed" as const;

  constructor(private readonly ctx: SessionContext) {}

  restart(): IdleSession {
    this.ctx.logger.info("[Session] Closed → Idle (restart)");
    return new IdleSessionImpl(this.ctx);
  }
}

export interface CreateSessionConfig {
  driver: BrowserDriver;
  scheduler: TaskScheduler;
  logger: FastifyBaseLogger;
  hooks?: SessionHooks;
}

export function createSession(config: CreateSessionConfig): IdleSession {
  const ctx: SessionContext = {
    driver: config.driver,
    scheduler: config.scheduler,
    logger: config.logger.child({ component: "Session" }),
    hooks: config.hooks,
  };

  return new IdleSessionImpl(ctx);
}
