import { FastifyBaseLogger } from "fastify";
import { Browser, Page, Protocol } from "puppeteer-core";
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
import { groupSessionStorageByOrigin, handleFrameNavigated } from "../utils/context.js";

export interface SessionMachineConfig {
  driver: BrowserDriver;
  scheduler: TaskScheduler;
  logger: FastifyBaseLogger;
  hooks?: TransitionHook[];
  pluginAdapter?: any; // Reference to PluginAdapter for onSessionEnd
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
  private pluginAdapter: any;

  constructor(config: SessionMachineConfig) {
    this.state = SessionState.Idle;
    this.ctx = {};
    this.commandQueue = [];
    this.isProcessing = false;
    this.driver = config.driver;
    this.scheduler = config.scheduler;
    this.logger = config.logger.child({ component: "SessionMachine" });
    this.hooks = config.hooks || [];
    this.pluginAdapter = config.pluginAdapter || null;

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
      // Inject session context if provided (cookies + storage)
      await this.injectSessionContext();
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

  private async injectSessionContext(): Promise<void> {
    const sessionContext = this.ctx.config?.sessionContext;
    if (!sessionContext || !this.ctx.primaryPage) {
      return;
    }

    try {
      this.logger.info("[SessionMachine] Injecting session context");

      // Inject cookies via CDP
      if (sessionContext.cookies && sessionContext.cookies.length > 0) {
        const client = await this.ctx.primaryPage.createCDPSession();
        try {
          await client.send("Network.setCookies", {
            cookies: sessionContext.cookies as Protocol.Network.CookieParam[],
          });
          this.logger.debug(`[SessionMachine] Injected ${sessionContext.cookies.length} cookies`);
        } finally {
          await client.detach();
        }
      }

      // Set up storage injection via frameNavigated handler
      const storageByOrigin = groupSessionStorageByOrigin(sessionContext);
      if (storageByOrigin.size > 0) {
        this.logger.debug(
          `[SessionMachine] Setting up storage injection for ${storageByOrigin.size} origins`,
        );

        // Attach frame navigation listener to inject storage
        this.ctx.primaryPage.on("framenavigated", (frame) => {
          void handleFrameNavigated(frame, storageByOrigin, this.logger);
        });
      }

      this.logger.info("[SessionMachine] Session context injection complete");
    } catch (error) {
      this.logger.error({ err: error }, "[SessionMachine] Failed to inject session context");
    }
  }

  private async drainAndClose(): Promise<void> {
    // Drain pending tasks
    await this.scheduler.drain(5000);

    // Invoke onSessionEnd after drain
    if (this.pluginAdapter && this.ctx.config) {
      try {
        await this.pluginAdapter.invokeOnSessionEnd(this.ctx.config);
      } catch (error) {
        this.logger.error({ err: error }, "[SessionMachine] Error in onSessionEnd hooks");
      }
    }

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
