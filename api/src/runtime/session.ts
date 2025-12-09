import { Browser, Page } from "puppeteer-core";
import { FastifyBaseLogger } from "fastify";
import { BrowserLauncherOptions } from "../types/browser.js";
import { BrowserDriver } from "./browser-driver.js";
import { TaskScheduler } from "./task-scheduler.js";
import { SessionHooks, invokeHook } from "./hooks.js";
import {
  IdleSession,
  LaunchingSession,
  LiveSession,
  DrainingSession,
  ClosedSession,
  LaunchError,
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
  readonly launched: Promise<LiveSession | ClosedSession>;

  constructor(
    private readonly ctx: SessionContext,
    readonly config: BrowserLauncherOptions,
  ) {
    this.launched = this.performLaunch();
  }

  private async performLaunch(): Promise<LiveSession | ClosedSession> {
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
      this.ctx.logger.error({ err: error }, "[Session] Launch failed → Closed");

      const launchError = error instanceof Error ? error : new Error(String(error));

      await invokeHook(this.ctx.hooks, "onLaunchFailed", launchError);

      const closedSession = new ClosedSessionImpl(
        this.ctx,
        new LaunchError("Browser launch failed", launchError),
      );

      await invokeHook(this.ctx.hooks, "onClosed", closedSession);

      return closedSession;
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
  readonly drained: Promise<ClosedSession>;

  constructor(
    private readonly ctx: SessionContext,
    readonly browser: Browser,
    readonly reason: string,
  ) {
    this.drained = this.performDrain();
  }

  private async performDrain(): Promise<ClosedSession> {
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
  }
}

class ClosedSessionImpl implements ClosedSession {
  readonly _state = "closed" as const;

  constructor(
    private readonly ctx: SessionContext,
    readonly error?: Error,
  ) {}

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
