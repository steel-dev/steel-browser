import { Browser, BrowserContext, Page, Protocol } from "puppeteer-core";
import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import httpProxy from "http-proxy";
import { Mutex } from "async-mutex";
import { BrowserRuntime as IBrowserRuntime } from "../types/browser-runtime.interface.js";
import { BrowserLauncherOptions } from "../types/browser.js";
import { SessionData } from "../services/context/types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { BrowserLogger } from "../services/cdp/instrumentation/browser-logger.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { ChromeContextService } from "../services/context/chrome-context.service.js";
import { extractStorageForPage } from "../utils/context.js";
import { isSimilarConfig } from "../services/cdp/utils/validation.js";
import {
  createBrowserLogger,
  BrowserLogger as IBrowserLogger,
} from "../services/cdp/instrumentation/browser-logger.js";
import { LogStorage } from "../services/cdp/instrumentation/storage/index.js";
import { EmitEvent } from "../types/enums.js";
import { BrowserRuntime as XStateRuntime } from "./index.js";
import { RuntimeConfig } from "./types.js";
import { traceSession } from "./tracing/index.js";
import { env } from "../env.js";
import { Span } from "@opentelemetry/api";

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
  private readonly sessionMutex = new Mutex();
  private pluginRegistry: Map<string, BasePlugin> = new Map();
  private launchMutators: ((config: BrowserLauncherOptions) => Promise<void> | void)[] = [];
  private shutdownMutators: ((config: BrowserLauncherOptions | null) => Promise<void> | void)[] =
    [];
  private proxyWebSocketHandler:
    | ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>)
    | null = null;
  private disconnectHandler: (() => Promise<void>) | null = null;
  private intentionalShutdown = false;
  private keepAlive: boolean;
  private defaultLaunchConfig: BrowserLauncherOptions;
  private sessionSpan: Span | null = null;

  constructor(
    runtime: XStateRuntime,
    logger: FastifyBaseLogger,
    instrumentationLogger: IBrowserLogger,
    options?: { keepAlive?: boolean; defaultLaunchConfig?: BrowserLauncherOptions },
  ) {
    super();
    this.runtime = runtime;
    this.logger = logger.child({ component: "XStateAdapter" });
    this.instrumentationLogger = instrumentationLogger;
    this.keepAlive = options?.keepAlive ?? true;
    this.defaultLaunchConfig = options?.defaultLaunchConfig ?? { options: {} };

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
      sessionContext: options.sessionContext || null,
      extensions: options.extensions,
      userPreferences: options.userPreferences,
      fingerprint: options.fingerprint,
      blockAds: options.blockAds,
      credentials: options.credentials,
      skipFingerprintInjection: options.skipFingerprintInjection,
      deviceConfig: options.deviceConfig,
      dimensions: options.dimensions ?? null,
      host: env.HOST,
      display: env.DISPLAY,
    };
  }

  async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    return this.sessionMutex.runExclusive(() => this.launchInternal(config));
  }

  private async launchInternal(config?: BrowserLauncherOptions): Promise<Browser> {
    const existingBrowser = this.runtime.getBrowser();
    const effectiveConfig = config ?? this.defaultLaunchConfig;

    if (existingBrowser) {
      if (this.config) {
        const shouldReuse = await isSimilarConfig(this.config, effectiveConfig);
        if (shouldReuse) {
          this.logger.info("Reusing existing browser with similar configuration");
          return existingBrowser.instance;
        }
        this.logger.info("Configuration changed, restarting session with new config");
        await this.shutdownInternal();
      } else {
        return existingBrowser.instance;
      }
    }

    this.config = effectiveConfig;
    const runtimeConfig = this.mapConfig(effectiveConfig);

    return traceSession(runtimeConfig.sessionId, async (span) => {
      this.sessionSpan = span;
      span.setAttribute("browser.headless", !!runtimeConfig.headless);
      span.setAttribute("keepAlive", this.keepAlive);

      for (const hook of this.launchMutators) {
        await Promise.resolve(hook(effectiveConfig));
      }

      const stLogger = this.runtime.getStateTransitionLogger();
      if (stLogger) {
        stLogger.setSessionId(runtimeConfig.sessionId);
        stLogger.setRootSpan(span);
      }
      const browserRef = await this.runtime.start(runtimeConfig);

      browserRef.instance.once("disconnected", () => {
        if (this.intentionalShutdown) {
          return;
        }

        if (this.disconnectHandler) {
          this.disconnectHandler().catch((err) => {
            this.logger.error({ err }, "[XStateAdapter] Error in disconnect handler");
          });
        }
      });

      this.intentionalShutdown = false;
      return browserRef.instance;
    });
  }

  async shutdown(): Promise<void> {
    return this.sessionMutex.runExclusive(() => this.shutdownInternal());
  }

  private async shutdownInternal(): Promise<void> {
    this.intentionalShutdown = true;
    for (const hook of this.shutdownMutators) {
      await Promise.resolve(hook(this.config || null));
    }
    await this.runtime.stop();

    if (this.sessionSpan) {
      this.sessionSpan.end();
      this.sessionSpan = null;
    }
  }

  async startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    return this.sessionMutex.runExclusive(() => this.startNewSessionInternal(sessionConfig));
  }

  private async startNewSessionInternal(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    await this.shutdownInternal();
    return this.launchInternal(sessionConfig);
  }

  async endSession(): Promise<void> {
    return this.sessionMutex.runExclusive(() => this.endSessionInternal());
  }

  private async endSessionInternal(): Promise<void> {
    this.sessionContext = await this.getBrowserState().catch(() => null);

    await this.runtime.endSession();
    this.instrumentationLogger.resetContext?.();

    if (this.sessionSpan) {
      this.sessionSpan.end();
      this.sessionSpan = null;
    }

    if (this.keepAlive) {
      await this.launchInternal(this.defaultLaunchConfig);
    }
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
    const browser = this.getBrowserInstance();
    if (!browser) return;

    const oldPage = await this.getPrimaryPage();
    const newPage = await browser.newPage();

    // Notify plugins before closing old page
    for (const plugin of this.pluginRegistry.values()) {
      try {
        await plugin.onBeforePageClose?.(oldPage);
      } catch (err) {
        this.logger.error({ err, plugin: plugin.name }, "Error in plugin onBeforePageClose");
      }
    }

    await oldPage.close();
    this.runtime.updatePrimaryPage(newPage);
  }

  getLaunchConfig(): BrowserLauncherOptions | undefined {
    return this.config;
  }

  getUserAgent(): string | undefined {
    return this.config?.userAgent || this.runtime.getFingerprint()?.fingerprint.navigator.userAgent;
  }

  getDimensions(): { width: number; height: number } {
    const fingerprint = this.runtime.getFingerprint();
    return (
      this.config?.dimensions || fingerprint?.fingerprint.screen || { width: 1920, height: 1080 }
    );
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
      const [cookieData, sessionData, storageData] = await Promise.all([
        this.getCookies(),
        this.chromeContextService.getSessionData(userDataDir),
        this.getExistingPageSessionData(),
      ]);

      return {
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
    } catch (error) {
      this.logger.error({ err: error }, "Error dumping session data");
      return {};
    }
  }

  getSessionContext(): SessionData | null {
    return this.sessionContext;
  }

  registerPlugin(plugin: BasePlugin): void {
    this.pluginRegistry.set(plugin.name, plugin);
    this.runtime.registerPlugin({
      name: plugin.name,
      onBrowserLaunch: (browser) => plugin.onBrowserLaunch?.(browser),
      onBrowserReady: (config) => plugin.onBrowserReady(this.config!),
      onPageCreated: (page) => plugin.onPageCreated(page),
      onBrowserClose: (browser) => plugin.onBrowserClose?.(browser),
      onBeforePageClose: (page) => plugin.onBeforePageClose?.(page),
      onShutdown: () => plugin.onShutdown?.(),
      onSessionEnd: (config) => plugin.onSessionEnd(this.config!),
    });
  }

  unregisterPlugin(pluginName: string): boolean {
    const result = this.pluginRegistry.delete(pluginName);
    if (result) {
      this.runtime.unregisterPlugin(pluginName);
    }
    return result;
  }

  getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return this.pluginRegistry.get(pluginName) as T | undefined;
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

  setDisconnectHandler(handler: () => Promise<void>): void {
    this.disconnectHandler = handler;
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
    try {
      const browser = this.getBrowserInstance();
      if (!browser?.isConnected()) {
        return [];
      }

      const primaryPage = await this.getPrimaryPage();
      const client = await primaryPage.createCDPSession();
      const { cookies } = await client.send("Network.getAllCookies");
      await client.detach();
      return cookies;
    } catch (err) {
      this.logger.debug({ err }, "Failed to get cookies via CDP, browser may be disconnected");
      return [];
    }
  }

  private async getExistingPageSessionData(): Promise<SessionData> {
    const browser = this.getBrowserInstance();
    if (!browser || !browser.isConnected()) return {};

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
