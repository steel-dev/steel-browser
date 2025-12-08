import { FastifyBaseLogger } from "fastify";
import { mkdir } from "fs/promises";
import os from "os";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { CredentialsOptions, SessionDetails } from "../modules/sessions/sessions.schema.js";
import { BrowserLauncherOptions, OptimizeBandwidthOptions } from "../types/index.js";
import { IProxyServer, ProxyServer } from "../utils/proxy.js";
import { getBaseUrl, getUrl } from "../utils/url.js";
import { BrowserRuntime } from "../types/browser-runtime.interface.js";
import { CookieData } from "./context/types.js";
import { FileService } from "./file.service.js";
import { SeleniumService } from "./selenium.service.js";
import { TimezoneFetcher } from "./timezone-fetcher.service.js";
import { deepMerge } from "../utils/context.js";

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
  private cdpService: BrowserRuntime;
  private seleniumService: SeleniumService;
  private fileService: FileService;
  private timezoneFetcher: TimezoneFetcher;
  public proxyFactory: ProxyFactory = (proxyUrl) => new ProxyServer(proxyUrl);

  public pastSessions: Session[] = [];
  public activeSession: Session;

  constructor(config: {
    cdpService: BrowserRuntime;
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
    };
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
    extra?: Record<string, Record<string, string>>;
    credentials: CredentialsOptions;
    skipFingerprintInjection?: boolean;
    userPreferences?: Record<string, any>;
    deviceConfig?: { device: "desktop" | "mobile" };
    headless?: boolean;
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
      headless,
    } = options;

    // start fetching timezone as early as possible
    let timezonePromise: Promise<string>;
    if (options.timezone) {
      timezonePromise = Promise.resolve(options.timezone);
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

    // If dimensions not provided, get from CDP service
    const finalDimensions = dimensions || this.cdpService.getDimensions();

    await this.resetSessionInfo({
      id: sessionId || uuidv4(),
      status: "live",
      proxy: proxyUrl,
      solveCaptcha: false,
      dimensions: finalDimensions,
      isSelenium,
    });

    const userDataDir =
      options.userDataDir || options.persist === true
        ? path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "user-data-dir")
        : env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "steel-chrome");
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
      dimensions,
      userDataDir,
      userPreferences: mergedUserPreferences,
      extra,
      credentials,
      skipFingerprintInjection,
      deviceConfig,
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
        dimensions: this.cdpService.getDimensions(),
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
        dimensions: this.cdpService.getDimensions(),
      });
    }

    return this.activeSession;
  }

  public async endSession(): Promise<SessionDetails> {
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

  public setProxyFactory(factory: ProxyFactory) {
    this.proxyFactory = factory;
  }
}
