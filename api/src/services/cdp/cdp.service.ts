import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import {
  BrowserFingerprintWithHeaders,
  FingerprintGenerator,
  FingerprintGeneratorOptions,
  VideoCard,
} from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";
import fs from "fs";
import { IncomingMessage } from "http";
import httpProxy from "http-proxy";
import os from "os";
import path from "path";
import puppeteer, {
  Browser,
  BrowserContext,
  CDPSession,
  HTTPRequest,
  Page,
  Protocol,
  Target,
  TargetType,
} from "puppeteer-core";
import { Duplex } from "stream";
import { env } from "../../env.js";
import { loadFingerprintScript } from "../../scripts/index.js";
import { traceable, tracer } from "../../telemetry/tracer.js";
import {
  BrowserEvent,
  BrowserEventType,
  BrowserLauncherOptions,
  EmitEvent,
} from "../../types/index.js";
import {
  isAdRequest,
  isHeavyMediaRequest,
  isHostBlocked,
  isUrlMatchingPatterns,
  isImageRequest,
} from "../../utils/requests.js";
import { filterHeaders, getChromeExecutablePath } from "../../utils/browser.js";
import {
  deepMerge,
  extractStorageForPage,
  getProfilePath,
  groupSessionStorageByOrigin,
  handleFrameNavigated,
} from "../../utils/context.js";
import { getExtensionPaths } from "../../utils/extensions.js";
import { RetryManager, RetryOptions } from "../../utils/retry.js";
import { ChromeContextService } from "../context/chrome-context.service.js";
import { SessionData } from "../context/types.js";
import { FileService } from "../file.service.js";
import {
  BaseLaunchError,
  BrowserProcessError,
  BrowserProcessState,
  CleanupError,
  CleanupType,
  FingerprintError,
  FingerprintStage,
  LaunchTimeoutError,
  NetworkError,
  NetworkOperation,
  PluginError,
  PluginName,
  PluginOperation,
  ResourceError,
  ResourceType,
  SessionContextError,
  SessionContextType,
  categorizeError,
} from "./errors/launch-errors.js";
import { BasePlugin } from "./plugins/core/base-plugin.js";
import { PluginManager } from "./plugins/core/plugin-manager.js";
import { isSimilarConfig, validateLaunchConfig, validateTimezone } from "./utils/validation.js";

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
  private defaultLaunchConfig: BrowserLauncherOptions;
  private currentSessionConfig: BrowserLauncherOptions | null;
  private shuttingDown: boolean;
  private defaultTimezone: string;
  private pluginManager: PluginManager;
  private trackedOrigins: Set<string> = new Set<string>();
  private chromeSessionService: ChromeContextService;
  private retryManager: RetryManager;

  private launchMutators: ((config: BrowserLauncherOptions) => Promise<void> | void)[] = [];
  private shutdownMutators: ((config: BrowserLauncherOptions | null) => Promise<void> | void)[] =
    [];
  private proxyWebSocketHandler:
    | ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>)
    | null = null;

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
    this.trackedOrigins = new Set<string>();
    this.chromeSessionService = new ChromeContextService(logger);
    this.retryManager = new RetryManager(logger);
    // Clean up any existing proxy server
    if (this.wsProxyServer) {
      try {
        this.wsProxyServer.close();
      } catch (e) {
        // Ignore errors when closing
      }
    }

    this.wsProxyServer = httpProxy.createProxyServer();

    this.wsProxyServer.on("error", (err) => {
      this.logger.error(`Proxy server error: ${err}`);
    });

    this.primaryPage = null;
    this.currentSessionConfig = null;
    this.shuttingDown = false;
    this.defaultLaunchConfig = {
      options: { headless: env.CHROME_HEADLESS, args: [] },
      blockAds: true,
      extensions: [],
      userDataDir: env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "steel-chrome"),
    };

    this.pluginManager = new PluginManager(this, logger);
  }

  public setProxyWebSocketHandler(
    handler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>) | null,
  ): void {
    this.proxyWebSocketHandler = handler;
  }

  public getBrowserInstance(): Browser | null {
    return this.browserInstance;
  }

  public getLaunchConfig(): BrowserLauncherOptions | undefined {
    return this.launchConfig;
  }

  public registerLaunchHook(fn: (config: BrowserLauncherOptions) => Promise<void> | void) {
    this.launchMutators.push(fn);
  }

  public registerShutdownHook(fn: (config: BrowserLauncherOptions | null) => Promise<void> | void) {
    this.shutdownMutators.push(fn);
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

  private getDebuggerBase(): { baseUrl: string; protocol: string; wsProtocol: string } {
    const baseUrl = env.CDP_DOMAIN ?? env.DOMAIN ?? `${env.HOST}:${env.CDP_REDIRECT_PORT}`;
    const protocol = env.USE_SSL ? "https" : "http";
    const wsProtocol = env.USE_SSL ? "wss" : "ws";
    return { baseUrl, protocol, wsProtocol };
  }

  public getDebuggerUrl() {
    const { baseUrl, protocol } = this.getDebuggerBase();
    return `${protocol}://${baseUrl}/devtools/devtools_app.html`;
  }

  public getDebuggerWsUrl(pageId?: string) {
    const { baseUrl, wsProtocol } = this.getDebuggerBase();
    return `${wsProtocol}://${baseUrl}/devtools/page/${
      pageId ?? this.getTargetId(this.primaryPage!)
    }`;
  }

  public customEmit(event: EmitEvent, payload: any) {
    try {
      this.emit(event, payload);

      if (env.LOG_CUSTOM_EMIT_EVENTS) {
        this.logger.info({ event, payload }, "EmitEvent");
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
      this.logger.error({ err: error }, `Error emitting event`);
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

  public registerPlugin(plugin: BasePlugin) {
    return this.pluginManager.register(plugin);
  }

  public unregisterPlugin(pluginName: string) {
    return this.pluginManager.unregister(pluginName);
  }

  private async handleTargetChange(target: Target) {
    if (target.type() !== "page") return;

    const page = await target.page().catch((e) => {
      this.logger.error(`Error handling target change in CDPService: ${e}`);
      return null;
    });

    if (page) {
      this.pluginManager.onPageNavigate(page);

      //@ts-ignore
      const pageId = page.target()._targetId;

      // Track the origin of the page
      try {
        const url = page.url();
        if (url && url.startsWith("http")) {
          const origin = new URL(url).origin;
          this.trackedOrigins.add(origin);
          this.logger.debug(`[CDPService] Tracking new origin: ${origin}`);
        }
      } catch (err) {
        this.logger.error(`[CDPService] Error tracking origin: ${err}`);
      }

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
        try {
          const url = page.url();
          if (url && url.startsWith("http")) {
            const origin = new URL(url).origin;
            this.trackedOrigins.add(origin);
            this.logger.debug(`[CDPService] Tracking new origin: ${origin}`);
          }
        } catch (err) {
          this.logger.error(`[CDPService] Error tracking origin: ${err}`);
        }

        // Notify plugins about the new page
        await this.pluginManager.onPageCreated(page);

        if (this.currentSessionConfig?.timezone) {
          try {
            const resolvedTimezone = await this.currentSessionConfig.timezone;
            await page.emulateTimezone(resolvedTimezone);
          } catch (error) {
            this.logger.warn(`Failed to resolve timezone for page emulation: ${error}`);
          }
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
          await this.injectFingerprintSafely(page, this.fingerprintData);
          this.logger.debug("[CDPService] Injected fingerprint into page");
        } else {
          this.logger.info(
            "[CDPService] Fingerprint injection skipped due to 'SKIP_FINGERPRINT_INJECTION' setting",
          );
        }

        await page.setRequestInterception(true);

        await this.setupPageLogging(page, target.type());

        page.on("request", (request) => this.handlePageRequest(request, page));

        page.on("response", (response) => {
          if (response.url().startsWith("file://")) {
            this.logger.error(
              `[CDPService] Blocked response from file protocol: ${response.url()}`,
            );
            page.close().catch(() => {});
            this.shutdown();
          }
        });
      }
    } else if (target.type() === TargetType.BACKGROUND_PAGE) {
      this.logger.info(`[CDPService] Background page created: ${target.url()}`);
      const page = await target.page();
      await this.setupPageLogging(page, target.type());
    } else {
      // TODO: Handle SERVICE_WORKER, SHARED_WORKER, BROWSER, WEBVIEW and OTHER targets.
    }
  }

  private async handlePageRequest(request: HTTPRequest, page: Page) {
    const headers = request.headers();
    delete headers["accept-language"]; // Patch to help with headless detection

    const optimize = this.launchConfig?.optimizeBandwidth;
    const blockedHosts = typeof optimize === "object" ? optimize.blockHosts : undefined;
    const blockedUrlPatterns = typeof optimize === "object" ? optimize.blockUrlPatterns : undefined;

    if (this.launchConfig?.blockAds && isAdRequest(request.url())) {
      this.logger.info(`[CDPService] Blocked request to ad related resource: ${request.url()}`);
      await request.abort();
      return;
    }

    if (
      isHostBlocked(request.url(), blockedHosts) ||
      isUrlMatchingPatterns(request.url(), blockedUrlPatterns)
    ) {
      this.logger.info(`[CDPService] Blocked request to blocked host or pattern: ${request.url()}`);
      await request.abort();
      return;
    }

    // Block resources via optimizeBandwidth
    const blockImages = typeof optimize === "object" ? !!optimize.blockImages : false;
    const blockMedia = typeof optimize === "object" ? !!optimize.blockMedia : false;
    const blockStylesheets = typeof optimize === "object" ? !!optimize.blockStylesheets : false;

    if (blockImages || blockMedia || blockStylesheets) {
      const resourceType = request.resourceType();
      if (
        (blockImages && (resourceType === "image" || isImageRequest(request.url()))) ||
        (blockMedia && (resourceType === "media" || isHeavyMediaRequest(request.url()))) ||
        (blockStylesheets && resourceType === "stylesheet")
      ) {
        this.logger.info(
          `[CDPService] Blocked ${resourceType} resource due to optimizeBandwidth (${
            blockImages ? "blockImages" : ""
          }${blockMedia ? "blockMedia" : ""}${
            blockStylesheets ? "blockStylesheets" : ""
          }): ${request.url()}`,
        );
        await request.abort();
        return;
      }
    }

    if (request.url().startsWith("file://")) {
      this.logger.error(`[CDPService] Blocked request to file protocol: ${request.url()}`);
      page.close().catch(() => {});
      this.shutdown();
    } else {
      await request.continue({ headers });
    }
  }

  private async setupPageLogging(page: Page | null, targetType: TargetType) {
    try {
      if (!page) {
        return;
      }

      this.logger.info(`[CDPService] Setting up logging for page: ${page.url()}`);

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
          text: err
            ? JSON.stringify({ pageId, message: err.message, name: err.name })
            : "Unknown error on page",
          timestamp: new Date(),
        });
      });

      page.on("pageerror", (err) => {
        this.customEmit(EmitEvent.Log, {
          type: BrowserEventType.PageError,
          text: err
            ? JSON.stringify({ pageId, message: err.message, name: err.name })
            : "Unknown page error",
          timestamp: new Date(),
        });
      });

      page.on("framenavigated", (frame) => {
        if (!frame.parentFrame()) {
          this.logger.info(`[CDPService] Navigated to ${frame.url()}`);
          this.customEmit(EmitEvent.Log, {
            type: BrowserEventType.Navigation,
            text: JSON.stringify({ pageId, url: frame.url() }),
            timestamp: new Date(),
          });
        }
      });

      page.on("console", (message) => {
        if (targetType === TargetType.BACKGROUND_PAGE) {
          this.logger.info(`[CDPService] Extension console: ${message.type()}: ${message.text()}`);
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
          text: JSON.stringify({
            pageId,
            errorText: request.failure()?.errorText,
            url: request.url(),
          }),
          timestamp: new Date(),
        });
      });

      const session = await page.createCDPSession();
      await this.setupCDPLogging(session, targetType);
    } catch (error) {
      this.logger.error(`[CDPService] Error setting up page logging: ${error}`);
    }
  }

  private async setupCDPLogging(session: CDPSession, targetType: TargetType) {
    try {
      if (!env.ENABLE_CDP_LOGGING) {
        return;
      }

      this.logger.info(
        `[CDP] Attaching CDP logging to session ${session.id()} of target type ${targetType}`,
      );

      await session.send("Runtime.enable");
      await session.send("Log.enable");
      await session.send("Network.enable");
      await session.send("Console.enable");

      session.on(
        "Runtime.executionContextCreated",
        (event: Protocol.Runtime.ExecutionContextCreatedEvent) => {
          this.logger.info({ event }, `[CDP] Execution Context Created for ${targetType}`);
        },
      );

      session.on(
        "Runtime.executionContextDestroyed",
        async (_event: Protocol.Runtime.ExecutionContextDestroyedEvent) => {
          this.logger.info(`[CDP] Execution Context Destroyed for ${targetType}`);
        },
      );

      session.on("Runtime.consoleAPICalled", (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
        this.logger.info({ event }, `[CDP] Console API called for ${targetType}`);
      });

      // Capture browser logs (security issues, CSP violations, fetch failures)
      session.on("Log.entryAdded", (event: Protocol.Log.EntryAddedEvent) => {
        this.logger.warn({ event }, `[CDP] Log entry added for ${targetType}`);
      });

      // Capture JavaScript exceptions
      session.on("Runtime.exceptionThrown", (event: Protocol.Runtime.ExceptionThrownEvent) => {
        this.logger.error({ event }, `[CDP] Runtime exception thrown for ${targetType}`);
      });

      // Capture failed network requests
      session.on("Network.loadingFailed", (event: Protocol.Network.LoadingFailedEvent) => {
        this.logger.error({ event }, `[CDP] Network request failed for ${targetType}`);
      });

      // Capture failed fetch requests (when a fetch() call fails)
      session.on("Network.requestFailed", (event: unknown) => {
        this.logger.error({ event }, `[CDP] Network request failed for ${targetType}`);
      });
    } catch (error: any) {
      this.logger.error(`[CDP] Error setting up CDP logging for ${targetType}: ${error}`);
    }
  }

  public async createPage(): Promise<Page> {
    if (!this.browserInstance) {
      throw new Error("Browser instance not initialized");
    }
    return this.browserInstance.newPage();
  }

  private async shutdownHook() {
    for (const mutator of this.shutdownMutators) {
      await mutator(this.currentSessionConfig);
    }
  }

  @traceable
  public async shutdown(): Promise<void> {
    if (this.browserInstance) {
      this.shuttingDown = true;
      this.logger.info(`[CDPService] Shutting down and cleaning up resources`);

      try {
        if (this.browserInstance) {
          await this.pluginManager.onBrowserClose(this.browserInstance);
        }

        await this.pluginManager.onShutdown();

        this.removeAllHandlers();
        await this.browserInstance.close();
        await this.browserInstance.process()?.kill();
        await this.shutdownHook();

        this.logger.info("[CDPService] Cleaning up files during shutdown");
        try {
          await FileService.getInstance().cleanupFiles();
          this.logger.info("[CDPService] Files cleaned successfully");
        } catch (error) {
          this.logger.error(`[CDPService] Error cleaning files during shutdown: ${error}`);
        }

        this.fingerprintData = null;
        this.currentSessionConfig = null;
        this.browserInstance = null;
        this.wsEndpoint = null;
        this.emit("close");
        this.shuttingDown = false;
      } catch (error) {
        this.logger.error(`[CDPService] Error during shutdown: ${error}`);
        // Ensure we complete the shutdown even if plugins throw errors
        await this.browserInstance?.close();
        await this.browserInstance?.process()?.kill();
        await this.shutdownHook();

        try {
          await FileService.getInstance().cleanupFiles();
        } catch (cleanupError) {
          this.logger.error(
            `[CDPService] Error cleaning files during error recovery: ${cleanupError}`,
          );
        }

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

  @traceable
  public async launch(
    config?: BrowserLauncherOptions,
    retryOptions?: Partial<RetryOptions>,
  ): Promise<Browser> {
    const operation = async () => {
      try {
        return await this.launchInternal(config);
      } catch (error) {
        try {
          await this.pluginManager.onShutdown();
          await this.shutdownHook();
        } catch (e) {
          this.logger.warn(
            `[CDPService] Error during retry cleanup (onShutdown/shutdownHook): ${e}`,
          );
        }
        throw error;
      }
    };

    // Use retry mechanism for the launch process
    const result = await this.retryManager.executeWithRetry(
      operation,
      "Browser Launch",
      retryOptions,
    );

    return result.result;
  }

  @traceable
  private async launchInternal(config?: BrowserLauncherOptions): Promise<Browser> {
    try {
      const launchTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new LaunchTimeoutError(60000)), 60000);
      });

      const launchProcess = (async () => {
        const shouldReuseInstance =
          this.browserInstance &&
          isSimilarConfig(this.launchConfig, config || this.defaultLaunchConfig);

        if (shouldReuseInstance) {
          this.logger.info(
            "[CDPService] Reusing existing browser instance with default configuration.",
          );
          this.launchConfig = config || this.defaultLaunchConfig;
          try {
            await this.refreshPrimaryPage();
          } catch (error) {
            throw new BrowserProcessError(
              "Failed to refresh primary page when reusing browser instance",
              BrowserProcessState.PAGE_REFRESH,
            );
          }

          // Session context injection - should throw error if it fails
          if (this.launchConfig?.sessionContext) {
            this.logger.debug(
              `[CDPService] Session created with session context, injecting session context`,
            );
            try {
              await this.injectSessionContext(this.primaryPage!, this.launchConfig.sessionContext);
            } catch (error) {
              const contextError = new SessionContextError(
                error instanceof Error ? error.message : String(error),
                SessionContextType.CONTEXT_INJECTION,
              );
              this.logger.warn(`[CDPService] ${contextError.message} - throwing error`);
              throw contextError;
            }
          }

          this.pluginManager.onBrowserReady(this.launchConfig);

          return this.browserInstance!;
        } else if (this.browserInstance) {
          this.logger.info(
            "[CDPService] Existing browser instance detected. Closing it before launching a new one.",
          );
          try {
            await this.shutdown();
          } catch (error) {
            // Log but don't fail launch due to shutdown issues
            this.logger.warn(`[CDPService] Error during shutdown before launch: ${error}`);
          }
        }

        this.launchConfig = config || this.defaultLaunchConfig;
        this.logger.info("[CDPService] Launching new browser instance.");

        // Validate configuration
        try {
          validateLaunchConfig(this.launchConfig);
        } catch (error) {
          throw categorizeError(error, "configuration validation");
        }

        // File cleanup - non-critical, log errors but continue
        this.logger.info("[CDPService] Cleaning up files before browser launch");
        try {
          await FileService.getInstance().cleanupFiles();
          this.logger.info("[CDPService] Files cleaned successfully before launch");
        } catch (error) {
          const cleanupError = new CleanupError(
            error instanceof Error ? error.message : String(error),
            CleanupType.PRE_LAUNCH_FILE_CLEANUP,
          );
          this.logger.warn(`[CDPService] ${cleanupError.message} - continuing with launch`);
        }

        const { options, userAgent, userDataDir } = this.launchConfig;

        // Run launch mutators - plugin errors should be caught
        try {
          for (const mutator of this.launchMutators) {
            await mutator(this.launchConfig);
          }
        } catch (error) {
          throw new PluginError(
            error instanceof Error ? error.message : String(error),
            PluginName.LAUNCH_MUTATOR,
            PluginOperation.PRE_LAUNCH_HOOK,
          );
        }

        // Fingerprint generation - can fail gracefully
        if (
          !env.SKIP_FINGERPRINT_INJECTION &&
          !userAgent &&
          !this.launchConfig.skipFingerprintInjection &&
          !this.fingerprintData
        ) {
          try {
            const defaultFingerprintOptions: Partial<FingerprintGeneratorOptions> = {
              devices: ["desktop"],
              operatingSystems: ["linux"],
              browsers: [{ name: "chrome", minVersion: 136 }],
              locales: ["en-US", "en"],
            };

            const fingerprintGen = new FingerprintGenerator({
              ...defaultFingerprintOptions,
              screen: {
                minWidth: this.launchConfig.dimensions?.width ?? 1920,
                minHeight: this.launchConfig.dimensions?.height ?? 1080,
                maxWidth: this.launchConfig.dimensions?.width ?? 1920,
                maxHeight: this.launchConfig.dimensions?.height ?? 1080,
              },
            });

            this.fingerprintData = fingerprintGen.getFingerprint();
          } catch (error) {
            throw new FingerprintError(
              error instanceof Error ? error.message : String(error),
              FingerprintStage.GENERATION,
            );
          }
        } else if (this.fingerprintData) {
          this.logger.info(
            `[CDPService] Using existing fingerprint with user agent: ${this.fingerprintData.fingerprint.navigator.userAgent}`,
          );
        }

        this.currentSessionConfig = this.launchConfig;

        let extensionPaths: string[] = [];
        try {
          const defaultExtensions = ["recorder"];
          const customExtensions = this.launchConfig.extensions
            ? [...this.launchConfig.extensions]
            : [];

          // Get named extension paths
          const namedExtensionPaths = await getExtensionPaths([
            ...defaultExtensions,
            ...customExtensions,
          ]);

          // Check for session extensions passed from the API
          let sessionExtensionPaths: string[] = [];
          if (this.launchConfig.extra?.orgExtensions?.paths) {
            sessionExtensionPaths = this.launchConfig.extra.orgExtensions
              .paths as unknown as string[];
            this.logger.info(
              `[CDPService] Found ${sessionExtensionPaths.length} session extension paths`,
            );
          }

          extensionPaths = [...namedExtensionPaths, ...sessionExtensionPaths];
        } catch (error) {
          throw new ResourceError(
            `Failed to resolve extension paths: ${error}`,
            ResourceType.EXTENSIONS,
            false,
          );
        }

        let timezone = this.defaultTimezone;
        if (config?.timezone) {
          try {
            timezone = await validateTimezone(config.timezone, this.defaultTimezone);
            this.logger.debug(`Resolved and validated timezone: ${timezone}`);
          } catch (error) {
            this.logger.warn(`Timezone validation failed: ${error}, using fallback`);
            timezone = this.defaultTimezone;
          }
        }

        const extensionArgs = extensionPaths.length
          ? [
              `--load-extension=${extensionPaths.join(",")}`,
              `--disable-extensions-except=${extensionPaths.join(",")}`,
            ]
          : [];

        const staticDefaultArgs = [
          "--remote-allow-origins=*",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-features=IsolateOrigins,site-per-process,TouchpadAndWheelScrollLatching,TrackingProtection3pcd",
          "--enable-features=Clipboard",
          "--no-default-browser-check",
          "--no-first-run",
          "--disable-search-engine-choice-screen",
          "--disable-blink-features=AutomationControlled",
          "--webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--force-webrtc-ip-handling-policy",
          "--disable-touch-editing",
          "--disable-touch-drag-drop",
        ];

        const dynamicArgs = [
          this.launchConfig.dimensions ? "" : "--start-maximized",
          `--remote-debugging-address=${env.HOST}`,
          "--remote-debugging-port=9222",
          `--unsafely-treat-insecure-origin-as-secure=http://localhost:3000,http://${env.HOST}:${env.PORT}`,
          `--window-size=${this.launchConfig.dimensions?.width ?? 1920},${
            this.launchConfig.dimensions?.height ?? 1080
          }`,
          `--timezone=${timezone}`,
          userAgent ? `--user-agent=${userAgent}` : "",
          this.launchConfig.options.proxyUrl
            ? `--proxy-server=${this.launchConfig.options.proxyUrl}`
            : "",
        ];

        const launchArgs = [
          ...staticDefaultArgs,
          ...dynamicArgs,
          ...extensionArgs,
          ...(options.args || []),
          ...env.CHROME_ARGS,
        ]
          .filter(Boolean)
          .filter((arg) => !env.FILTER_CHROME_ARGS.includes(arg));

        const finalLaunchOptions = {
          ...options,
          defaultViewport: null,
          args: launchArgs,
          executablePath: this.chromeExecPath,
          timeout: 0,
          env: {
            TZ: timezone,
            ...(!this.launchConfig.options.headless && { DISPLAY: env.DISPLAY }),
          },
          userDataDir,
          dumpio: env.DEBUG_CHROME_PROCESS, // Enable Chrome process stdout and stderr
        };

        this.logger.info(`[CDPService] Launch Options:`);
        this.logger.info(JSON.stringify(finalLaunchOptions, null, 2));

        if (userDataDir && this.launchConfig.userPreferences) {
          this.logger.info(`[CDPService] Setting up user preferences in ${userDataDir}`);
          try {
            await this.setupUserPreferences(userDataDir, this.launchConfig.userPreferences);
          } catch (error) {
            this.logger.warn(`[CDPService] Failed to set up user preferences: ${error}`);
          }
        }

        // Browser process launch - most critical step
        try {
          this.browserInstance = (await tracer.startActiveSpan(
            "CDPService.launchBrowser",
            async () => {
              return await puppeteer.launch(finalLaunchOptions);
            },
          )) as unknown as Browser;
        } catch (error) {
          throw new BrowserProcessError(
            error instanceof Error ? error.message : String(error),
            BrowserProcessState.LAUNCH_FAILED,
          );
        }

        // Plugin notifications - catch individual plugin errors
        try {
          await this.pluginManager.onBrowserLaunch(this.browserInstance);
        } catch (error) {
          const pluginError = new PluginError(
            error instanceof Error ? error.message : String(error),
            PluginName.PLUGIN_MANAGER,
            PluginOperation.BROWSER_LAUNCH_NOTIFICATION,
          );
          this.logger.warn(`[CDPService] ${pluginError.message} - continuing with launch`);
        }

        this.browserInstance.on("error", (err) => {
          this.logger.error(`[CDPService] Browser error: ${err}`);
          this.customEmit(EmitEvent.Log, {
            type: BrowserEventType.BrowserError,
            text: `BROWSER ERROR: ${err}`,
            timestamp: new Date(),
          });
        });

        try {
          this.primaryPage = (await this.browserInstance.pages())[0];
        } catch (error) {
          throw new BrowserProcessError(
            "Failed to get primary page from browser instance",
            BrowserProcessState.PAGE_ACCESS,
          );
        }

        // Session context injection - should throw error if it fails
        if (this.launchConfig?.sessionContext) {
          this.logger.debug(
            `[CDPService] Session created with session context, injecting session context`,
          );
          try {
            await this.injectSessionContext(this.primaryPage, this.launchConfig.sessionContext);
          } catch (error) {
            const contextError = new SessionContextError(
              error instanceof Error ? error.message : String(error),
              SessionContextType.CONTEXT_INJECTION,
            );
            this.logger.warn(`[CDPService] ${contextError.message} - throwing error`);
            throw contextError;
          }
        }

        this.browserInstance.on("targetcreated", this.handleNewTarget.bind(this));
        this.browserInstance.on("targetchanged", this.handleTargetChange.bind(this));
        this.browserInstance.on("disconnected", this.onDisconnect.bind(this));

        try {
          this.wsEndpoint = this.browserInstance.wsEndpoint();
        } catch (error) {
          throw new NetworkError(
            "Failed to get WebSocket endpoint from browser",
            NetworkOperation.WEBSOCKET_SETUP,
          );
        }

        // Final setup steps
        try {
          await this.handleNewTarget(this.primaryPage.target());
          await this.handleTargetChange(this.primaryPage.target());
        } catch (error) {
          const setupError = new BrowserProcessError(
            error instanceof Error ? error.message : String(error),
            BrowserProcessState.TARGET_SETUP,
          );
          this.logger.warn(
            `[CDPService] ${setupError.message} - browser may not function correctly`,
          );
        }

        this.pluginManager.onBrowserReady(this.launchConfig);

        return this.browserInstance;
      })();

      return (await Promise.race([launchProcess, launchTimeout])) as Browser;
    } catch (error: unknown) {
      const categorizedError =
        error instanceof BaseLaunchError ? error : categorizeError(error, "browser launch");

      this.logger.error(
        {
          error: {
            errorType: categorizedError.type,
            isRetryable: categorizedError.isRetryable,
            context: categorizedError.context,
          },
        },
        `[CDPService] LAUNCH ERROR (${categorizedError.type}): ${categorizedError.message}`,
      );

      throw categorizedError;
    }
  }

  @traceable
  public async proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.proxyWebSocketHandler) {
      this.logger.info("[CDPService] Using custom WebSocket proxy handler");
      await this.proxyWebSocketHandler(req, socket, head);
      return;
    }

    if (!this.wsEndpoint) {
      throw new Error(`WebSocket endpoint not available. Ensure the browser is launched first.`);
    }

    const cleanupListeners = () => {
      this.browserInstance?.off("close", cleanupListeners);
      if (this.browserInstance?.process()) {
        this.browserInstance.process()?.off("close", cleanupListeners);
      }
      this.browserInstance?.off("disconnected", cleanupListeners);
      socket.off("close", cleanupListeners);
      socket.off("error", cleanupListeners);
      this.logger.info("[CDPService] WebSocket connection listeners cleaned up");
    };

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
    return (
      this.currentSessionConfig?.userAgent || this.fingerprintData?.fingerprint.navigator.userAgent
    );
  }

  public async getCookies(): Promise<Protocol.Network.Cookie[]> {
    if (!this.primaryPage) {
      throw new Error("Primary page not initialized");
    }
    const client = await this.primaryPage.createCDPSession();
    const { cookies } = await client.send("Network.getAllCookies");
    await client.detach();
    return cookies;
  }

  public async getBrowserState(): Promise<SessionData> {
    if (!this.browserInstance || !this.primaryPage) {
      throw new Error("Browser or primary page not initialized");
    }

    const userDataDir = this.launchConfig?.userDataDir;

    if (!userDataDir) {
      this.logger.warn("No userDataDir specified, returning empty session data");
      return {};
    }

    try {
      this.logger.info(`[CDPService] Dumping session data from userDataDir: ${userDataDir}`);

      // Run session data extraction and CDP storage extraction in parallel
      const [cookieData, sessionData, storageData] = await Promise.all([
        this.getCookies(),
        this.chromeSessionService.getSessionData(userDataDir),
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

      this.logger.info("[CDPService] Session data dumped successfully");
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[CDPService] Error dumping session data: ${errorMessage}`);
      return {};
    }
  }

  /**
   * Extract all storage data (localStorage, sessionStorage, IndexedDB) for all open pages
   */
  private async getExistingPageSessionData(): Promise<SessionData> {
    if (!this.browserInstance || !this.primaryPage) {
      return {};
    }

    const result: SessionData = {
      localStorage: {},
      sessionStorage: {},
      indexedDB: {},
    };

    try {
      const pages = await this.browserInstance.pages();

      const validPages = pages.filter((page) => {
        try {
          const url = page.url();
          return url && url.startsWith("http");
        } catch (e) {
          return false;
        }
      });

      this.logger.info(
        `[CDPService] Processing ${validPages.length} valid pages out of ${pages.length} total for storage extraction`,
      );

      const results = await Promise.all(
        validPages.map((page) => extractStorageForPage(page, this.logger)),
      );

      // Merge all results
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
      this.logger.error(`[CDPService] Error extracting storage with CDP: ${error}`);
      return result;
    }
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
      this.logger.error(
        `Error logging event from CDPService: ${error} at URL: ${this.launchConfig.logSinkUrl}`,
      );
    }
  }

  public async getAllPages() {
    return this.browserInstance?.pages() || [];
  }

  @traceable
  public async startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser> {
    this.currentSessionConfig = sessionConfig;
    this.trackedOrigins.clear(); // Clear tracked origins when starting a new session
    return this.launch(sessionConfig);
  }

  @traceable
  public async endSession(): Promise<void> {
    this.logger.info("Ending current session and resetting to default configuration.");
    const sessionConfig = this.currentSessionConfig!;

    await this.shutdown();
    await this.pluginManager.onSessionEnd(sessionConfig);
    this.currentSessionConfig = null;
    this.trackedOrigins.clear();
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
      const sessionConfig = this.currentSessionConfig!;
      await this.shutdown();
      await this.pluginManager.onSessionEnd(sessionConfig);
    }
  }

  @traceable
  private async injectSessionContext(
    page: Page,
    context?: BrowserLauncherOptions["sessionContext"],
  ) {
    if (!context) return;

    const storageByOrigin = groupSessionStorageByOrigin(context);

    for (const origin of storageByOrigin.keys()) {
      this.trackedOrigins.add(origin);
    }

    const client = await page.createCDPSession();
    try {
      if (context.cookies?.length) {
        await client.send("Network.setCookies", {
          cookies: context.cookies.map((cookie) => ({
            ...cookie,
            partitionKey: cookie.partitionKey as unknown as Protocol.Network.Cookie["partitionKey"],
          })),
        });
        this.logger.info(`[CDPService] Set ${context.cookies.length} cookies`);
      }
    } catch (error) {
      this.logger.error(`[CDPService] Error setting cookies: ${error}`);
    } finally {
      await client.detach().catch(() => {});
    }

    this.logger.info(
      `[CDPService] Registered frame navigation handler for ${storageByOrigin.size} origins`,
    );
    page.on("framenavigated", (frame) => handleFrameNavigated(frame, storageByOrigin, this.logger));

    page.browser().on("targetcreated", async (target) => {
      if (target.type() === "page") {
        try {
          const newPage = await target.page();
          if (newPage) {
            newPage.on("framenavigated", (frame) =>
              handleFrameNavigated(frame, storageByOrigin, this.logger),
            );
          }
        } catch (err) {
          this.logger.error(`[CDPService] Error adding framenavigated handler to new page: ${err}`);
        }
      }
    });

    this.logger.debug("[CDPService] Session context injection setup complete");
  }

  @traceable
  private async injectFingerprintSafely(
    page: Page,
    fingerprintData: BrowserFingerprintWithHeaders | null,
  ) {
    if (!fingerprintData) return;

    try {
      const { fingerprint, headers } = fingerprintData;
      // TypeScript fix - access userAgent through navigator property
      const userAgent = fingerprint.navigator.userAgent;
      const userAgentMetadata = fingerprint.navigator.userAgentData;
      const { screen } = fingerprint;

      await page.setUserAgent(userAgent);

      const session = await page.createCDPSession();

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

        await session.send("Emulation.clearDeviceMetricsOverride");

        await session.send("Emulation.setUserAgentOverride", {
          userAgent: userAgent,
          acceptLanguage: headers["accept-language"],
          platform: fingerprint.navigator.platform || "Linux x86_64",
          userAgentMetadata: {
            brands:
              userAgentMetadata.brands as unknown as Protocol.Emulation.UserAgentMetadata["brands"],
            fullVersionList:
              userAgentMetadata.fullVersionList as unknown as Protocol.Emulation.UserAgentMetadata["fullVersionList"],
            fullVersion: userAgentMetadata.uaFullVersion,
            platform: fingerprint.navigator.platform || "Linux x86_64",
            platformVersion: userAgentMetadata.platformVersion || "",
            architecture: userAgentMetadata.architecture || "x86",
            model: userAgentMetadata.model || "",
            mobile: userAgentMetadata.mobile as unknown as boolean,
            bitness: userAgentMetadata.bitness || "64",
            wow64: false, // wow64 property doesn't exist on UserAgentData, defaulting to false
          },
        });
      } finally {
        // Always detach the session when done
        await session.detach().catch(() => {});
      }

      await page.evaluateOnNewDocument(
        loadFingerprintScript({
          fixedPlatform: fingerprint.navigator.platform || "Linux x86_64",
          fixedVendor: (fingerprint.videoCard as VideoCard | null)?.vendor,
          fixedRenderer: (fingerprint.videoCard as VideoCard | null)?.renderer,
          fixedDeviceMemory: fingerprint.navigator.deviceMemory || 8,
          fixedHardwareConcurrency: fingerprint.navigator.hardwareConcurrency || 8,
          fixedArchitecture: userAgentMetadata.architecture || "x86",
          fixedBitness: userAgentMetadata.bitness || "64",
          fixedModel: userAgentMetadata.model || "",
          fixedPlatformVersion: userAgentMetadata.platformVersion || "15.0.0",
          fixedUaFullVersion: userAgentMetadata.uaFullVersion || "131.0.6778.86",
          fixedBrands: userAgentMetadata.brands as unknown as Array<{
            brand: string;
            version: string;
          }>,
        }),
      );
    } catch (error) {
      this.logger.error(`[Fingerprint] Error injecting fingerprint safely: ${error}`);
      const fingerprintInjector = new FingerprintInjector();
      // @ts-ignore - Ignore type mismatch between puppeteer versions
      await fingerprintInjector.attachFingerprintToPuppeteer(page, fingerprintData);
    }
  }

  @traceable
  private async setupUserPreferences(userDataDir: string, userPreferences: Record<string, any>) {
    try {
      const preferencesPath = getProfilePath(userDataDir, "Preferences");
      const defaultProfileDir = path.dirname(preferencesPath);

      await fs.promises.mkdir(defaultProfileDir, { recursive: true });

      let existingPreferences = {};

      try {
        const existingContent = await fs.promises.readFile(preferencesPath, "utf8");
        existingPreferences = JSON.parse(existingContent);
      } catch (error) {
        this.logger.debug(`[CDPService] No existing preferences found, creating new: ${error}`);
      }

      const mergedPreferences = deepMerge(existingPreferences, userPreferences);

      await fs.promises.writeFile(preferencesPath, JSON.stringify(mergedPreferences, null, 2));

      this.logger.info(`[CDPService] User preferences written to ${preferencesPath}`);
    } catch (error) {
      this.logger.error(`[CDPService] Error setting up user preferences: ${error}`);
      throw error;
    }
  }
}
