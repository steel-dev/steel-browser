import { FastifyBaseLogger } from "fastify";
import { Browser, Page } from "puppeteer-core";
import {
  SessionState,
  RuntimeEvent,
  RuntimeCommand,
  SessionContext,
  TransitionHook,
  StartCommand,
  EndCommand,
} from "./types.js";
import { BrowserDriver } from "./browser-driver.js";
import { TaskScheduler } from "./task-scheduler.js";
import { BrowserLauncherOptions } from "../types/browser.js";

export interface SessionMachineConfig {
  driver: BrowserDriver;
  scheduler: TaskScheduler;
  logger: FastifyBaseLogger;
  hooks?: TransitionHook[];
}

export class SessionMachine {
  private state: SessionState;
  private ctx: SessionContext;
  private commandQueue: RuntimeCommand[];
  private isProcessing: boolean;
  private driver: BrowserDriver;
  private scheduler: TaskScheduler;
  private logger: FastifyBaseLogger;
  private hooks: TransitionHook[];

  constructor(config: SessionMachineConfig) {
    this.state = SessionState.Idle;
    this.ctx = {};
    this.commandQueue = [];
    this.isProcessing = false;
    this.driver = config.driver;
    this.scheduler = config.scheduler;
    this.logger = config.logger.child({ component: "SessionMachine" });
    this.hooks = config.hooks || [];

    // Listen to driver events
    this.driver.on("event", (event: RuntimeEvent) => {
      this.handleEvent(event);
    });
  }

  public getState(): SessionState {
    return this.state;
  }

  public getContext(): SessionContext {
    return this.ctx;
  }

  public addHook(hook: TransitionHook): void {
    this.hooks.push(hook);
  }

  public async start(config: BrowserLauncherOptions): Promise<void> {
    return this.dispatch({ type: "start", data: { config } } as StartCommand);
  }

  public async end(reason: string): Promise<void> {
    return this.dispatch({ type: "end", data: { reason } } as EndCommand);
  }

  private async dispatch(cmd: RuntimeCommand): Promise<void> {
    this.commandQueue.push(cmd);
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      while (this.commandQueue.length > 0) {
        const next = this.commandQueue.shift()!;
        await this.processCommand(next);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processCommand(cmd: RuntimeCommand): Promise<void> {
    this.logger.debug(`[SessionMachine] Processing command: ${cmd.type} in state: ${this.state}`);

    if (cmd.type === "start" && this.state === SessionState.Idle) {
      await this.transitionTo(SessionState.Launching);
      const config = (cmd as StartCommand).data.config;
      this.ctx.config = config;
      await this.launchBrowser(config);
    } else if (cmd.type === "end" && this.state === SessionState.Live) {
      await this.transitionTo(SessionState.Draining);
      await this.drainAndClose();
    } else {
      this.logger.warn(`[SessionMachine] Ignoring command ${cmd.type} in state ${this.state}`);
    }
  }

  private async handleEvent(event: RuntimeEvent): Promise<void> {
    this.logger.debug(`[SessionMachine] Handling event: ${event.type} in state: ${this.state}`);

    // Notify hooks
    for (const hook of this.hooks) {
      try {
        await Promise.resolve(hook.onEvent?.(event, this.ctx));
      } catch (error) {
        this.logger.error({ err: error }, `[SessionMachine] Hook onEvent error: ${error}`);
      }
    }

    if (event.type === "launchSucceeded" && this.state === SessionState.Launching) {
      this.ctx.browser = event.data.browser;
      this.ctx.primaryPage = event.data.primaryPage;
      await this.transitionTo(SessionState.Ready);
      await this.transitionTo(SessionState.Live);
    } else if (event.type === "disconnected" && this.state === SessionState.Live) {
      await this.transitionTo(SessionState.Draining);
      await this.drainAndClose();
    } else if (event.type === "fileProtocolViolation" && this.state === SessionState.Live) {
      this.logger.error(`[SessionMachine] File protocol violation: ${event.data.url}`);
      await this.transitionTo(SessionState.Draining);
      await this.drainAndClose();
    } else if (event.type === "launchFailed" && this.state === SessionState.Launching) {
      this.ctx.error = event.data.error;
      await this.transitionTo(SessionState.Closed);
    }
  }

  private async transitionTo(newState: SessionState): Promise<void> {
    const prevState = this.state;
    this.logger.info(`[SessionMachine] Transition: ${prevState} → ${newState}`);

    // Exit hooks
    for (const hook of this.hooks) {
      try {
        await Promise.resolve(hook.onExit?.(prevState, this.ctx));
      } catch (error) {
        this.logger.error({ err: error }, `[SessionMachine] Hook onExit error: ${error}`);
      }
    }

    this.state = newState;

    // Enter hooks
    for (const hook of this.hooks) {
      try {
        await Promise.resolve(hook.onEnter?.(newState, this.ctx));
      } catch (error) {
        this.logger.error({ err: error }, `[SessionMachine] Hook onEnter error: ${error}`);
      }
    }
  }

  private async launchBrowser(config: BrowserLauncherOptions): Promise<void> {
    try {
      const { browser, primaryPage } = await this.scheduler.runCritical(
        () => this.driver.launch(config),
        "browser-launch",
        60000,
      );

      // Emit success event which will trigger state transition
      this.driver.emit("event", {
        type: "launchSucceeded",
        data: { browser, primaryPage },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error({ err: error }, "[SessionMachine] Browser launch failed");
      this.driver.emit("event", {
        type: "launchFailed",
        data: { error: error as Error },
        timestamp: Date.now(),
      });
    }
  }

  private async drainAndClose(): Promise<void> {
    // Drain pending tasks
    await this.scheduler.drain(5000);

    // Close browser
    await this.driver.close();

    // Cancel remaining tasks
    this.scheduler.cancelAll("session-closed");

    await this.transitionTo(SessionState.Closed);
  }

  public async shutdown(): Promise<void> {
    if (this.state !== SessionState.Closed) {
      await this.end("shutdown");
    }
  }
}
