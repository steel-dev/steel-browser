import { EventEmitter } from "events";
import { createActor, waitFor, Actor } from "xstate";
import { Browser, BrowserContext, Page, Protocol } from "puppeteer-core";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import httpProxy from "http-proxy";
import { Mutex } from "async-mutex";
import { browserMachine } from "../machine/browser.machine.js";
import {
  RuntimeConfig,
  BrowserRef,
  SupervisorEvent,
  BrowserLauncher,
  SessionData,
} from "../types.js";
import { BrowserRuntime as IBrowserRuntime } from "../../types/browser-runtime.interface.js";
import { BrowserLauncherOptions } from "../../types/browser.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { BasePlugin } from "../../services/cdp/plugins/core/base-plugin.js";
import { PuppeteerLauncher } from "../drivers/puppeteer-launcher.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { StateTransitionLogger } from "../logging/state-transition-logger.js";
import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { ChromeContextService } from "../../services/context/chrome-context.service.js";
import { extractStorageForPage } from "../../utils/context.js";
import { isSimilarConfig } from "../../services/cdp/utils/validation.js";
import { env } from "../../env.js";
import { traceSession } from "../tracing/index.js";
import { Span } from "@opentelemetry/api";

export class BrowserRuntime extends EventEmitter implements IBrowserRuntime {
  private actor: Actor<typeof browserMachine>;
  private plugins: BrowserPlugin[] = [];
  private pluginRegistry: Map<string, BasePlugin> = new Map();
  private logger: FastifyBaseLogger;
  private stateTransitionLogger?: StateTransitionLogger;
  private instrumentationLogger?: BrowserLogger;
  private config?: BrowserLauncherOptions;
  private sessionContext: SessionData | null = null;
  private chromeContextService: ChromeContextService;
  private wsProxyServer: httpProxy;
  private readonly sessionMutex = new Mutex();
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

  constructor(options?: {
    launcher?: BrowserLauncher;
    instrumentationLogger?: BrowserLogger;
    appLogger?: FastifyBaseLogger;
    stateTransitionLogger?: StateTransitionLogger;
    keepAlive?: boolean;
    defaultLaunchConfig?: BrowserLauncherOptions;
  }) {
    super();
    const launcher = options?.launcher ?? new PuppeteerLauncher();
    const appLogger = options?.appLogger ?? pino();
    this.logger = appLogger.child({ component: "BrowserRuntime" });
    this.stateTransitionLogger = options?.stateTransitionLogger;
    this.instrumentationLogger = options?.instrumentationLogger;
    this.keepAlive = options?.keepAlive ?? true;
    this.defaultLaunchConfig = options?.defaultLaunchConfig ?? { options: {} };

    this.chromeContextService = new ChromeContextService(this.logger);
    this.wsProxyServer = httpProxy.createProxyServer();
    this.wsProxyServer.on("error", (err) => {
      this.logger.error({ err }, "Proxy server error");
    });

    this.actor = createActor(browserMachine, {
      input: {
        launcher,
        instrumentationLogger: this.instrumentationLogger,
        appLogger: this.logger,
      },
    });

    this.actor.on("targetCreated", (event) => this.emit("targetCreated", event));
    this.actor.on("targetDestroyed", (event) => this.emit("targetDestroyed", event));
    this.actor.on("fileProtocolViolation", (event) => this.emit("fileProtocolViolation", event));

    let previousState: string | null = null;
    this.actor.subscribe((snapshot) => {
      const currentState =
        typeof snapshot.value === "string" ? snapshot.value : JSON.stringify(snapshot.value);

      if (previousState !== currentState) {
        if (this.stateTransitionLogger) {
          this.stateTransitionLogger.recordTransition({
            fromState: previousState,
            toState: currentState,
            event: snapshot._nodes?.[0]?.key || "unknown",
            context: { browser: !!snapshot.context.browser },
          });
        } else {
          this.logger.info(
            { from: previousState, to: currentState, event: snapshot._nodes?.[0]?.key },
            "[StateMachine] State transition",
          );
        }
        previousState = currentState;
      }

      if (snapshot.matches("ready")) {
        this.emit("ready", snapshot.context.browser);
      }
      if (snapshot.matches("failed")) {
        const err = snapshot.context.error;
        if (this.listenerCount("error") > 0) {
          this.emit("error", err);
        }
      }
    });

    this.actor.start();
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
    const existingBrowser = this.getBrowser();
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

      if (this.stateTransitionLogger) {
        this.stateTransitionLogger.setSessionId(runtimeConfig.sessionId);
        this.stateTransitionLogger.setRootSpan(span);
      }

      const browserRef = await this.start(runtimeConfig);

      browserRef.instance.once("disconnected", () => {
        if (this.intentionalShutdown) {
          return;
        }

        if (this.disconnectHandler) {
          this.disconnectHandler().catch((err) => {
            this.logger.error({ err }, "[BrowserRuntime] Error in disconnect handler");
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
    await this.stop();

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

    const currentSnapshot = this.actor.getSnapshot();
    if (currentSnapshot.matches({ ready: "active" })) {
      this.actor.send({ type: "END_SESSION" });
      await waitFor(this.actor, (s) => s.matches("idle"));
    } else {
      await this.stop();
    }

    this.instrumentationLogger?.resetContext?.();

    if (this.sessionSpan) {
      this.sessionSpan.end();
      this.sessionSpan = null;
    }

    if (this.keepAlive) {
      await this.launchInternal(this.defaultLaunchConfig);
    }
  }

  getBrowserInstance(): Browser | null {
    return this.actor.getSnapshot().context.browser?.instance || null;
  }

  async getPrimaryPage(): Promise<Page> {
    const browser = this.actor.getSnapshot().context.browser;
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
    this.updatePrimaryPage(newPage);
  }

  getLaunchConfig(): BrowserLauncherOptions | undefined {
    return this.config;
  }

  getUserAgent(): string | undefined {
    return this.config?.userAgent || this.getFingerprint()?.fingerprint.navigator.userAgent;
  }

  getDimensions(): { width: number; height: number } {
    const fingerprint = this.getFingerprint();
    return (
      this.config?.dimensions || fingerprint?.fingerprint.screen || { width: 1920, height: 1080 }
    );
  }

  getFingerprintData(): BrowserFingerprintWithHeaders | null {
    return this.getFingerprint();
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
    // Compatibility with current machine's plugin expectation
    this.plugins.push({
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
      const index = this.plugins.findIndex((p) => p.name === pluginName);
      if (index !== -1) {
        this.plugins.splice(index, 1);
      }
    }
    return result;
  }

  getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return this.pluginRegistry.get(pluginName) as T | undefined;
  }

  waitUntil(task: Promise<void>): void {
    this.actor.send({
      type: "WAIT_UNTIL",
      fn: async () => task,
      label: "facade-task",
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
    const primaryPage = this.actor.getSnapshot().context.browser?.primaryPage;
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
        for (const domain in item.localStorage!) {
          result.localStorage![domain] = {
            ...(result.localStorage![domain] || {}),
            ...item.localStorage![domain],
          };
        }

        for (const domain in item.sessionStorage!) {
          result.sessionStorage![domain] = {
            ...(result.sessionStorage![domain] || {}),
            ...item.sessionStorage![domain],
          };
        }

        for (const domain in item.indexedDB!) {
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

  getInstrumentationLogger(): BrowserLogger | null {
    return this.instrumentationLogger || null;
  }

  getLogger(name: string): FastifyBaseLogger {
    return this.logger.child({ name });
  }

  isRunning(): boolean {
    return this.actor.getSnapshot().matches("ready");
  }

  public async start(config: RuntimeConfig): Promise<BrowserRef> {
    const currentSnapshot = this.actor.getSnapshot();
    if (!currentSnapshot.matches("idle")) {
      throw new Error(`Cannot start: machine is in state ${JSON.stringify(currentSnapshot.value)}`);
    }

    this.actor.send({ type: "START", config, plugins: this.plugins });

    const snapshot = await waitFor(this.actor, (s) => s.matches("ready") || !!s.context.error);

    if (snapshot.context.error) {
      throw snapshot.context.error;
    }

    return snapshot.context.browser!;
  }

  async stop(): Promise<void> {
    this.actor.send({ type: "STOP" });
    await waitFor(this.actor, (s) => s.matches("idle"));
  }

  getBrowser(): BrowserRef | null {
    return this.actor.getSnapshot().context.browser;
  }

  getSessionState(): SessionData | null {
    return this.actor.getSnapshot().context.sessionState;
  }

  getFingerprint(): BrowserFingerprintWithHeaders | null {
    return this.actor.getSnapshot().context.fingerprint;
  }

  updatePrimaryPage(page: Page): void {
    const context = this.actor.getSnapshot().context;
    if (context.browser) {
      context.browser.primaryPage = page;
    }
  }

  getState(): string {
    const value = this.actor.getSnapshot().value;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
