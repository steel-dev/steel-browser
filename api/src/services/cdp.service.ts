import puppeteer, { Browser, Page, Target, BrowserContext, Protocol, TargetType, CDPSession } from "puppeteer-core";
import { Duplex } from "stream";
import { EventEmitter } from "events";
import { getBrowserExecutablePath, BrowserType } from "../utils/browser";
import httpProxy from "http-proxy";
import { IncomingMessage } from "http";
import { env } from "../env";
import { getExtensionPaths } from "../utils/extensions";
import { BrowserLauncherOptions, BrowserEvent, EmitEvent, BrowserEventType } from "../types";
import { FingerprintInjector } from "fingerprint-injector";
import { BrowserFingerprintWithHeaders, FingerprintGenerator } from "fingerprint-generator";
import { FastifyBaseLogger } from "fastify";
import { isAdRequest } from "../utils/ads";

export class CDPService extends EventEmitter {
  private logger: FastifyBaseLogger;
  private keepAlive: boolean;
  private isActive: boolean;
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

  constructor(config: { keepAlive?: boolean }, logger: FastifyBaseLogger) {
    super();
    this.logger = logger;
    const { keepAlive = true } = config;
    this.isActive = false;
    this.keepAlive = keepAlive;
    this.browserInstance = null;
    this.wsEndpoint = null;
    this.fingerprintData = null;
    this.chromeExecPath = getBrowserExecutablePath(BrowserType.CHROME);
    this.wsProxyServer = httpProxy.createProxyServer();
    this.primaryPage = null;
    this.localStorageData = {};
    this.currentSessionConfig = null;
    this.shuttingDown = false;
    this.defaultLaunchConfig = {
      options: { headless: env.CHROME_HEADLESS },
    };
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

      await page.setBypassCSP(true);
    }
  }

  private async handleNewTarget(target: Target) {
    if (target.type() === TargetType.PAGE) {
      const page = await target.page().catch((e) => {
        this.logger.error(`Error handling new target in CDPService: ${e}`);
        return null;
      });

      if (page) {
        // Inject session context first
        await this.injectSessionContext(page, this.launchConfig?.sessionContext);

        if (this.launchConfig?.customHeaders) {
          await page.setExtraHTTPHeaders({
            ...env.DEFAULT_HEADERS,
            ...this.launchConfig.customHeaders,
          });
        } else if (env.DEFAULT_HEADERS) {
          await page.setExtraHTTPHeaders(env.DEFAULT_HEADERS);
        }

        const fingerprintInjector = new FingerprintInjector();
        //@ts-ignore
        await fingerprintInjector.attachFingerprintToPuppeteer(page, this.fingerprintData!);

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

        const cdpSession = await page.createCDPSession();

        const currentViewport = await page.viewport();

        const { width, height } = this.launchConfig?.dimensions || { width: 1920, height: 1080 };

        this.logger.info("Setting viewport to", width, height);
        if (!currentViewport || currentViewport.width !== width || currentViewport.height !== height) {
          await page.setViewport({ width, height });
          await (
            await page.createCDPSession()
          ).send("Page.setDeviceMetricsOverride", {
            screenHeight: height,
            screenWidth: width,
            width,
            height,
            mobile: /phone|android|mobile/i.test(this.fingerprintData!.fingerprint.navigator.userAgent),
            screenOrientation:
              height > width ? { angle: 0, type: "portraitPrimary" } : { angle: 90, type: "landscapePrimary" },
            deviceScaleFactor: this.fingerprintData!.fingerprint.screen.devicePixelRatio,
          });
        }

        page.on("close", async () => {
          cdpSession.removeAllListeners();
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
      const session = await target.createCDPSession();
      await this.setupCDPLogging(session, target.type());
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
      this.removeAllHandlers();
      await this.browserInstance.close();
      await this.browserInstance.process()?.kill();
      this.isActive = false;
      this.browserInstance = null;
      this.wsEndpoint = null;
      this.emit("close");
      this.shuttingDown = false;
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

  public async launch(config?: BrowserLauncherOptions): Promise<Browser> {
    this.launchConfig = config || this.defaultLaunchConfig;

    if (this.browserInstance) {
      this.logger.info("Existing browser instance detected. Closing it before launching a new one.");
      await this.shutdown();
    }

    const { options, userAgent } = this.launchConfig;

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
    });

    if (this.launchConfig.sessionContext?.localStorage) {
      this.localStorageData = this.launchConfig.sessionContext.localStorage;
    }

    this.fingerprintData = await fingerprintGen.getFingerprint();

    const timezone = "America/New_York"; // TODO: determine timezone from session config or proxy

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
      // dumpio: true, //uncomment this line to see logs from chromium
    };

    this.logger.info(`Launch Options:`);
    this.logger.info(JSON.stringify(finalLaunchOptions, null, 2));
    this.browserInstance = (await puppeteer.launch(finalLaunchOptions)) as unknown as Browser;

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

    this.isActive = true;
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

    const onDisconnect = async () => {
      this.browserInstance?.off("close", onDisconnect);
      this.browserInstance?.process()?.off("close", onDisconnect);
      socket.off("close", onDisconnect);
    };

    this.browserInstance?.once("close", onDisconnect);
    this.browserInstance?.process()?.once("close", onDisconnect);
    socket.once("close", onDisconnect);

    this.browserInstance?.once("disconnected", onDisconnect);

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
          this.shutdown();
          throw error;
        }
      },
    );
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

    const client = await this.primaryPage.createCDPSession();
    const { cookies } = await client.send("Network.getAllCookies");
    return { cookies, localStorage: this.localStorageData };
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
    if (this.browserInstance) {
      this.logger.info("Closing existing browser before starting a new session.");
      await this.shutdown();
    }
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
}
