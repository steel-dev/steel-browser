import { Mutex } from "async-mutex";
import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { IncomingMessage } from "http";
import httpProxy from "http-proxy";
import { Browser, Page, Protocol } from "puppeteer-core";
import { Duplex } from "stream";
import { env } from "../env.js";
import {
  BrowserLogger,
  createBrowserLogger as createInstrumentationLogger,
} from "../services/cdp/instrumentation/browser-logger.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { ChromeContextService } from "../services/context/chrome-context.service.js";
import { SessionData } from "../services/context/types.js";
import { BrowserRuntime } from "../types/browser-runtime.interface.js";
import { BrowserLauncherOptions } from "../types/browser.js";
import { EmitEvent } from "../types/index.js";
import { extractStorageForPage } from "../utils/context.js";
import { BrowserDriver } from "./browser-driver.js";
import { SessionHooks } from "./hooks.js";
import { createSession } from "./session.js";
import { TaskScheduler } from "./task-scheduler.js";
import {
  ErrorSession,
  InvalidStateError,
  isClosed,
  isError,
  isIdle,
  isLive,
  LiveSession,
  RuntimeEvent,
  Session,
} from "./types.js";

export interface OrchestratorConfig {
  keepAlive?: boolean;
  logger: FastifyBaseLogger;
  storage?: any;
  enableConsoleLogging?: boolean;
}

/**
 * Orchestrator is a facade that provides the same public API as CDPService
 * but uses the new Session runtime underneath.
 */
export class Orchestrator extends EventEmitter implements BrowserRuntime {
  private readonly sessionMutex = new Mutex();
  private logger: FastifyBaseLogger;
  private driver: BrowserDriver;
  private scheduler: TaskScheduler;
  private session: Session;
  private instrumentationLogger: BrowserLogger | null;
  private keepAlive: boolean;
  private launchHooks: ((config: BrowserLauncherOptions) => Promise<void> | void)[];
  private shutdownHooks: ((config: BrowserLauncherOptions | null) => Promise<void> | void)[];
  private currentSessionConfig: BrowserLauncherOptions | null;
  private defaultLaunchConfig: BrowserLauncherOptions;
  private wsProxyServer: httpProxy;
  private proxyWebSocketHandler:
    | ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>)
    | null;
  private chromeContextService: ChromeContextService;
  private plugins: Map<string, BasePlugin>;
  private sessionHooks: SessionHooks;

  constructor(config: OrchestratorConfig) {
    super();
    this.logger = config.logger.child({ component: "Orchestrator" });
    this.keepAlive = config.keepAlive ?? true;
    this.chromeContextService = new ChromeContextService(this.logger);
    this.launchHooks = [];
    this.shutdownHooks = [];
    this.currentSessionConfig = null;
    this.proxyWebSocketHandler = null;
    this.plugins = new Map();

    // Initialize WebSocket proxy server
    this.wsProxyServer = httpProxy.createProxyServer();
    this.wsProxyServer.on("error", (err) => {
      this.logger.error(`Proxy server error: ${err}`);
    });

    // Initialize instrumentation logger
    this.instrumentationLogger = createInstrumentationLogger({
      baseLogger: this.logger,
      initialContext: {},
      storage: config.storage || null,
      enableConsoleLogging: config.enableConsoleLogging ?? true,
    });

    // Forward EmitEvent.Log to Orchestrator's emit
    this.instrumentationLogger?.on?.(EmitEvent.Log, (event) => {
      this.emit(EmitEvent.Log, event);
    });

    // Initialize default config
    this.defaultLaunchConfig = {
      options: {
        headless: false,
        args: [],
        ignoreDefaultArgs: ["--enable-automation"],
      },
      blockAds: true,
      extensions: [],
      deviceConfig: { device: "desktop" },
    };

    // Create runtime components
    this.scheduler = new TaskScheduler(this.logger);
    this.driver = new BrowserDriver({ logger: this.logger });

    this.driver.on("event", (event: RuntimeEvent) => {
      if (event.type === "disconnected") {
        this.handleBrowserDisconnect();
      }
    });

    this.sessionHooks = this.createSessionHooks();

    this.session = createSession({
      driver: this.driver,
      scheduler: this.scheduler,
      logger: this.logger,
      hooks: this.sessionHooks,
    });

    this.logger.info("[Orchestrator] Initialized with Type State runtime");
  }

  private createSessionHooks(): SessionHooks {
    return {
      onEnterLive: async (session: LiveSession) => {
        for (const plugin of this.plugins.values()) {
          try {
            await plugin.onBrowserLaunch(session.browser);
            plugin.onBrowserReady(session.config);
          } catch (error) {
            this.logger.error(
              { err: error },
              `[Orchestrator] Plugin ${plugin.name} onBrowserLaunch/Ready error`,
            );
          }
        }
      },

      onExitLive: async (session: LiveSession) => {
        for (const plugin of this.plugins.values()) {
          try {
            await plugin.onBrowserClose(session.browser);
          } catch (error) {
            this.logger.error(
              { err: error },
              `[Orchestrator] Plugin ${plugin.name} onBrowserClose error`,
            );
          }
        }
      },

      onEnterError: async (session: ErrorSession) => {
        this.logger.error(
          { err: session.error, failedFrom: session.failedFrom },
          "[Orchestrator] Session entered error state",
        );
      },

      onClosed: async () => {
        for (const plugin of this.plugins.values()) {
          try {
            await plugin.onShutdown();
          } catch (error) {
            this.logger.error(
              { err: error },
              `[Orchestrator] Plugin ${plugin.name} onShutdown error`,
            );
          }
        }
      },

      onLaunchFailed: async (error: Error) => {
        this.logger.error({ err: error }, "[Orchestrator] Browser launch failed");
      },

      onCrash: async (session: LiveSession, error: Error) => {
        this.logger.error({ err: error }, "[Orchestrator] Browser crashed");
      },
    };
  }

  public registerPlugin(plugin: BasePlugin): void {
    if (this.plugins.has(plugin.name)) {
      this.logger.warn(`Plugin ${plugin.name} already registered, overwriting`);
    }
    plugin.setService(this as any);
    this.plugins.set(plugin.name, plugin);
    this.logger.info(`[Orchestrator] Registered plugin: ${plugin.name}`);
  }

  public unregisterPlugin(pluginName: string): boolean {
    const result = this.plugins.delete(pluginName);
    if (result) {
      this.logger.info(`[Orchestrator] Unregistered plugin: ${pluginName}`);
    }
    return result;
  }

  public getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return this.plugins.get(pluginName) as T | undefined;
  }

  public waitUntil(task: Promise<void>): void {
    this.scheduler.waitUntil(() => task, "external-task");
  }

  // Hooks
  public registerLaunchHook(fn: (config: BrowserLauncherOptions) => Promise<void> | void): void {
    this.launchHooks.push(fn);
  }

  public registerShutdownHook(
    fn: (config: BrowserLauncherOptions | null) => Promise<void> | void,
  ): void {
    this.shutdownHooks.push(fn);
  }

  public async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    return this.sessionMutex.runExclusive(() => this.launchInternal(config));
  }

  private async launchInternal(config?: BrowserLauncherOptions): Promise<Browser> {
    const launchConfig = config || this.defaultLaunchConfig;

    if (isLive(this.session)) {
      this.logger.debug("[Orchestrator] Already in live state, returning existing browser");
      return this.session.browser;
    }

    if (!isIdle(this.session)) {
      throw new InvalidStateError(this.session._state, "idle");
    }

    // Run launch hooks
    for (const hook of this.launchHooks) {
      await Promise.resolve(hook(launchConfig));
    }

    const launching = await this.session.start(launchConfig);
    const result = await launching.awaitLaunch();

    if (isError(result)) {
      this.session = result;
      throw result.error;
    }

    this.session = result;
    this.currentSessionConfig = launchConfig;

    return result.browser;
  }

  public async shutdown(): Promise<void> {
    return this.sessionMutex.runExclusive(async () => {
      if (isLive(this.session)) {
        const draining = await this.session.end("shutdown");
        const result = await draining.awaitDrain();

        if (isError(result)) {
          this.logger.error({ err: result.error }, "[Orchestrator] Error during shutdown drain");
          this.session = await result.terminate();
        } else {
          this.session = result;
        }
      } else if (isError(this.session)) {
        this.session = await this.session.terminate();
      }

      // Run shutdown hooks
      for (const hook of this.shutdownHooks) {
        await Promise.resolve(hook(this.currentSessionConfig));
      }

      this.currentSessionConfig = null;
    });
  }

  public async startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    return this.sessionMutex.runExclusive(async () => {
      if (isLive(this.session)) {
        await this.endSessionInternal();
      }

      if (!isIdle(this.session)) {
        if (isClosed(this.session)) {
          this.session = this.session.restart();
        } else if (isError(this.session)) {
          this.session = await this.session.recover();
        } else {
          throw new InvalidStateError(this.session._state, "idle");
        }
      }

      this.currentSessionConfig = sessionConfig;
      return this.launchInternal(sessionConfig);
    });
  }

  public async endSession(): Promise<void> {
    return this.sessionMutex.runExclusive(() => this.endSessionInternal());
  }

  private async endSessionInternal(): Promise<void> {
    if (!isLive(this.session)) {
      this.logger.warn(`[Orchestrator] Cannot end session from state: ${this.session._state}`);
      return;
    }

    for (const plugin of this.plugins.values()) {
      try {
        if (this.currentSessionConfig) {
          await plugin.onSessionEnd(this.currentSessionConfig);
        }
      } catch (error) {
        this.logger.error(
          { err: error },
          `[Orchestrator] Plugin ${plugin.name} onSessionEnd error`,
        );
      }
    }

    const draining = await this.session.end("endSession");
    const result = await draining.awaitDrain();

    // Reset instrumentation logger context
    this.resetInstrumentationContext();

    if (isError(result)) {
      this.logger.error({ err: result.error }, "[Orchestrator] Error during session end drain");
      if (this.keepAlive) {
        this.session = await result.recover();
        this.currentSessionConfig = null;
        await this.launchInternal(this.defaultLaunchConfig);
      } else {
        this.session = await result.terminate();
        this.currentSessionConfig = null;
      }
      return;
    }

    // Restart with default config if keepAlive
    if (this.keepAlive) {
      this.session = result.restart();
      this.currentSessionConfig = null;
      await this.launchInternal(this.defaultLaunchConfig);
    } else {
      this.session = result;
      this.currentSessionConfig = null;
    }
  }

  private async handleBrowserDisconnect(): Promise<void> {
    await this.sessionMutex.runExclusive(async () => {
      if (!isLive(this.session)) {
        this.logger.debug(
          `[Orchestrator] Ignoring disconnect event, session state is: ${this.session._state}`,
        );
        return;
      }

      const liveSession = this.session;
      const crashError = new Error("Browser disconnected unexpectedly");

      this.logger.warn("[Orchestrator] Browser disconnected unexpectedly, transitioning to error");

      this.session = await liveSession.crash(crashError);

      this.resetInstrumentationContext();

      if (this.keepAlive) {
        this.logger.info("[Orchestrator] keepAlive enabled, attempting auto-recovery");
        this.session = await (this.session as ErrorSession).recover();
        this.currentSessionConfig = null;
        await this.launchInternal(this.defaultLaunchConfig);
        this.logger.info("[Orchestrator] Auto-recovery complete, browser relaunched");
      } else {
        this.currentSessionConfig = null;
      }
    });
  }

  // Getters

  public getBrowserInstance(): Browser | null {
    return this.driver.getBrowser();
  }

  public async getPrimaryPage(): Promise<Page> {
    const page = this.driver.getPrimaryPage();
    if (!page) {
      throw new Error("Primary page not available");
    }
    return page;
  }

  public getLaunchConfig(): BrowserLauncherOptions | undefined {
    return this.currentSessionConfig || undefined;
  }

  public getInstrumentationLogger(): BrowserLogger | null {
    return this.instrumentationLogger;
  }

  public getLogger(name: string): FastifyBaseLogger {
    return this.logger.child({ component: name });
  }

  public isRunning(): boolean {
    return isLive(this.session);
  }

  public getUserAgent(): string | undefined {
    return this.currentSessionConfig?.userAgent;
  }

  public getDimensions(): { width: number; height: number } {
    return this.currentSessionConfig?.dimensions || { width: 1920, height: 1080 };
  }

  public getFingerprintData(): BrowserFingerprintWithHeaders | null {
    return this.currentSessionConfig?.fingerprint || null;
  }

  public getSessionState(): string {
    return this.session._state;
  }

  // WebSocket proxying
  public setProxyWebSocketHandler(
    handler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>) | null,
  ): void {
    this.proxyWebSocketHandler = handler;
  }

  public async proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.proxyWebSocketHandler) {
      this.logger.info("[Orchestrator] Using custom WebSocket proxy handler");
      await this.proxyWebSocketHandler(req, socket, head);
      return;
    }

    const browser = this.driver.getBrowser();
    if (!browser) {
      throw new Error("WebSocket endpoint not available. Ensure the browser is launched first.");
    }

    const wsEndpoint = browser.wsEndpoint();
    if (!wsEndpoint) {
      throw new Error("WebSocket endpoint not available from browser.");
    }

    const cleanupListeners = () => {
      browser?.off("close", cleanupListeners);
      if (browser?.process()) {
        browser.process()?.off("close", cleanupListeners);
      }
      browser?.off("disconnected", cleanupListeners);
      socket.off("close", cleanupListeners);
      socket.off("error", cleanupListeners);
      this.logger.info("[Orchestrator] WebSocket connection listeners cleaned up");
    };

    browser?.once("close", cleanupListeners);
    if (browser?.process()) {
      browser.process()?.once("close", cleanupListeners);
    }
    browser?.once("disconnected", cleanupListeners);
    socket.once("close", cleanupListeners);
    socket.once("error", cleanupListeners);

    // Increase max listeners
    if (browser?.process()) {
      browser.process()!.setMaxListeners(60);
    }

    this.wsProxyServer.ws(req, socket, head, { target: wsEndpoint }, (error) => {
      if (error) {
        this.logger.error(`WebSocket proxy error: ${error}`);
        cleanupListeners();
      }
    });

    socket.on("error", (error) => {
      this.logger.error(`Socket error: ${error}`);
      try {
        socket.end();
      } catch (e) {
        this.logger.error(`Error ending socket: ${e}`);
      }
    });
  }

  public async getCookies(): Promise<Protocol.Network.Cookie[]> {
    const primaryPage = this.driver.getPrimaryPage();
    if (!primaryPage) {
      throw new Error("Primary page not initialized");
    }
    const client = await primaryPage.createCDPSession();
    const { cookies } = await client.send("Network.getAllCookies");
    await client.detach();
    return cookies;
  }

  private async getExistingPageSessionData(): Promise<SessionData> {
    const browser = this.driver.getBrowser();
    const primaryPage = this.driver.getPrimaryPage();

    if (!browser || !primaryPage) {
      return {};
    }

    const result: SessionData = {
      localStorage: {},
      sessionStorage: {},
      indexedDB: {},
    };

    try {
      const pages = await browser.pages();

      const validPages = pages.filter((page) => {
        try {
          const url = page.url();
          return url && url.startsWith("http");
        } catch (e) {
          this.logger.error(`[Orchestrator] Error getting page URL: ${e}`);
          return false;
        }
      });

      this.logger.info(
        `[Orchestrator] Processing ${validPages.length} valid pages for storage extraction`,
      );

      const results = await Promise.all(
        validPages.map((page) => extractStorageForPage(page, this.logger)),
      );

      for (const item of results) {
        if (item.localStorage) {
          result.localStorage = { ...result.localStorage, ...item.localStorage };
        }
        if (item.sessionStorage) {
          result.sessionStorage = { ...result.sessionStorage, ...item.sessionStorage };
        }
        if (item.indexedDB) {
          result.indexedDB = { ...result.indexedDB, ...item.indexedDB };
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Orchestrator] Error extracting page storage: ${errorMessage}`);
      return result;
    }
  }

  public async getBrowserState(): Promise<SessionData> {
    const browser = this.driver.getBrowser();
    const primaryPage = this.driver.getPrimaryPage();

    if (!browser || !primaryPage) {
      throw new Error("Browser or primary page not initialized");
    }

    const userDataDir = this.currentSessionConfig?.userDataDir;

    if (!userDataDir) {
      this.logger.warn("No userDataDir specified, returning empty session data");
      return {};
    }

    try {
      this.logger.info(`[Orchestrator] Dumping session data from userDataDir: ${userDataDir}`);

      // Run session data extraction and CDP storage extraction in parallel
      const [cookieData, sessionData, storageData] = await Promise.all([
        this.getCookies(),
        this.chromeContextService.getSessionData(userDataDir),
        this.getExistingPageSessionData(),
      ]);

      // Merge storage data with session data
      const result = {
        cookies: cookieData,
        localStorage: {
          ...(sessionData.localStorage || {}),
          ...(storageData.localStorage || {}),
        },
        sessionStorage: {
          ...(sessionData.sessionStorage || {}),
          ...(storageData.sessionStorage || {}),
        },
        indexedDB: {
          ...(sessionData.indexedDB || {}),
          ...(storageData.indexedDB || {}),
        },
      };

      this.logger.info("[Orchestrator] Session data dumped successfully");
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Orchestrator] Error dumping session data: ${errorMessage}`);
      return {};
    }
  }

  public getSessionContext(): SessionData | null {
    return this.currentSessionConfig?.sessionContext ?? null;
  }

  public getTargetId(page: Page): string {
    return (page.target() as any)._targetId;
  }

  private getDebuggerBase(): { baseUrl: string; protocol: string; wsProtocol: string } {
    const baseUrl = env.CDP_DOMAIN ?? env.DOMAIN ?? `${env.HOST}:${env.CDP_REDIRECT_PORT}`;
    const protocol = env.USE_SSL ? "https" : "http";
    const wsProtocol = env.USE_SSL ? "wss" : "ws";
    return { baseUrl, protocol, wsProtocol };
  }

  public getDebuggerUrl(): string {
    const { baseUrl, protocol } = this.getDebuggerBase();
    return `${protocol}://${baseUrl}/devtools/devtools_app.html`;
  }

  public getDebuggerWsUrl(pageId?: string): string {
    const { baseUrl, wsProtocol } = this.getDebuggerBase();
    const primaryPage = this.driver.getPrimaryPage();
    const targetId = pageId ?? (primaryPage ? this.getTargetId(primaryPage) : "");
    return `${wsProtocol}://${baseUrl}/devtools/page/${targetId}`;
  }

  public resetInstrumentationContext(): void {
    if (this.instrumentationLogger) {
      this.instrumentationLogger.resetContext();
      this.logger.debug("[Orchestrator] Instrumentation logger context reset");
    }
  }

  public async refreshPrimaryPage(): Promise<void> {
    const newPage = await this.createPage();
    const oldPrimaryPage = this.driver.getPrimaryPage();

    if (oldPrimaryPage) {
      // Notify plugins before page close
      for (const plugin of this.plugins.values()) {
        try {
          await plugin.onBeforePageClose(oldPrimaryPage);
        } catch (error) {
          this.logger.error(
            { err: error },
            `[Orchestrator] Plugin ${plugin.name} onBeforePageClose error`,
          );
        }
      }
      await oldPrimaryPage.close();
    }

    // Update primary page reference in driver
    (this.driver as any).primaryPage = newPage;
    this.logger.info("[Orchestrator] Primary page refreshed");
  }

  public async createPage(): Promise<Page> {
    const browser = this.driver.getBrowser();
    if (!browser) {
      throw new Error("Browser not initialized");
    }
    return browser.newPage();
  }

  public async createBrowserContext(proxyUrl?: string): Promise<any> {
    const browser = this.driver.getBrowser();
    if (!browser) {
      throw new Error("Browser not initialized");
    }
    const contextOptions: any = {};
    if (proxyUrl) {
      contextOptions.proxy = { server: proxyUrl };
    }
    return browser.createBrowserContext(contextOptions);
  }

  public getBrowserProcess(): any {
    return this.driver.getBrowser()?.process() || null;
  }

  public async getAllPages(): Promise<Page[]> {
    const browser = this.driver.getBrowser();
    return browser?.pages() || [];
  }
}
