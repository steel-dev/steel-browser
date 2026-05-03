import { FastifyBaseLogger } from "fastify";
import { mkdir } from "fs/promises";
import os from "os";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { CredentialsOptions, SessionDetails } from "../modules/sessions/sessions.schema.js";
import {
  BrowserLaunchExtra,
  BrowserLauncherOptions,
  OptimizeBandwidthOptions,
} from "../types/index.js";
import { IProxyServer, ProxyServer } from "../utils/proxy.js";
import { getBaseUrl, getUrl } from "../utils/url.js";
import { CDPService } from "./cdp/cdp.service.js";
import { ShutdownReason } from "./cdp/plugins/core/base-plugin.js";
import { CookieData } from "./context/types.js";
import { FileService } from "./file.service.js";
import { SeleniumService } from "./selenium.service.js";
import { TimezoneFetcher } from "./timezone-fetcher.service.js";
import { deepMerge } from "../utils/context.js";

type Session = SessionDetails & {
  completion: Promise<void>;
  complete: (value: void) => void;
  proxyServer: IProxyServer | undefined;
  inactivityTimer?: NodeJS.Timeout;
  _lastActivityAtMs: number; // Internal tracking of last activity timestamp in milliseconds
};

const sessionStats = {
  duration: 0,
  eventCount: 0,
  timeout: 0,
  inactivityTimeout: 0,
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

export type ProxyFactory = (
  proxyUrl: string,
  options?: OptimizeBandwidthOptions,
) => Promise<IProxyServer> | IProxyServer;

export class SessionService {
  private logger: FastifyBaseLogger;
  private cdpService: CDPService;
  private seleniumService: SeleniumService;
  private fileService: FileService;
  private timezoneFetcher: TimezoneFetcher;
  public proxyFactory: ProxyFactory = (proxyUrl) => new ProxyServer(proxyUrl);

  public pastSessions: Session[] = [];
  public activeSession: Session;
  private inactivityCheckInterval?: NodeJS.Timeout;

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
    this.activeSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...defaultSession,
      ...sessionStats,
      userAgent: this.cdpService.getUserAgent() ?? "",
      dimensions: this.cdpService.getDimensions(),
      completion: Promise.resolve(),
      complete: () => {},
      proxyServer: undefined,
      _lastActivityAtMs: Date.now(),
    } as Session;
  }

  /**
   * Converts the internal Session object to SessionDetails schema format
   * @private
   */
  private getSessionDetails(session: Session): SessionDetails {
    const details: SessionDetails = {
      ...session,
      lastActivityAt: new Date(session._lastActivityAtMs).toISOString(),
    };
    // Remove internal properties from the response
    delete (details as any)._lastActivityAtMs;
    delete (details as any).completion;
    delete (details as any).complete;
    delete (details as any).proxyServer;
    delete (details as any).inactivityTimer;
    return details;
  }

  /**
   * Updates the last activity timestamp for the session and resets inactivity timer
   */
  public recordActivity(): void {
    this.activeSession._lastActivityAtMs = Date.now();
    if (this.activeSession.status === "live" && this.activeSession.inactivityTimeout > 0) {
      this.resetInactivityTimer();
    }
  }

  /**
   * Sets up the inactivity timer for the active session
   * @private
   */
  private resetInactivityTimer(): void {
    // Clear existing timer
    if (this.activeSession.inactivityTimer) {
      clearTimeout(this.activeSession.inactivityTimer);
    }

    const timeoutMs = this.activeSession.inactivityTimeout * 1000;
    this.activeSession.inactivityTimer = setTimeout(() => {
      this.logger.warn(
        {
          sessionId: this.activeSession.id,
          inactivityTimeout: this.activeSession.inactivityTimeout,
        },
        "Session terminated due to inactivity",
      );
      this.endSession().catch((err) => {
        this.logger.error(
          { err, sessionId: this.activeSession.id },
          "Failed to end session due to inactivity",
        );
      });
    }, timeoutMs);
  }

  /**
   * Clears the inactivity timer for the active session
   * @private
   */
  private clearInactivityTimer(): void {
    if (this.activeSession.inactivityTimer) {
      clearTimeout(this.activeSession.inactivityTimer);
      this.activeSession.inactivityTimer = undefined;
    }
  }

  /**
   * Starts the global inactivity check interval if enabled
   * @private
   */
  private startInactivityCheckInterval(): void {
    if (this.inactivityCheckInterval) {
      clearInterval(this.inactivityCheckInterval);
    }

    const checkInterval = env.SESSION_INACTIVITY_CHECK_INTERVAL;
    this.inactivityCheckInterval = setInterval(() => {
      if (this.activeSession.status === "live" && this.activeSession.inactivityTimeout > 0) {
        const lastActivityMs = Date.now() - this.activeSession._lastActivityAtMs;
        const timeoutMs = this.activeSession.inactivityTimeout * 1000;

        if (lastActivityMs >= timeoutMs) {
          this.logger.warn(
            {
              sessionId: this.activeSession.id,
              inactivityTimeout: this.activeSession.inactivityTimeout,
              inactiveFor: Math.floor(lastActivityMs / 1000),
            },
            "Session terminated due to inactivity",
          );
          this.endSession().catch((err) => {
            this.logger.error(
              { err, sessionId: this.activeSession.id },
              "Failed to end session due to inactivity",
            );
          });
        }
      }
    }, checkInterval);
  }

  /**
   * Stops the global inactivity check interval
   * @private
   */
  private stopInactivityCheckInterval(): void {
    if (this.inactivityCheckInterval) {
      clearInterval(this.inactivityCheckInterval);
      this.inactivityCheckInterval = undefined;
    }
  }

  public async startSession(options: {
    sessionId?: string;
    proxyUrl?: string;
    userAgent?: string;
    sessionContext?: {
      cookies?: CookieData[];
      localStorage?: Record<string, Record<string, any>>;
    };
    isSelenium?: boolean;
    fingerprint?: BrowserFingerprintWithHeaders;
    logSinkUrl?: string;
    userDataDir?: string;
    persist?: boolean;
    blockAds?: boolean;
    optimizeBandwidth?: boolean | OptimizeBandwidthOptions;
    extensions?: string[];
    timezone?: string;
    dimensions?: { width: number; height: number };
    extra?: BrowserLaunchExtra;
    credentials: CredentialsOptions;
    skipFingerprintInjection?: boolean;
    userPreferences?: Record<string, any>;
    deviceConfig?: { device: "desktop" | "mobile" };
    fullscreen?: boolean;
    headless?: boolean;
    dangerouslyLogRequestDetails?: boolean;
    inactivityTimeout?: number;
  }): Promise<SessionDetails> {
    const {
      sessionId,
      proxyUrl,
      userAgent,
      sessionContext,
      extensions,
      logSinkUrl,
      dimensions,
      fingerprint,
      isSelenium,
      blockAds,
      optimizeBandwidth,
      extra,
      credentials,
      skipFingerprintInjection,
      userPreferences,
      deviceConfig,
      fullscreen,
      headless,
      dangerouslyLogRequestDetails,
      inactivityTimeout,
    } = options;

    // start fetching timezone as early as possible
    let timezonePromise: Promise<string>;
    if (options.timezone) {
      timezonePromise = Promise.resolve(options.timezone);
    } else {
      timezonePromise = this.timezoneFetcher.getTimezone(
        proxyUrl,
        env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    }

    // If dimensions not provided, get from CDP service
    const MIN_MOBILE_WIDTH = 508;
    const MIN_MOBILE_HEIGHT = 1074;
    const isMobileDevice = deviceConfig?.device === "mobile";
    const resolvedDimensions = dimensions || this.cdpService.getDimensions();
    const finalDimensions =
      isMobileDevice && resolvedDimensions
        ? {
            width: Math.max(resolvedDimensions.width, MIN_MOBILE_WIDTH),
            height: Math.max(resolvedDimensions.height, MIN_MOBILE_HEIGHT),
          }
        : resolvedDimensions;

    // Determine the inactivity timeout for this session
    const finalInactivityTimeout =
      inactivityTimeout !== undefined ? inactivityTimeout : env.SESSION_INACTIVITY_TIMEOUT;

    await this.resetSessionInfo({
      id: sessionId || uuidv4(),
      status: "live",
      proxy: proxyUrl,
      solveCaptcha: false,
      dimensions: finalDimensions,
      isSelenium,
      deviceConfig,
      inactivityTimeout: finalInactivityTimeout,
    });

    // Start inactivity monitoring if timeout is enabled
    if (finalInactivityTimeout > 0) {
      this.startInactivityCheckInterval();
      this.resetInactivityTimer();
    }

    const userDataDir =
      options.userDataDir || options.persist === true
        ? path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "user-data-dir")
        : env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "steel-chrome");
    await mkdir(userDataDir, { recursive: true });

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

    if (proxyUrl) {
      this.activeSession.proxyServer = await this.proxyFactory(proxyUrl, normalizedOptimize);
      await this.activeSession.proxyServer.listen();
    }

    const browserLauncherOptions: BrowserLauncherOptions = {
      options: {
        headless: headless ?? env.CHROME_HEADLESS,
        proxyUrl: this.activeSession.proxyServer?.url,
      },
      sessionContext,
      userAgent,
      blockAds,
      fingerprint,
      optimizeBandwidth: normalizedOptimize,
      extensions: extensions || [],
      logSinkUrl,
      timezone: timezonePromise,
      dimensions: finalDimensions,
      userDataDir,
      userPreferences: mergedUserPreferences,
      extra,
      credentials,
      skipFingerprintInjection,
      deviceConfig,
      fullscreen,
      dangerouslyLogRequestDetails,
    };

    if (isSelenium) {
      await this.cdpService.shutdown(ShutdownReason.MODE_SWITCH);
      await this.seleniumService.launch(browserLauncherOptions);

      Object.assign(this.activeSession, {
        websocketUrl: "",
        debugUrl: "",
        sessionViewerUrl: "",
        userAgent:
          userAgent ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        dimensions: this.cdpService.getDimensions(),
        deviceConfig,
      });

      return this.getSessionDetails(this.activeSession);
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
        dimensions: this.cdpService.getDimensions(),
        deviceConfig,
      });
    }

    return this.getSessionDetails(this.activeSession);
  }

  public async endSession(): Promise<SessionDetails> {
    // Clear inactivity timers
    this.clearInactivityTimer();
    this.stopInactivityCheckInterval();

    this.activeSession.complete();
    this.activeSession.status = "released";
    this.activeSession.duration =
      new Date().getTime() - new Date(this.activeSession.createdAt).getTime();

    if (this.activeSession.proxyServer) {
      this.activeSession.proxyTxBytes = this.activeSession.proxyServer.txBytes;
      this.activeSession.proxyRxBytes = this.activeSession.proxyServer.rxBytes;
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

    return this.getSessionDetails(releasedSession);
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
      _lastActivityAtMs: Date.now(),
    } as Session;

    return this.getSessionDetails(this.activeSession);
  }

  public setProxyFactory(factory: ProxyFactory) {
    this.proxyFactory = factory;
  }
}
