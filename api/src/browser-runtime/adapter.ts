import { Browser, BrowserContext, Page, Protocol } from "puppeteer-core";
import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import httpProxy from "http-proxy";
import { BrowserRuntime as IBrowserRuntime } from "../types/browser-runtime.interface.js";
import { BrowserLauncherOptions } from "../types/browser.js";
import { SessionData } from "../services/context/types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { BrowserLogger } from "../services/cdp/instrumentation/browser-logger.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { ChromeContextService } from "../services/context/chrome-context.service.js";
import { extractStorageForPage } from "../utils/context.js";
import {
  createBrowserLogger,
  BrowserLogger as IBrowserLogger,
} from "../services/cdp/instrumentation/browser-logger.js";
import { LogStorage } from "../services/cdp/instrumentation/storage/index.js";
import { EmitEvent } from "../types/enums.js";
import { BrowserRuntime as XStateRuntime } from "./index.js";
import { RuntimeConfig } from "./types.js";
import { env } from "../env.js";

/**
 * XStateAdapter bridges the new XState-based isolated runtime
 * with the existing BrowserRuntime interface used by the app.
 */
export class XStateAdapter extends EventEmitter implements IBrowserRuntime {
  private runtime: XStateRuntime;
  private logger: FastifyBaseLogger;
  private instrumentationLogger: IBrowserLogger;
  private config?: BrowserLauncherOptions;
  private sessionContext: SessionData | null = null;
  private chromeContextService: ChromeContextService;
  private wsProxyServer: httpProxy;
  private launchMutators: ((config: BrowserLauncherOptions) => Promise<void> | void)[] = [];
  private shutdownMutators: ((config: BrowserLauncherOptions | null) => Promise<void> | void)[] =
    [];
  private proxyWebSocketHandler:
    | ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>)
    | null = null;

  constructor(
    runtime: XStateRuntime,
    logger: FastifyBaseLogger,
    instrumentationLogger: IBrowserLogger,
  ) {
    super();
    this.runtime = runtime;
    this.logger = logger.child({ component: "XStateAdapter" });
    this.instrumentationLogger = instrumentationLogger;

    this.instrumentationLogger.on?.(EmitEvent.Log, (event) => {
      this.emit(EmitEvent.Log, event);
    });

    this.chromeContextService = new ChromeContextService(this.logger);
    this.wsProxyServer = httpProxy.createProxyServer();
    this.wsProxyServer.on("error", (err) => {
      this.logger.error({ err }, "Proxy server error");
    });

    this.runtime.on("ready", (browser) => {
      this.emit("ready", browser);
    });

    this.runtime.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private mapConfig(options: BrowserLauncherOptions): RuntimeConfig {
    const appPort = Number(env.PORT);
    this.sessionContext = options.sessionContext || null;
    return {
      sessionId: options.sessionId || "default",
      port: Number.isFinite(appPort) ? appPort : 3000,
      dataPlanePort: 0,
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
      deviceConfig: options.deviceConfig,
      dimensions: options.dimensions ?? null,
      host: env.HOST,
    };
  }

  async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    this.config = config;
    const runtimeConfig = this.mapConfig(config || { options: {} });

    for (const hook of this.launchMutators) {
      await Promise.resolve(hook(config || { options: {} }));
    }

    const browserRef = await this.runtime.start(runtimeConfig);
    return browserRef.instance;
  }

  async shutdown(): Promise<void> {
    for (const hook of this.shutdownMutators) {
      await Promise.resolve(hook(this.config || null));
    }
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
    return this.runtime.getFingerprint();
  }

  async getBrowserState(): Promise<SessionData> {
    const browser = this.getBrowserInstance();
    if (!browser) {
      throw new Error("Browser not initialized");
    }

    const userDataDir = this.config?.userDataDir;
    if (!userDataDir) {
      this.logger.warn("No userDataDir specified, returning empty session data");
      return {};
    }

    try {
      this.logger.info(`[XStateAdapter] Dumping session data from userDataDir: ${userDataDir}`);

      const [cookieData, sessionData, storageData] = await Promise.all([
        this.getCookies(),
        this.chromeContextService.getSessionData(userDataDir),
        this.getExistingPageSessionData(),
      ]);

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

      this.logger.info("[XStateAdapter] Session data dumped successfully");
      return result;
    } catch (error) {
      this.logger.error({ err: error }, "Error dumping session data");
      return {};
    }
  }

  getSessionContext(): SessionData | null {
    return this.sessionContext;
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
    void task.catch((err) => {
      this.logger.error({ err }, "waitUntil task failed");
    });
  }

  registerLaunchHook(hook: (config: BrowserLauncherOptions) => Promise<void> | void): void {
    this.launchMutators.push(hook);
  }

  registerShutdownHook(
    hook: (config: BrowserLauncherOptions | null) => Promise<void> | void,
  ): void {
    this.shutdownMutators.push(hook);
  }

  setProxyWebSocketHandler(
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>,
  ): void {
    this.proxyWebSocketHandler = handler;
  }

  async proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.proxyWebSocketHandler) {
      this.logger.info("Using custom WebSocket proxy handler");
      await this.proxyWebSocketHandler(req, socket, head);
      return;
    }

    const browser = this.getBrowserInstance();
    if (!browser) {
      throw new Error("WebSocket endpoint not available. Ensure the browser is launched first.");
    }

    const wsEndpoint = browser.wsEndpoint();
    if (!wsEndpoint) {
      throw new Error("WebSocket endpoint not available from browser.");
    }

    const cleanupListeners = () => {
      browser.off("close", cleanupListeners);
      if (browser.process()) {
        browser.process()?.off("close", cleanupListeners);
      }
      browser.off("disconnected", cleanupListeners);
      socket.off("close", cleanupListeners);
      socket.off("error", cleanupListeners);
      this.logger.info("WebSocket connection listeners cleaned up");
    };

    browser.once("close", cleanupListeners);
    if (browser.process()) {
      browser.process()?.once("close", cleanupListeners);
    }
    browser.once("disconnected", cleanupListeners);
    socket.once("close", cleanupListeners);
    socket.once("error", cleanupListeners);

    if (browser.process()) {
      browser.process()!.setMaxListeners(60);
    }

    this.wsProxyServer.ws(req, socket, head, { target: wsEndpoint }, (error) => {
      if (error) {
        this.logger.error({ err: error }, "WebSocket proxy error");
        cleanupListeners();
      }
    });

    socket.on("error", (error) => {
      this.logger.error({ err: error }, "Socket error");
      try {
        socket.end();
      } catch (e) {
        this.logger.error({ err: e }, "Error ending socket");
      }
    });
  }

  private getDebuggerBase(): { baseUrl: string; protocol: string; wsProtocol: string } {
    const baseUrl = env.CDP_DOMAIN ?? env.DOMAIN ?? `${env.HOST}:${env.CDP_REDIRECT_PORT}`;
    const protocol = env.USE_SSL ? "https" : "http";
    const wsProtocol = env.USE_SSL ? "wss" : "ws";
    return { baseUrl, protocol, wsProtocol };
  }

  getDebuggerUrl(): string {
    const { baseUrl, protocol } = this.getDebuggerBase();
    return `${protocol}://${baseUrl}/devtools/devtools_app.html`;
  }

  getDebuggerWsUrl(pageId?: string): string {
    const { baseUrl, wsProtocol } = this.getDebuggerBase();
    const primaryPage = this.runtime.getBrowser()?.primaryPage;
    const targetId = pageId ?? (primaryPage ? this.getTargetId(primaryPage) : "");
    return `${wsProtocol}://${baseUrl}/devtools/page/${targetId}`;
  }

  getTargetId(page: Page): string {
    return (page.target() as any)._targetId;
  }

  private async getCookies(): Promise<Protocol.Network.Cookie[]> {
    const primaryPage = await this.getPrimaryPage();
    const client = await primaryPage.createCDPSession();
    const { cookies } = await client.send("Network.getAllCookies");
    await client.detach();
    return cookies;
  }

  private async getExistingPageSessionData(): Promise<SessionData> {
    const browser = this.getBrowserInstance();
    if (!browser) return {};

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

      const results = await Promise.all(
        validPages.map((page) => extractStorageForPage(page, this.logger)),
      );

      // Merge results
      for (const item of results) {
        for (const domain in item.localStorage) {
          result.localStorage![domain] = {
            ...(result.localStorage![domain] || {}),
            ...item.localStorage![domain],
          };
        }

        for (const domain in item.sessionStorage) {
          result.sessionStorage![domain] = {
            ...(result.sessionStorage![domain] || {}),
            ...item.sessionStorage![domain],
          };
        }

        for (const domain in item.indexedDB) {
          result.indexedDB![domain] = [
            ...(result.indexedDB![domain] || []),
            ...item.indexedDB![domain],
          ];
        }
      }

      return result;
    } catch (error) {
      this.logger.error({ err: error }, "Error extracting page session data");
      return result;
    }
  }

  getInstrumentationLogger(): IBrowserLogger | null {
    return this.instrumentationLogger;
  }

  getLogger(name: string): FastifyBaseLogger {
    return this.logger.child({ name });
  }

  isRunning(): boolean {
    return this.runtime.isRunning();
  }
}
