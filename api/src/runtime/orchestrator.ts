import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { Browser, Page, Protocol } from "puppeteer-core";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { BrowserLauncherOptions } from "../types/browser.js";
import { SessionData } from "../services/context/types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { BrowserLogger } from "../services/cdp/instrumentation/browser-logger.js";
import { BrowserDriver } from "./browser-driver.js";
import { SessionMachine } from "./session-machine.js";
import { TaskScheduler } from "./task-scheduler.js";
import { PluginAdapter } from "./plugin-adapter.js";
import { SessionState } from "./types.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";

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
export class Orchestrator extends EventEmitter {
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

  constructor(config: OrchestratorConfig) {
    super();
    this.logger = config.logger.child({ component: "Orchestrator" });
    this.keepAlive = config.keepAlive ?? true;
    this.launchHooks = [];
    this.shutdownHooks = [];
    this.currentSessionConfig = null;

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
    this.pluginAdapter = new PluginAdapter(this.logger);

    // Set orchestrator reference in plugin adapter
    this.pluginAdapter.setOrchestrator(this);

    this.machine = new SessionMachine({
      driver: this.driver,
      scheduler: this.scheduler,
      logger: this.logger,
      hooks: [this.pluginAdapter],
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

  // Placeholder methods - to be implemented as needed
  public getSessionContext(): SessionData | null {
    return null;
  }

  public setProxyWebSocketHandler(handler: any): void {
    // TODO: Implement
  }

  public getTargetId(page: Page): string {
    return (page.target() as any)._targetId;
  }

  public getDebuggerUrl(): string {
    return "";
  }

  public getDebuggerWsUrl(pageId?: string): string {
    return "";
  }

  public async refreshPrimaryPage(): Promise<void> {
    // TODO: Implement
  }

  public async createPage(): Promise<Page> {
    const browser = this.driver.getBrowser();
    if (!browser) {
      throw new Error("Browser not initialized");
    }
    return browser.newPage();
  }

  public getBrowserProcess(): any {
    return this.driver.getBrowser()?.process() || null;
  }

  public async createBrowserContext(proxyUrl: string): Promise<any> {
    const browser = this.driver.getBrowser();
    if (!browser) {
      throw new Error("Browser not initialized");
    }
    return browser.createBrowserContext({ proxyServer: proxyUrl });
  }

  public async proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // TODO: Implement WebSocket proxying
  }

  public async getCookies(): Promise<Protocol.Network.Cookie[]> {
    const page = this.driver.getPrimaryPage();
    if (!page) {
      throw new Error("Primary page not initialized");
    }
    const client = await page.createCDPSession();
    const { cookies } = await client.send("Network.getAllCookies");
    await client.detach();
    return cookies;
  }

  public async getBrowserState(): Promise<SessionData> {
    // TODO: Implement state extraction
    return {};
  }

  public async getAllPages(): Promise<Page[]> {
    const browser = this.driver.getBrowser();
    return browser?.pages() || [];
  }
}
