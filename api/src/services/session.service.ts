import { FastifyBaseLogger } from "fastify";
import { mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env.js";
import { CredentialsOptions, SessionDetails } from "../modules/sessions/sessions.schema.js";
import { BrowserLauncherOptions, OptimizeBandwidthOptions } from "../types/index.js";
import { IProxyServer, ProxyServer } from "../utils/proxy.js";
import { getBaseUrl, getUrl } from "../utils/url.js";
import { CDPService } from "./cdp/cdp.service.js";
import { CookieData } from "./context/types.js";
import { FileService } from "./file.service.js";
import { SeleniumService } from "./selenium.service.js";
import { TimezoneFetcher } from "./timezone-fetcher.service.js";
import { deepMerge } from "../utils/context.js";
import { SessionPersistenceService, PersistedSessionData } from "./session-persistence.service.js";

type Session = SessionDetails & {
  completion: Promise<void>;
  complete: (value: void) => void;
  proxyServer: IProxyServer | undefined;
};

const sessionStats = {
  duration: 0,
  eventCount: 0,
  timeout: 0,
  creditsUsed: 0,
  proxyTxBytes: 0,
  proxyRxBytes: 0,
};

const defaultSession = {
  status: "idle" as SessionDetails["status"],
  websocketUrl: getBaseUrl("ws"),
  debugUrl: getUrl("v1/sessions/debug"),
  debuggerUrl: getUrl("v1/devtools/inspector.html"),
  sessionViewerUrl: getBaseUrl(),
  dimensions: { width: 1920, height: 1080 },
  userAgent: "",
  isSelenium: false,
  proxy: "",
  solveCaptcha: false,
};

export type ProxyFactory = (proxyUrl: string) => Promise<IProxyServer> | IProxyServer;

export class SessionService {
  private logger: FastifyBaseLogger;
  private cdpService: CDPService;
  private seleniumService: SeleniumService;
  private fileService: FileService;
  private timezoneFetcher: TimezoneFetcher;
  private persistenceService: SessionPersistenceService;
  public proxyFactory: ProxyFactory = (proxyUrl) => new ProxyServer(proxyUrl);

  public pastSessions: Session[] = [];
  public activeSession: Session;

  constructor(config: {
    cdpService: CDPService;
    seleniumService: SeleniumService;
    fileService: FileService;
    logger: FastifyBaseLogger;
  }) {
    this.cdpService = config.cdpService;
    this.seleniumService = config.seleniumService;
    this.fileService = config.fileService;
    this.logger = config.logger;
    this.timezoneFetcher = new TimezoneFetcher(config.logger);
    this.persistenceService = new SessionPersistenceService(config.logger);
    this.activeSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...defaultSession,
      ...sessionStats,
      userAgent: this.cdpService.getUserAgent() ?? "",
      completion: Promise.resolve(),
      complete: () => {},
      proxyServer: undefined,
    };
  }

  /**
   * Start a new browser session with the specified configuration
   * Loads persisted session data if userId is provided and session exists
   * @param options - Session configuration options
   * @returns Session details including websocket URLs and session metadata
   */
  public async startSession(options: {
    sessionId?: string;
    userId?: string;
    proxyUrl?: string;
    userAgent?: string;
    sessionContext?: {
      cookies?: CookieData[];
      localStorage?: Record<string, Record<string, string>>;
    };
    isSelenium?: boolean;
    logSinkUrl?: string;
    blockAds?: boolean;
    optimizeBandwidth?: boolean | OptimizeBandwidthOptions;
    extensions?: string[];
    timezone?: string;
    dimensions?: { width: number; height: number };
    extra?: Record<string, Record<string, string>>;
    credentials: CredentialsOptions;
    skipFingerprintInjection?: boolean;
    userPreferences?: Record<string, any>;
  }): Promise<SessionDetails> {
    const {
      sessionId,
      userId,
      proxyUrl,
      userAgent,
      sessionContext,
      extensions,
      logSinkUrl,
      dimensions,
      isSelenium,
      blockAds,
      optimizeBandwidth,
      extra,
      credentials,
      skipFingerprintInjection,
      userPreferences,
    } = options;

    // Load persisted session data if userId is provided
    let persistedData: PersistedSessionData | null = null;
    if (userId) {
      persistedData = await this.persistenceService.loadSession(userId);
      if (persistedData) {
        this.logger.info({ userId }, "Loaded persisted session data for user");
      }
    }

    // start fetching timezone as early as possible
    let timezonePromise: Promise<string>;
    if (options.timezone) {
      timezonePromise = Promise.resolve(options.timezone);
    } else if (persistedData?.timezone) {
      // Use persisted timezone if available
      timezonePromise = Promise.resolve(persistedData.timezone);
    } else if (proxyUrl) {
      timezonePromise = this.timezoneFetcher.getTimezone(
        proxyUrl,
        env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    } else {
      timezonePromise = Promise.resolve(
        env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    }

    await this.resetSessionInfo({
      id: sessionId || uuidv4(),
      status: "live",
      proxy: proxyUrl,
      solveCaptcha: false,
      dimensions,
      isSelenium,
      userId,
    });

    const userDataDir = env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "steel-chrome");
    await mkdir(userDataDir, { recursive: true });

    if (proxyUrl) {
      this.activeSession.proxyServer = await this.proxyFactory(proxyUrl);
      await this.activeSession.proxyServer.listen();
    }

    const defaultUserPreferences = {
      plugins: {
        always_open_pdf_externally: true,
        plugins_disabled: ["Chrome PDF Viewer"],
      },
    };

    const mergedUserPreferences = userPreferences
      ? deepMerge(defaultUserPreferences, userPreferences)
      : defaultUserPreferences;

    // Normalize optimizeBandwidth: true => enable all flags (except lists)
    const normalizeOptimizeBandwidth = (
      value: boolean | OptimizeBandwidthOptions | undefined,
    ): OptimizeBandwidthOptions | undefined => {
      if (value === true) {
        return { blockImages: true, blockMedia: true, blockStylesheets: true };
      }
      if (value && typeof value === "object") {
        return { ...value };
      }
      return undefined;
    };

    const normalizedOptimize = normalizeOptimizeBandwidth(optimizeBandwidth);

    // Merge persisted session context with provided context
    let mergedSessionContext = sessionContext;
    if (persistedData) {
      mergedSessionContext = {
        cookies: sessionContext?.cookies || persistedData.cookies || [],
        localStorage: deepMerge(
          persistedData.localStorage || {},
          sessionContext?.localStorage || {},
        ),
      };
    }

    // Use persisted user agent if available and not explicitly provided
    const effectiveUserAgent = userAgent || persistedData?.userAgent;

    const browserLauncherOptions: BrowserLauncherOptions = {
      options: {
        headless: env.CHROME_HEADLESS,
        proxyUrl: this.activeSession.proxyServer?.url,
      },
      sessionContext: mergedSessionContext,
      userAgent: effectiveUserAgent,
      blockAds,
      optimizeBandwidth: normalizedOptimize,
      extensions: extensions || [],
      logSinkUrl,
      timezone: timezonePromise,
      dimensions,
      userDataDir,
      userPreferences: mergedUserPreferences,
      extra,
      credentials,
      skipFingerprintInjection,
    };

    if (isSelenium) {
      await this.cdpService.shutdown();
      await this.seleniumService.launch(browserLauncherOptions);

      Object.assign(this.activeSession, {
        websocketUrl: "",
        debugUrl: "",
        sessionViewerUrl: "",
        userAgent:
          userAgent ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      });

      return this.activeSession;
    } else {
      await this.cdpService.startNewSession(browserLauncherOptions);

      Object.assign(this.activeSession, {
        websocketUrl: getBaseUrl("ws"),
        debugUrl: getUrl("v1/sessions/debug"),
        debuggerUrl: getUrl("v1/devtools/inspector.html"),
        sessionViewerUrl: getBaseUrl(),
        userAgent:
          this.cdpService.getUserAgent() ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      });
    }

    // Store timezone in activeSession for later persistence
    try {
      this.activeSession.timezone = await timezonePromise;
    } catch (error) {
      this.logger.error({ error }, "Failed to resolve timezone, using fallback");
      // Fallback to persisted timezone if available
      this.activeSession.timezone = persistedData?.timezone;
    }

    return this.activeSession;
  }

  /**
   * End the current browser session and persist session data if userId is present
   * Automatically saves cookies, localStorage, sessionStorage, userAgent, and timezone to Redis
   * @returns Session details including duration and final statistics
   */
  public async endSession(): Promise<SessionDetails> {
    this.activeSession.complete();
    this.activeSession.status = "released";
    this.activeSession.duration =
      new Date().getTime() - new Date(this.activeSession.createdAt).getTime();

    if (this.activeSession.proxyServer) {
      this.activeSession.proxyTxBytes = this.activeSession.proxyServer.txBytes;
      this.activeSession.proxyRxBytes = this.activeSession.proxyServer.rxBytes;
    }

    // Save session data before ending if userId is present
    if (this.activeSession.userId) {
      try {
        // Wait for any pending operations to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
        const browserState = await this.cdpService.getBrowserState();
        const sessionData = {
          cookies: browserState.cookies || [],
          localStorage: browserState.localStorage || {},
          sessionStorage: browserState.sessionStorage || {},
          userAgent: this.activeSession.userAgent,
          timezone: this.activeSession.timezone,
        };

        await this.persistenceService.saveSession(this.activeSession.userId, sessionData);
        this.logger.info({ userId: this.activeSession.userId }, "Saved session data for user");
      } catch (error) {
        this.logger.error(
          { error, userId: this.activeSession.userId },
          "Failed to save session data",
        );
      }
    }

    if (this.activeSession.isSelenium) {
      this.seleniumService.close();
      await this.cdpService.launch();
    } else {
      await this.cdpService.endSession();
    }

    const releasedSession = this.activeSession;

    await this.resetSessionInfo({
      id: uuidv4(),
      status: "idle",
    });

    this.pastSessions.push(releasedSession);

    return releasedSession;
  }

  private async resetSessionInfo(overrides?: Partial<SessionDetails>): Promise<SessionDetails> {
    this.activeSession.complete();

    await this.activeSession.proxyServer?.close(true);
    this.activeSession.proxyServer = undefined;

    const { promise, resolve } = Promise.withResolvers<void>();
    this.activeSession = {
      id: uuidv4(),
      ...defaultSession,
      ...overrides,
      ...sessionStats,
      userAgent: this.cdpService.getUserAgent() ?? "",
      createdAt: new Date().toISOString(),
      completion: promise,
      complete: resolve,
      proxyServer: undefined,
    };

    return this.activeSession;
  }

  /**
   * Set a custom proxy factory for creating proxy servers
   * @param factory - Factory function that creates IProxyServer instances
   */
  public setProxyFactory(factory: ProxyFactory) {
    this.proxyFactory = factory;
  }

  /**
   * Initialize the Redis-based session persistence service
   * Should be called during application startup
   */
  public async initializePersistence(): Promise<void> {
    await this.persistenceService.connect();
  }

  /**
   * Shutdown the Redis-based session persistence service
   * Should be called during application shutdown
   */
  public async shutdownPersistence(): Promise<void> {
    await this.persistenceService.disconnect();
  }
}
