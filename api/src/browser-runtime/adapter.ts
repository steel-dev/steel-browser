import { Browser, BrowserContext, Page, Protocol } from "puppeteer-core";
import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { BrowserRuntime as IBrowserRuntime } from "../types/browser-runtime.interface.js";
import { BrowserLauncherOptions } from "../types/browser.js";
import { SessionData } from "../services/context/types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { BrowserLogger } from "../services/cdp/instrumentation/browser-logger.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { BrowserRuntime as XStateRuntime } from "./index.js";
import { RuntimeConfig } from "./types.js";

/**
 * XStateAdapter bridges the new XState-based isolated runtime
 * with the existing BrowserRuntime interface used by the app.
 */
export class XStateAdapter extends EventEmitter implements IBrowserRuntime {
  private runtime: XStateRuntime;
  private logger: FastifyBaseLogger;
  private config?: BrowserLauncherOptions;

  constructor(runtime: XStateRuntime, logger: FastifyBaseLogger) {
    super();
    this.runtime = runtime;
    this.logger = logger.child({ component: "XStateAdapter" });

    this.runtime.on("ready", (browser) => {
      this.emit("ready", browser);
    });

    this.runtime.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private mapConfig(options: BrowserLauncherOptions): RuntimeConfig {
    return {
      sessionId: options.sessionId || "default",
      port: 9222, // Fixed port for now or from env
      headless: options.options.headless,
      proxyUrl: options.options.proxyUrl,
      timezone: options.timezone,
      userAgent: options.userAgent,
      userDataDir: options.userDataDir,
      extensions: options.extensions,
      userPreferences: options.userPreferences,
      fingerprint: options.fingerprint,
      blockAds: options.blockAds,
      credentials: options.credentials,
      skipFingerprintInjection: options.skipFingerprintInjection,
    };
  }

  async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    this.config = config;
    const runtimeConfig = this.mapConfig(config || { options: {} });
    const browserRef = await this.runtime.start(runtimeConfig);
    return browserRef.instance;
  }

  async shutdown(): Promise<void> {
    await this.runtime.stop();
  }

  async startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    await this.shutdown();
    return this.launch(sessionConfig);
  }

  async endSession(): Promise<void> {
    await this.shutdown();
  }

  getBrowserInstance(): Browser | null {
    return this.runtime.getBrowser()?.instance || null;
  }

  async getPrimaryPage(): Promise<Page> {
    const browser = this.runtime.getBrowser();
    if (!browser) throw new Error("Browser not launched");
    return browser.primaryPage;
  }

  async createPage(): Promise<Page> {
    const browser = this.getBrowserInstance();
    if (!browser) throw new Error("Browser not launched");
    return browser.newPage();
  }

  async createBrowserContext(proxyUrl?: string): Promise<BrowserContext> {
    const browser = this.getBrowserInstance();
    if (!browser) throw new Error("Browser not launched");
    return browser.createBrowserContext({ proxyServer: proxyUrl });
  }

  async getAllPages(): Promise<Page[]> {
    const browser = this.getBrowserInstance();
    if (!browser) return [];
    return browser.pages();
  }

  async refreshPrimaryPage(): Promise<void> {
    // No-op for now
  }

  getLaunchConfig(): BrowserLauncherOptions | undefined {
    return this.config;
  }

  getUserAgent(): string | undefined {
    return this.config?.userAgent;
  }

  getDimensions(): { width: number; height: number } {
    return this.config?.dimensions || { width: 1920, height: 1080 };
  }

  getFingerprintData(): BrowserFingerprintWithHeaders | null {
    return null;
  }

  async getBrowserState(): Promise<SessionData> {
    return {};
  }

  getSessionContext(): SessionData | null {
    return null;
  }

  registerPlugin(plugin: BasePlugin): void {
    // Adapter for legacy BasePlugin
    this.runtime.registerPlugin({
      name: plugin.name,
      onBrowserReady: (config) => plugin.onBrowserReady(this.config!),
      onPageCreated: (page) => plugin.onPageCreated(page),
      onSessionEnd: (config) => plugin.onSessionEnd(this.config!),
    });
  }

  unregisterPlugin(pluginName: string): boolean {
    return false;
  }

  getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return undefined;
  }

  waitUntil(task: Promise<void>): void {
    // No-op or log
  }

  registerLaunchHook(hook: (config: BrowserLauncherOptions) => Promise<void> | void): void {}
  registerShutdownHook(
    hook: (config: BrowserLauncherOptions | null) => Promise<void> | void,
  ): void {}

  setProxyWebSocketHandler(
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>,
  ): void {}

  async proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // Real implementation would delegate to data-plane actor port
  }

  getDebuggerUrl(): string {
    return "";
  }

  getDebuggerWsUrl(pageId?: string): string {
    return "";
  }

  getTargetId(page: Page): string {
    return (page as any)._targetId;
  }

  getInstrumentationLogger(): BrowserLogger | null {
    return null;
  }

  getLogger(name: string): FastifyBaseLogger {
    return this.logger.child({ name });
  }

  isRunning(): boolean {
    return this.runtime.isRunning();
  }
}
