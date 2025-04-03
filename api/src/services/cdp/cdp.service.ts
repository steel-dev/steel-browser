import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { BrowserFingerprintWithHeaders, FingerprintGenerator } from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";
import { IncomingMessage } from "http";
import httpProxy from "http-proxy";
import os from "os";
import path from "path";
import puppeteer, { Browser, BrowserContext, CDPSession, Page, Protocol, Target, TargetType } from "puppeteer-core";
import { Duplex } from "stream";
import { env } from "../../env";
import { loadFingerprintScript } from "../../scripts";
import { BrowserEvent, BrowserEventType, BrowserLauncherOptions, EmitEvent } from "../../types";
import { isAdRequest } from "../../utils/ads";
import { filterHeaders, getChromeExecutablePath } from "../../utils/browser";
import { getExtensionPaths } from "../../utils/extensions";
import { CDPLifecycle } from "../cdp-lifecycle.service";
import { PluginManager } from "./plugins/core/plugin-manager";
import { SessionPlugin, SessionManager } from "./plugins/session";

export class CDPService extends EventEmitter {
  private logger: FastifyBaseLogger;
  private keepAlive: boolean;

  private browserInstance: Browser | null;
  private wsEndpoint: string | null;
  private fingerprintData: BrowserFingerprintWithHeaders | null;
  private chromeExecPath: string;
  private wsProxyServer: httpProxy;
  private primaryPage: Page | null;
  private launchConfig?: BrowserLauncherOptions;
  private localStorageData: Record<string, Record<string, string>>;
  private defaultLaunchConfig: BrowserLauncherOptions;
  private currentSessionConfig: BrowserLauncherOptions | null;
  private shuttingDown: boolean;
  private defaultTimezone: string;
  private pluginManager: PluginManager;
  private sessionPlugin: SessionPlugin;

  constructor(config: { keepAlive?: boolean }, logger: FastifyBaseLogger) {
    super();
    this.logger = logger;
    const { keepAlive = true } = config;

    this.keepAlive = keepAlive;
    this.browserInstance = null;
    this.wsEndpoint = null;
    this.fingerprintData = null;
    this.chromeExecPath = getChromeExecutablePath();
    this.defaultTimezone = env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Clean up any existing proxy server
    if (this.wsProxyServer) {
      try {
        this.wsProxyServer.close();
      } catch (e) {
        // Ignore errors when closing
      }
    }

    this.wsProxyServer = httpProxy.createProxyServer();

    // Add error handler to the proxy server
    this.wsProxyServer.on("error", (err) => {
      this.logger.error(`Proxy server error: ${err}`);
    });

    this.primaryPage = null;
    this.localStorageData = {};
    this.currentSessionConfig = null;
    this.shuttingDown = false;
    this.defaultLaunchConfig = {
      options: { headless: env.CHROME_HEADLESS, args: [] },
      blockAds: true,
      extensions: [],
    };

    // Initialize plugin manager
    this.pluginManager = new PluginManager(this, logger);

    // Register session plugin
    this.sessionPlugin = new SessionPlugin({
      autoRestoreSession: true,
      autoDumpSession: true,
      logger: this.logger,
      debugMode: env.NODE_ENV === "development",
    });
    this.pluginManager.register(this.sessionPlugin);
  }

  private removeAllHandlers() {
    this.browserInstance?.removeAllListeners();
    this.removeAllListeners();
  }

  public isRunning(): boolean {
    return this.browserInstance?.process() !== null;
  }

  public getTargetId(page: Page) {
    //@ts-ignore
    return page.target()._targetId;
  }

  public async getPrimaryPage(): Promise<Page> {
    if (!this.primaryPage || !this.browserInstance) {
      throw new Error("CDPService has not been launched yet!");
    }
    if (this.primaryPage.isClosed()) {
      this.primaryPage = await this.browserInstance.newPage();
    }
    return this.primaryPage;
  }

  public getDebuggerUrl() {
    return `http://${env.HOST}:${env.CDP_REDIRECT_PORT}/devtools/devtools_app.html`;
  }

  public getDebuggerWsUrl(pageId?: string) {
    return `ws://${env.HOST}:${env.CDP_REDIRECT_PORT}/devtools/page/${pageId ?? this.getTargetId(this.primaryPage!)}`;
  }

  public customEmit(event: EmitEvent, payload: any) {
    try {
      this.emit(event, payload);

      if (env.LOG_CUSTOM_EMIT_EVENTS) {
        this.logger.info("EmitEvent", { event, payload });
      }

      if (event === EmitEvent.Log) {
        this.logEvent(payload);
      } else if (event === EmitEvent.Recording) {
        this.logEvent({
          type: BrowserEventType.Recording,
          text: JSON.stringify(payload),
          timestamp: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(`Error emitting event: ${error}`);
    }
  }

  public async refreshPrimaryPage() {
    const newPage = await this.createPage();
    if (this.primaryPage) {
      // Notify plugins before page close
      await this.pluginManager.onBeforePageClose(this.primaryPage);
      await this.primaryPage.close();
    }
    this.primaryPage = newPage;
  }

  private async handleTargetChange(target: Target) {
    if (target.type() !== "page") return;

    const page = await target.page().catch((e) => {
      this.logger.error(`Error handling target change in CDPService: ${e}`);
      return null;
    });

    if (page) {
      //@ts-ignore
      const pageId = page.target()._targetId;

      this.customEmit(EmitEvent.PageId, { pageId });
    }
  }

  private async handleNewTarget(target: Target) {
    if (target.type() === TargetType.PAGE) {
      const page = await target.page().catch((e) => {
        this.logger.error(`Error handling new target in CDPService: ${e}`);
        return null;
      });

      if (page) {
        // Notify plugins about the new page
        await this.pluginManager.onPageCreated(page);

        // Inject session context using legacy or plugin method
        if (this.launchConfig?.sessionContext) {
          // Legacy approach - directly inject session context
          await this.injectSessionContext(page, this.launchConfig.sessionContext);

          // Also set session data in the plugin for future use
          const sessionData = SessionManager.convertFromSessionContext(this.launchConfig.sessionContext);
          this.sessionPlugin.setSessionData(this.getTargetId(page), sessionData);
        }

        if (this.currentSessionConfig?.timezone) {
          await page.emulateTimezone(this.currentSessionConfig.timezone);
        }

        if (this.launchConfig?.customHeaders) {
          await page.setExtraHTTPHeaders({
            ...env.DEFAULT_HEADERS,
            ...this.launchConfig.customHeaders,
          });
        } else if (env.DEFAULT_HEADERS) {
          await page.setExtraHTTPHeaders(env.DEFAULT_HEADERS);
        }

        // Inject fingerprint only if it's not skipped
        if (!env.SKIP_FINGERPRINT_INJECTION) {
          // Use our safer fingerprint injection method instead of FingerprintInjector
          await this.injectFingerprintSafely(page, this.fingerprintData!);
          this.logger.debug("Injected fingerprint into page");
        } else {
          this.logger.info("Fingerprint injection skipped due to 'SKIP_FINGERPRINT_INJECTION' setting");
        }

        await page.setRequestInterception(true);

        await this.setupPageLogging(page, target.type());

        page.on("request", async (request) => {
          const headers = request.headers();
          delete headers["accept-language"]; // Patch to help with headless detection

          if (this.launchConfig?.blockAds && isAdRequest(request.url())) {
            this.logger.info(`Blocked request to ad related resource: ${request.url()}`);
            await request.abort();
            return;
          }

          if (request.url().startsWith("file://")) {
            this.logger.error(`Blocked request to file protocol: ${request.url()}`);
            page.close().catch(() => {});
            this.shutdown();
          } else {
            await request.continue({ headers });
          }
        });

        page.on("response", (response) => {
          if (response.url().startsWith("file://")) {
            this.logger.error(`Blocked response from file protocol: ${response.url()}`);
            page.close().catch(() => {});
            this.shutdown();
          }
        });

        const updateLocalStorage = (host: string, storage: Record<string, string>) => {
          this.localStorageData[host] = { ...this.localStorageData[host], ...storage };
        };

        await page.exposeFunction("updateLocalStorage", updateLocalStorage);

        await page.evaluateOnNewDocument(() => {
          window.addEventListener("beforeunload", () => {
            updateLocalStorage(window.location.host, { ...window.localStorage });
          });
        });
      }
    } else if (target.type() === TargetType.BACKGROUND_PAGE) {
      console.log("Background page created:", target.url());
      const page = await target.page();
      await this.setupPageLogging(page, target.type());
    } else {
      // Handle SERVICE_WORKER, SHARED_WORKER, BROWSER, WEBVIEW and OTHER targets.
    }
  }

  private async setupPageLogging(page: Page | null, targetType: TargetType) {
    try {
      if (!page) {
        return;
      }

      this.logger.info(`Setting up logging for page: ${page.url()}`);

      //@ts-ignore
      const pageId = page.target()._targetId;

      page.on("request", (request) => {
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.Request,
          text: JSON.stringify({ pageId, method: request.method(), url: request.url() }),
          timestamp: new Date(),
        });
      });

      page.on("response", (response) => {
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.Response,
          text: JSON.stringify({ pageId, status: response.status(), url: response.url() }),
          timestamp: new Date(),
        });
      });

      page.on("error", (err) => {
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.Error,
          text: JSON.stringify({ pageId, message: err.message, name: err.name }),
          timestamp: new Date(),
        });
      });

      page.on("pageerror", (err) => {
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.PageError,
          text: JSON.stringify({ pageId, message: err.message, name: err.name }),
          timestamp: new Date(),
        });
      });

      page.on("framenavigated", (frame) => {
        if (!frame.parentFrame()) {
          this.logger.info(`Navigated to ${frame.url()}`);
          this.customEmit(EmitEvent.Log, {
            type: BrowserEventType.Navigation,
            text: JSON.stringify({ pageId, url: frame.url() }),
            timestamp: new Date(),
          });
        }
      });

      page.on("console", (message) => {
        if (targetType === TargetType.BACKGROUND_PAGE) {
          this.logger.info(`Extension console: ${message.type()}: ${message.text()}`);
        } else {
          this.logger.info(`Console message: ${message.type()}: ${message.text()}`);
        }
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.Console,
          text: JSON.stringify({ pageId, type: message.type(), text: message.text() }),
          timestamp: new Date(),
        });
      });

      page.on("requestfailed", (request) => {
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.RequestFailed,
          text: JSON.stringify({ pageId, errorText: request.failure()?.errorText, url: request.url() }),
          timestamp: new Date(),
        });
      });

      //@ts-ignore
      const session = await page.target().createCDPSession();
      await this.setupCDPLogging(session, targetType);
    } catch (error) {
      this.logger.error(`Error setting up page logging: ${error}`);
    }
  }

  private async setupCDPLogging(session: CDPSession, targetType: TargetType) {
    try {
      if (!env.ENABLE_CDP_LOGGING) {
        return;
      }

      this.logger.info(`[CDP] Attaching CDP logging to session ${session.id()} of target type ${targetType}`);

      await session.send("Runtime.enable");
      await session.send("Log.enable");
      await session.send("Network.enable");
      await session.send("Console.enable");

      session.on("Runtime.executionContextCreated", (event) => {
        this.logger.info(`[CDP] Execution Context Created for ${targetType}`, { event });
      });

      session.on("Runtime.executionContextDestroyed", async () => {
        this.logger.info(`[CDP] Execution Context Destroyed for ${targetType}`);
      });

      session.on("Runtime.consoleAPICalled", (event) => {
        this.logger.info(`[CDP] Console API called for ${targetType}`, { event });
      });

      // Capture browser logs (security issues, CSP violations, fetch failures)
      session.on("Log.entryAdded", (event) => {
        this.logger.warn(`[CDP] Log entry added for ${targetType}`, { event });
      });

      // Capture JavaScript exceptions
      session.on("Runtime.exceptionThrown", (event) => {
        this.logger.error(`[CDP] Runtime exception thrown for ${targetType}`, { event });
      });

      // Capture failed network requests
      session.on("Network.loadingFailed", (event) => {
        this.logger.error(`[CDP] Network request failed for ${targetType}`, { event });
      });

      // Capture failed fetch requests (when a fetch() call fails)
      session.on("Network.requestFailed", (event) => {
        this.logger.error(`[CDP] Network request failed for ${targetType}`, { event });
      });
    } catch (error) {
      this.logger.error(`[CDP] Error setting up CDP logging for ${targetType}: ${error}`);
    }
  }

  public async createPage(): Promise<Page> {
    if (!this.browserInstance) {
      throw new Error("Browser instance not initialized");
    }
    return this.browserInstance.newPage();
  }

  public async shutdown(): Promise<void> {
    if (this.browserInstance) {
      this.shuttingDown = true;
      this.logger.info(`Shutting down CDPService and cleaning up resources`);

      try {
        if (this.browserInstance) {
          await this.pluginManager.onBrowserClose(this.browserInstance);
        }

        await this.pluginManager.onShutdown();

        this.removeAllHandlers();
        await this.browserInstance.close();
        await this.browserInstance.process()?.kill();
        await CDPLifecycle.shutdown(this.currentSessionConfig);
        this.localStorageData = {};
        this.fingerprintData = null;
        this.currentSessionConfig = null;
        this.browserInstance = null;
        this.wsEndpoint = null;
        this.emit("close");
        this.shuttingDown = false;
      } catch (error) {
        this.logger.error(`Error during shutdown: ${error}`);
        // Ensure we complete the shutdown even if plugins throw errors
        await this.browserInstance?.close();
        await this.browserInstance?.process()?.kill();
        await CDPLifecycle.shutdown(this.currentSessionConfig);
        this.browserInstance = null;
        this.shuttingDown = false;
      }
    }
  }

  public getBrowserProcess() {
    return this.browserInstance?.process() || null;
  }

  public async createBrowserContext(proxyUrl: string): Promise<BrowserContext> {
    if (!this.browserInstance) {
      throw new Error("Browser instance not initialized");
    }
    return this.browserInstance.createBrowserContext({ proxyServer: proxyUrl });
  }

  private isDefaultConfig(config?: BrowserLauncherOptions) {
    if (!config) return false;
    const { logSinkUrl: _nlsu, ...newConfig } = config || {};
    const { logSinkUrl: _olsu, ...oldConfig } = this.defaultLaunchConfig || {};
    return JSON.stringify(newConfig) === JSON.stringify(oldConfig);
  }

  public async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    const shouldReuseInstance =
      this.browserInstance && this.isDefaultConfig(config) && this.isDefaultConfig(this.launchConfig);

    if (shouldReuseInstance) {
      this.logger.info("Reusing existing browser instance with default configuration.");
      this.launchConfig = config || this.defaultLaunchConfig;
      await this.refreshPrimaryPage();
      return this.browserInstance!;
    } else if (this.browserInstance) {
      this.logger.info("Existing browser instance detected. Closing it before launching a new one.");
      await this.shutdown();
    }

    this.launchConfig = config || this.defaultLaunchConfig;
    this.logger.info("Launching new browser instance.");

    const { options, userAgent, userDataDir } = this.launchConfig;

    const defaultExtensions = ["recorder"];
    const customExtensions = this.launchConfig.extensions ? [...this.launchConfig.extensions] : [];

    const extensionPaths = getExtensionPaths([...defaultExtensions, ...customExtensions]);

    const extensionArgs = extensionPaths.length
      ? [`--load-extension=${extensionPaths.join(",")}`, `--disable-extensions-except=${extensionPaths.join(",")}`]
      : [];

    const fingerprintGen = new FingerprintGenerator({
      devices: ["desktop"],
      operatingSystems: ["linux"],
      browsers: [{ name: "chrome", minVersion: 128 }],
      locales: ["en-US", "en"],
      screen: {
        minWidth: this.launchConfig.dimensions?.width ?? 1920,
        minHeight: this.launchConfig.dimensions?.height ?? 1080,
        maxWidth: this.launchConfig.dimensions?.width ?? 1920,
        maxHeight: this.launchConfig.dimensions?.height ?? 1080,
      },
    });

    if (this.launchConfig.sessionContext?.localStorage) {
      this.localStorageData = this.launchConfig.sessionContext.localStorage;
    }

    this.fingerprintData = await fingerprintGen.getFingerprint();

    const timezone = config?.timezone || this.defaultTimezone;

    await CDPLifecycle.launch(this.launchConfig);

    const launchArgs = [
      "--remote-allow-origins=*",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      this.launchConfig.dimensions ? "" : "--start-maximized",
      `--remote-debugging-address=${env.HOST}`,
      "--remote-debugging-port=9222",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-angle=disabled",
      "--disable-blink-features=AutomationControlled",
      `--unsafely-treat-insecure-origin-as-secure=http://localhost:3000,http://${env.HOST}:${env.PORT}`,
      `--window-size=${this.launchConfig.dimensions?.width ?? 1920},${this.launchConfig.dimensions?.height ?? 1080}`,
      `--timezone=${timezone}`,
      userAgent ? `--user-agent=${userAgent}` : "",
      this.launchConfig.options.proxyUrl ? `--proxy-server=${this.launchConfig.options.proxyUrl}` : "",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy",
      ...extensionArgs,
      ...(options.args || []),
    ].filter(Boolean);

    console.log("Launch args", launchArgs);

    const finalLaunchOptions = {
      ...options,
      defaultViewport: this.launchConfig.dimensions ? this.launchConfig.dimensions : null,
      args: launchArgs,
      executablePath: this.chromeExecPath,
      timeout: 0,
      handleSIGINT: false,
      handleSIGTERM: false,
      env: {
        TZ: timezone,
        ...process.env,
      },
      userDataDir,
      // dumpio: true, //uncomment this line to see logs from chromium
    };

    this.logger.info(`Launch Options:`);
    this.logger.info(JSON.stringify(finalLaunchOptions, null, 2));
    this.browserInstance = (await puppeteer.launch(finalLaunchOptions)) as unknown as Browser;

    // Notify plugins about browser launch
    await this.pluginManager.onBrowserLaunch(this.browserInstance);

    this.browserInstance.on("error", (err) => {
      this.logger.error(`Browser error: ${err}`);
      this.customEmit(EmitEvent.Log, {
        type: BrowserEventType.BrowserError,
        text: `BROWSER ERROR: ${err}`,
        timestamp: new Date(),
      });
    });

    this.browserInstance.on("targetcreated", this.handleNewTarget.bind(this));
    this.browserInstance.on("targetchanged", this.handleTargetChange.bind(this));
    this.browserInstance.on("disconnected", this.onDisconnect.bind(this));

    this.wsEndpoint = this.browserInstance.wsEndpoint();

    this.primaryPage = (await this.browserInstance.pages())[0];
    await this.handleNewTarget(this.primaryPage.target());
    await this.handleTargetChange(this.primaryPage.target());

    return this.browserInstance;
  }

  public async proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!this.wsEndpoint) {
      throw new Error(`WebSocket endpoint not available. Ensure the browser is launched first.`);
    }

    // Create clean event handler with proper cleanup
    const cleanupListeners = () => {
      this.browserInstance?.off("close", cleanupListeners);
      if (this.browserInstance?.process()) {
        this.browserInstance.process()?.off("close", cleanupListeners);
      }
      this.browserInstance?.off("disconnected", cleanupListeners);
      socket.off("close", cleanupListeners);
      socket.off("error", cleanupListeners);
      console.log("WebSocket connection listeners cleaned up");
    };

    // Set up all event listeners with the same cleanup function
    this.browserInstance?.once("close", cleanupListeners);
    if (this.browserInstance?.process()) {
      this.browserInstance.process()?.once("close", cleanupListeners);
    }
    this.browserInstance?.once("disconnected", cleanupListeners);
    socket.once("close", cleanupListeners);
    socket.once("error", cleanupListeners);

    // Increase max listeners
    if (this.browserInstance?.process()) {
      this.browserInstance.process()!.setMaxListeners(60);
    }

    this.wsProxyServer.ws(
      req,
      socket,
      head,
      {
        target: this.wsEndpoint,
      },
      (error) => {
        if (error) {
          this.logger.error(`WebSocket proxy error: ${error}`);
          cleanupListeners(); // Clean up on error too
        }
      },
    );

    socket.on("error", (error) => {
      this.logger.error(`Socket error: ${error}`);
      // Try to end the socket properly on error
      try {
        socket.end();
      } catch (e) {
        this.logger.error(`Error ending socket: ${e}`);
      }
    });
  }

  public getUserAgent() {
    return this.fingerprintData?.fingerprint.navigator.userAgent;
  }

  public async getBrowserState(): Promise<{
    cookies: Protocol.Network.Cookie[];
    localStorage: Record<string, Record<string, string>>;
  }> {
    if (!this.browserInstance || !this.primaryPage) {
      throw new Error("Browser or primary page not initialized");
    }

    // Also use the new session plugin to get full session data
    const sessionManager = this.primaryPage.session;
    let sessionData: Record<string, any> = {};

    if (sessionManager) {
      try {
        console.log("Dumping session data");
        sessionData = await sessionManager.dump();
        console.log("Session data dumped", sessionData);
      } catch (error) {
        this.logger.error(`Error dumping session data: ${error}`);
      }
    }

    return {
      cookies: JSON.parse(sessionData.cookies),
      localStorage: JSON.parse(sessionData.localStorage),
    };
  }

  private async logEvent(event: BrowserEvent) {
    if (!this.launchConfig?.logSinkUrl) return;

    try {
      const response = await fetch(this.launchConfig.logSinkUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        this.logger.error(
          `Error logging event from CDPService: ${event.type} ${response.statusText} at URL: ${this.launchConfig.logSinkUrl}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error logging event from CDPService: ${error} at URL: ${this.launchConfig.logSinkUrl}`);
    }
  }

  public async getAllPages() {
    return this.browserInstance?.pages() || [];
  }

  public async startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    this.currentSessionConfig = sessionConfig;
    return this.launch(sessionConfig);
  }

  public async endSession(): Promise<void> {
    this.logger.info("Ending current session and restarting with default configuration.");
    await this.shutdown();
    this.currentSessionConfig = null;
    await this.launch(this.defaultLaunchConfig);
  }

  private async onDisconnect(): Promise<void> {
    this.logger.info("Browser disconnected. Handling cleanup.");

    if (this.shuttingDown || this.browserInstance?.process()) {
      return;
    }

    if (this.currentSessionConfig) {
      this.logger.info("Restarting browser with current session configuration.");
      await this.launch(this.currentSessionConfig);
    } else if (this.keepAlive) {
      this.logger.info("Restarting browser with default configuration.");
      await this.launch(this.defaultLaunchConfig);
    } else {
      this.logger.info("Shutting down browser.");
      await this.shutdown();
    }
  }

  private async injectSessionContext(page: Page, context?: BrowserLauncherOptions["sessionContext"]) {
    if (!context) return;

    // Set cookies if provided
    if (context.cookies?.length) {
      await page.setCookie(
        ...context.cookies.map((cookie) => ({
          ...cookie,
          partitionKey: cookie.partitionKey ? String(cookie.partitionKey) : undefined,
        })),
      );
    }

    // Set localStorage if provided - we'll inject it when navigation occurs
    if (context.localStorage) {
      // Listen for framenavigated events to set localStorage for the correct domain
      page.on("framenavigated", async (frame) => {
        // Only handle main frame navigation
        if (!frame.parentFrame()) {
          const domain = new URL(frame.url()).hostname;
          const storageItems = Object.entries(context.localStorage?.[domain] || {});

          if (storageItems?.length) {
            await frame.evaluate((items) => {
              items.forEach(([key, value]) => {
                window.localStorage.setItem(key, value);
              });
            }, storageItems);
          }
        }
      });

      // Also inject for the initial page if we're already on a domain
      const domain = new URL(page.url()).hostname;
      const initialStorageItems = context.localStorage[domain];
      if (initialStorageItems?.length) {
        await page.evaluate((items) => {
          items.forEach(({ key, value }) => {
            window.localStorage.setItem(key, value);
          });
        }, initialStorageItems);
      }
    }
  }

  private async injectFingerprintSafely(page: Page, fingerprintData: BrowserFingerprintWithHeaders) {
    try {
      const { fingerprint, headers } = fingerprintData;
      // TypeScript fix - access userAgent through navigator property
      const userAgent = fingerprint.navigator.userAgent;
      const userAgentMetadata = fingerprint.navigator.userAgentData;
      const { screen } = fingerprint;

      await page.setUserAgent(userAgent);

      const session = await page.target().createCDPSession();

      try {
        await session.send("Page.setDeviceMetricsOverride", {
          screenHeight: screen.height,
          screenWidth: screen.width,
          width: screen.width,
          height: screen.height,
          viewport: {
            width: screen.availWidth,
            height: screen.availHeight,
            scale: 1,
            x: 0,
            y: 0,
          },
          mobile: /phone|android|mobile/i.test(userAgent),
          screenOrientation:
            screen.height > screen.width
              ? { angle: 0, type: "portraitPrimary" }
              : { angle: 90, type: "landscapePrimary" },
          deviceScaleFactor: screen.devicePixelRatio,
        });

        const injectedHeaders = filterHeaders(headers);

        await page.setExtraHTTPHeaders(injectedHeaders);

        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

        await session.send("Emulation.setUserAgentOverride", {
          userAgent: userAgent,
          acceptLanguage: headers["accept-language"],
          platform: fingerprint.navigator.platform || "Linux x86_64",
          userAgentMetadata: {
            brands: userAgentMetadata.brands as unknown as Protocol.Emulation.UserAgentMetadata["brands"],
            fullVersionList:
              userAgentMetadata.fullVersionList as unknown as Protocol.Emulation.UserAgentMetadata["fullVersionList"],
            fullVersion: userAgentMetadata.fullVersion,
            platform: navigator.platform,
            platformVersion: userAgentMetadata.platformVersion,
            architecture: userAgentMetadata.architecture,
            model: userAgentMetadata.model,
            mobile: userAgentMetadata.mobile as unknown as boolean,
            bitness: userAgentMetadata.bitness,
            wow64: userAgentMetadata.wow64 as unknown as boolean,
          },
        });
      } finally {
        // Always detach the session when done
        await session.detach().catch(() => {});
      }

      await page.evaluateOnNewDocument(
        loadFingerprintScript({
          fixedVendor: fingerprint.videoCard.vendor,
          fixedRenderer: fingerprint.videoCard.renderer,
          fixedDeviceMemory: fingerprint.navigator.deviceMemory || 8,
          fixedHardwareConcurrency: fingerprint.navigator.hardwareConcurrency || 8,
        }),
      );
    } catch (error) {
      this.logger.error(`Error injecting fingerprint safely: ${error}`);
      const fingerprintInjector = new FingerprintInjector();
      // @ts-ignore - Ignore type mismatch between puppeteer versions
      await fingerprintInjector.attachFingerprintToPuppeteer(page, fingerprintData);
    }
  }
}
