import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { Browser, Page, Protocol } from "puppeteer-core";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import httpProxy from "http-proxy";
import { BrowserLauncherOptions } from "../types/browser.js";
import { SessionData } from "../services/context/types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import {
  createBrowserLogger as createInstrumentationLogger,
  BrowserLogger,
} from "../services/cdp/instrumentation/browser-logger.js";
import { BrowserDriver } from "./browser-driver.js";
import { SessionMachine } from "./session-machine.js";
import { TaskScheduler } from "./task-scheduler.js";
import { PluginAdapter } from "./plugin-adapter.js";
import { SessionState } from "./types.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { env } from "../env.js";
import { ChromeContextService } from "../services/context/chrome-context.service.js";
import {
  extractStorageForPage,
  handleFrameNavigated,
  groupSessionStorageByOrigin,
} from "../utils/context.js";
import { EmitEvent } from "../types/index.js";
import { BrowserRuntime } from "../types/browser-runtime.interface.js";

export interface OrchestratorConfig {
  keepAlive?: boolean;
  logger: FastifyBaseLogger;
  storage?: any;
  enableConsoleLogging?: boolean;
}

/**
 * Orchestrator is a facade that provides the same public API as CDPService
 * but uses the new SessionMachine runtime underneath.
 */
export class Orchestrator extends EventEmitter implements BrowserRuntime {
  private logger: FastifyBaseLogger;
  private driver: BrowserDriver;
  private machine: SessionMachine;
  private scheduler: TaskScheduler;
  private pluginAdapter: PluginAdapter;
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

  constructor(config: OrchestratorConfig) {
    super();
    this.logger = config.logger.child({ component: "Orchestrator" });
    this.keepAlive = config.keepAlive ?? true;
    this.chromeContextService = new ChromeContextService(this.logger);
    this.launchHooks = [];
    this.shutdownHooks = [];
    this.currentSessionConfig = null;
    this.proxyWebSocketHandler = null;

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
    this.pluginAdapter = new PluginAdapter(this.logger, this.scheduler);

    // Set orchestrator reference in plugin adapter
    this.pluginAdapter.setOrchestrator(this);

    this.machine = new SessionMachine({
      driver: this.driver,
      scheduler: this.scheduler,
      logger: this.logger,
      hooks: [this.pluginAdapter],
      pluginAdapter: this.pluginAdapter,
    });

    // For now, set to null - will be implemented later
    this.instrumentationLogger = null;

    this.logger.info("[Orchestrator] Initialized with SessionMachine runtime");
  }

  // Plugin management
  public registerPlugin(plugin: BasePlugin): void {
    this.pluginAdapter.register(plugin);
  }

  public unregisterPlugin(pluginName: string): boolean {
    return this.pluginAdapter.unregister(pluginName);
  }

  public getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return this.pluginAdapter.getPlugin<T>(pluginName);
  }

  public waitUntil(task: Promise<void>): void {
    this.scheduler.waitUntil(task, "external-task");
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

  // Browser lifecycle
  public async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    const launchConfig = config || this.defaultLaunchConfig;

    // Run launch hooks
    for (const hook of this.launchHooks) {
      await Promise.resolve(hook(launchConfig));
    }

    await this.machine.start(launchConfig);
    this.currentSessionConfig = launchConfig;

    const browser = this.driver.getBrowser();
    if (!browser) {
      throw new Error("Browser failed to launch");
    }

    return browser;
  }

  public async shutdown(): Promise<void> {
    await this.machine.shutdown();

    // Run shutdown hooks
    for (const hook of this.shutdownHooks) {
      await Promise.resolve(hook(this.currentSessionConfig));
    }

    this.currentSessionConfig = null;
  }

  public async startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    this.currentSessionConfig = sessionConfig;
    return this.launch(sessionConfig);
  }

  public async endSession(): Promise<void> {
    const sessionConfig = this.currentSessionConfig;
    await this.machine.end("endSession");
    this.currentSessionConfig = null;

    // Reset instrumentation logger context
    this.resetInstrumentationContext();

    // Restart with default config if keepAlive
    if (this.keepAlive) {
      await this.launch(this.defaultLaunchConfig);
    }
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
    return this.machine.getState() === SessionState.Live;
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

    this.wsProxyServer.ws(
      req,
      socket,
      head,
      {
        target: wsEndpoint,
      },
      (error) => {
        if (error) {
          this.logger.error(`WebSocket proxy error: ${error}`);
          cleanupListeners();
        }
      },
    );

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
          return false;
        }
      });

      this.logger.info(
        `[Orchestrator] Processing ${validPages.length} valid pages out of ${pages.length} total for storage extraction`,
      );

      const results = await Promise.all(
        validPages.map((page) => extractStorageForPage(page, this.logger)),
      );

      // Merge all results
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
      await this.pluginAdapter.invokeOnBeforePageClose(oldPrimaryPage);
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
