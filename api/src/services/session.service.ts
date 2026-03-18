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
import { getBaseUrl, getUrl, getSessionUrl } from "../utils/url.js";
import { CDPService } from "./cdp/cdp.service.js";
import { BrowserPool, PoolSlot } from "./browser-pool.service.js";
import { CookieData } from "./context/types.js";
import { FileService } from "./file.service.js";
import { SeleniumService } from "./selenium.service.js";
import { TimezoneFetcher } from "./timezone-fetcher.service.js";
import { deepMerge } from "../utils/context.js";

export type Session = SessionDetails & {
  completion: Promise<void>;
  complete: (value: void) => void;
  proxyServer: IProxyServer | undefined;
  cdpService: CDPService;
};

const sessionStats = {
  duration: 0,
  eventCount: 0,
  timeout: 0,
  creditsUsed: 0,
  proxyTxBytes: 0,
  proxyRxBytes: 0,
};

export type ProxyFactory = (proxyUrl: string) => Promise<IProxyServer> | IProxyServer;

export class SessionService {
  private logger: FastifyBaseLogger;
  private browserPool: BrowserPool;
  private seleniumService: SeleniumService;
  private fileService: FileService;
  private timezoneFetcher: TimezoneFetcher;
  public proxyFactory: ProxyFactory = (proxyUrl) => new ProxyServer(proxyUrl);

  private sessions = new Map<string, Session>();

  constructor(config: {
    browserPool: BrowserPool;
    seleniumService: SeleniumService;
    fileService: FileService;
    logger: FastifyBaseLogger;
  }) {
    this.browserPool = config.browserPool;
    this.seleniumService = config.seleniumService;
    this.fileService = config.fileService;
    this.logger = config.logger;
    this.timezoneFetcher = new TimezoneFetcher(config.logger);
  }

  public getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  public listSessions(): Session[] {
    return Array.from(this.sessions.values());
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
    dangerouslyLogRequestDetails?: boolean;
  }): Promise<SessionDetails> {
    const {
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
      dangerouslyLogRequestDetails,
    } = options;

    const sessionId = options.sessionId || uuidv4();

    const slot = this.browserPool.acquire(sessionId);
    if (!slot) {
      throw new Error(
        `Session pool is full (max ${this.browserPool.maxSessions} sessions). Release an existing session and retry.`,
      );
    }

    const cdpService = slot.cdpService;

    let timezonePromise: Promise<string>;
    if (options.timezone) {
      timezonePromise = Promise.resolve(options.timezone);
    } else {
      timezonePromise = this.timezoneFetcher.getTimezone(
        proxyUrl,
        env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    }

    const finalDimensions = dimensions || { width: 1920, height: 1080 };

    const { promise, resolve } = Promise.withResolvers<void>();
    const session: Session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      status: "live",
      websocketUrl: getSessionUrl(sessionId, "cdp", "ws"),
      debugUrl: getSessionUrl(sessionId, "debug"),
      debuggerUrl: getUrl("v1/devtools/inspector.html"),
      sessionViewerUrl: getBaseUrl(),
      dimensions: finalDimensions,
      userAgent: "",
      isSelenium: !!isSelenium,
      proxy: proxyUrl || "",
      solveCaptcha: false,
      ...sessionStats,
      completion: promise,
      complete: resolve,
      proxyServer: undefined,
      cdpService,
    };

    this.sessions.set(sessionId, session);

    const userDataDir =
      options.userDataDir || options.persist === true
        ? path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "user-data-dir")
        : env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), `steel-chrome-${sessionId}`);
    await mkdir(userDataDir, { recursive: true });

    if (proxyUrl) {
      session.proxyServer = await this.proxyFactory(proxyUrl);
      await session.proxyServer.listen();
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
        proxyUrl: session.proxyServer?.url,
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
      dangerouslyLogRequestDetails,
    };

    if (isSelenium) {
      await cdpService.shutdown();
      await this.seleniumService.launch(browserLauncherOptions);

      Object.assign(session, {
        websocketUrl: "",
        debugUrl: "",
        sessionViewerUrl: "",
        userAgent:
          userAgent ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      });
    } else {
      await cdpService.startNewSession(browserLauncherOptions);

      Object.assign(session, {
        userAgent:
          cdpService.getUserAgent() ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        dimensions: cdpService.getDimensions(),
      });
    }

    return session;
  }

  public async endSession(sessionId: string): Promise<SessionDetails> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.complete();
    session.status = "released";
    session.duration = Date.now() - new Date(session.createdAt).getTime();

    if (session.proxyServer) {
      session.proxyTxBytes = session.proxyServer.txBytes;
      session.proxyRxBytes = session.proxyServer.rxBytes;
      await session.proxyServer.close(true);
      session.proxyServer = undefined;
    }

    if (session.isSelenium) {
      this.seleniumService.close();
    }

    await session.cdpService.shutdown();

    this.sessions.delete(sessionId);
    this.browserPool.release(sessionId);

    return session;
  }

  public setProxyFactory(factory: ProxyFactory) {
    this.proxyFactory = factory;
  }
}
