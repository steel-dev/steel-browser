import type { FastifyBaseLogger } from "fastify";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env.js";
import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import type { CredentialsOptions, SessionDetails } from "../modules/sessions/sessions.schema.js";
import type {
  BrowserLaunchExtra,
  BrowserLauncherOptions,
  OptimizeBandwidthOptions,
} from "../types/index.js";
import { getSessionUrl } from "../utils/url.js";
import { deepMerge } from "../utils/context.js";
import type { BrowserPool, BrowserSlot } from "./browser-pool.service.js";
import { ShutdownReason } from "./cdp/plugins/core/base-plugin.js";
import type { CookieData } from "./context/types.js";
import { FileService } from "./file.service.js";
import { TimezoneFetcher } from "./timezone-fetcher.service.js";
import { ProxyServer, type IProxyServer } from "../utils/proxy.js";

export type Session = SessionDetails & {
  completion: Promise<void>;
  complete: () => void;
  proxyServer?: IProxyServer;
  cdpService: BrowserSlot["cdpService"];
  seleniumService: BrowserSlot["seleniumService"];
  starting: boolean;
  releasePromise?: Promise<SessionDetails>;
  slot: BrowserSlot;
  userDataDir?: string;
  cleanupUserDataDir?: boolean;
};

export type ProxyFactory = (
  proxyUrl: string,
  options?: OptimizeBandwidthOptions,
) => Promise<IProxyServer> | IProxyServer;

export class SessionServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SessionServiceError";
  }
}

const sessionStats = {
  eventCount: 0,
  timeout: 0,
  creditsUsed: 0,
  proxyTxBytes: 0,
  proxyRxBytes: 0,
};

export class SessionService {
  private readonly logger: FastifyBaseLogger;
  private readonly browserPool: BrowserPool;
  private readonly timezoneFetcher: TimezoneFetcher;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionStartHooks = new Set<(session: Session) => void | Promise<void>>();
  private readonly sessionEndHooks = new Set<(sessionId: string) => void | Promise<void>>();
  private shuttingDown = false;
  public proxyFactory: ProxyFactory = (proxyUrl) => new ProxyServer(proxyUrl);

  constructor(config: { browserPool: BrowserPool; logger: FastifyBaseLogger }) {
    this.browserPool = config.browserPool;
    this.logger = config.logger;
    this.timezoneFetcher = new TimezoneFetcher(config.logger);
    this.browserPool.registerSessionEndedHook((sessionId) => {
      if (!sessionId || this.sessions.get(sessionId)?.status !== "live") return;
      void this.endSession(sessionId).catch((error) => {
        this.logger.error({ err: error, sessionId }, "Failed to release an ended browser session");
      });
    });
  }

  public addSessionStartHook(hook: (session: Session) => void | Promise<void>): void {
    this.sessionStartHooks.add(hook);
  }

  public addSessionEndHook(hook: (sessionId: string) => void | Promise<void>): void {
    this.sessionEndHooks.add(hook);
  }

  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  public getLiveSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    return session?.status === "live" ? session : undefined;
  }

  public getActiveSessions(): Session[] {
    return [...this.sessions.values()].filter(
      (session) =>
        session.status === "live" ||
        session.starting ||
        (!!session.releasePromise && session.slot.sessionId === session.id),
    );
  }

  public getOnlyActiveSession(): Session | null {
    const active = this.getActiveSessions();
    if (active.length > 1) {
      throw new SessionServiceError(
        "A session ID is required when multiple browser sessions are active.",
        409,
        "session_id_required",
      );
    }
    if (active[0]?.starting) {
      throw new SessionServiceError(
        `Session ${active[0].id} is still starting.`,
        409,
        "session_starting",
      );
    }
    if (active[0]?.releasePromise) {
      throw new SessionServiceError(
        `Session ${active[0].id} is still releasing.`,
        409,
        "session_releasing",
      );
    }
    const defaultSlotSessionId = this.browserPool.defaultSlot.sessionId;
    if (active.length === 0 && defaultSlotSessionId) {
      throw new SessionServiceError(
        `Session ${defaultSlotSessionId} is unavailable while its browser slot is being recovered.`,
        503,
        "session_slot_unavailable",
      );
    }
    return active[0] ?? null;
  }

  public listSessions(): SessionDetails[] {
    return [...this.sessions.values()].map((session) => this.toDetails(session));
  }

  public getSessionDetails(sessionId: string): SessionDetails | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.toDetails(session) : undefined;
  }

  public resolveLiveSession(sessionId: string): Session;
  public resolveLiveSession(): Session | null;
  public resolveLiveSession(sessionId?: string): Session | null {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new SessionServiceError(`Session ${sessionId} not found.`, 404, "session_not_found");
      }
      if (session.starting) {
        throw new SessionServiceError(
          `Session ${sessionId} is still starting.`,
          409,
          "session_starting",
        );
      }
      if (session.status !== "live") {
        throw new SessionServiceError(`Session ${sessionId} has ended.`, 410, "session_ended");
      }
      return session;
    }
    return this.getOnlyActiveSession();
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
    credentials?: CredentialsOptions;
    skipFingerprintInjection?: boolean;
    userPreferences?: Record<string, any>;
    deviceConfig?: { device: "desktop" | "mobile" };
    fullscreen?: boolean;
    headless?: boolean;
    dangerouslyLogRequestDetails?: boolean;
    captureWorkerNetwork?: boolean;
    caCertificates?: string[];
  }): Promise<SessionDetails> {
    const sessionId = options.sessionId ?? uuidv4();
    if (this.sessions.has(sessionId)) {
      throw new SessionServiceError(
        `Session ${sessionId} already exists.`,
        409,
        "session_id_conflict",
      );
    }

    const slot = this.browserPool.acquire(sessionId);
    if (!slot) {
      throw new SessionServiceError(
        `Session pool is full (maximum ${this.browserPool.maxSessions} sessions). Release an existing session and retry.`,
        503,
        "session_capacity_reached",
      );
    }

    const requestedDimensions = options.dimensions ?? slot.cdpService.getDimensions();
    const dimensions =
      options.deviceConfig?.device === "mobile"
        ? {
            width: Math.max(requestedDimensions.width, 508),
            height: Math.max(requestedDimensions.height, 1074),
          }
        : requestedDimensions;

    const { promise, resolve } = Promise.withResolvers<void>();
    const session: Session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      status: "idle",
      duration: 0,
      ...sessionStats,
      websocketUrl: options.isSelenium ? "" : getSessionUrl(sessionId, "cdp", "ws"),
      seleniumUrl: options.isSelenium ? getSessionUrl(sessionId, "selenium/wd") : undefined,
      debugUrl: options.isSelenium ? "" : getSessionUrl(sessionId, "debug"),
      debuggerUrl: options.isSelenium ? "" : getSessionUrl(sessionId, "devtools/inspector.html"),
      sessionViewerUrl: options.isSelenium ? "" : getSessionUrl(sessionId, "debug"),
      dimensions,
      userAgent: options.userAgent ?? "",
      isSelenium: options.isSelenium ?? false,
      proxy: options.proxyUrl ?? "",
      solveCaptcha: false,
      deviceConfig: options.deviceConfig,
      completion: promise,
      complete: resolve,
      cdpService: slot.cdpService,
      seleniumService: slot.seleniumService,
      starting: true,
      slot,
    };
    this.sessions.set(sessionId, session);

    try {
      for (const hook of this.sessionStartHooks) await hook(session);

      const userDataDir = this.getUserDataDir(options, sessionId);
      session.userDataDir = userDataDir;
      session.cleanupUserDataDir = !options.persist && !options.userDataDir;
      await mkdir(userDataDir, { recursive: true });

      const timezone = options.timezone
        ? Promise.resolve(options.timezone)
        : this.timezoneFetcher.getTimezone(
            options.proxyUrl,
            env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
          );

      let proxyServer: IProxyServer | undefined;
      if (options.proxyUrl) {
        const optimizeBandwidth = this.normalizeOptimizeBandwidth(options.optimizeBandwidth);
        proxyServer = await this.proxyFactory(options.proxyUrl, optimizeBandwidth);
        session.proxyServer = proxyServer;
        await proxyServer.listen();
      }

      const defaultUserPreferences = {
        plugins: {
          always_open_pdf_externally: true,
          plugins_disabled: ["Chrome PDF Viewer"],
        },
      };
      const userPreferences = options.userPreferences
        ? deepMerge(defaultUserPreferences, options.userPreferences)
        : defaultUserPreferences;
      const browserLauncherOptions: BrowserLauncherOptions = {
        sessionId,
        options: {
          headless: options.headless ?? env.CHROME_HEADLESS,
          proxyUrl: proxyServer?.url,
        },
        sessionContext: options.sessionContext,
        userAgent: options.userAgent,
        blockAds: options.blockAds,
        fingerprint: options.fingerprint,
        optimizeBandwidth: this.normalizeOptimizeBandwidth(options.optimizeBandwidth),
        extensions: options.extensions ?? [],
        logSinkUrl: options.logSinkUrl,
        timezone,
        dimensions,
        userDataDir,
        userPreferences,
        extra: options.extra,
        credentials: options.credentials ?? {},
        skipFingerprintInjection: options.skipFingerprintInjection,
        deviceConfig: options.deviceConfig,
        fullscreen: options.fullscreen,
        dangerouslyLogRequestDetails: options.dangerouslyLogRequestDetails,
        captureWorkerNetwork: options.captureWorkerNetwork,
        caCertificates: options.caCertificates,
      };

      if (options.isSelenium) {
        await slot.cdpService.shutdown(ShutdownReason.MODE_SWITCH);
        await slot.seleniumService.launch(browserLauncherOptions);
      } else {
        await slot.cdpService.startNewSession(browserLauncherOptions);
        session.userAgent =
          slot.cdpService.getUserAgent() ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
        session.dimensions = slot.cdpService.getDimensions();
      }

      session.status = "live";
      session.starting = false;
      return this.toDetails(session);
    } catch (error) {
      session.status = "failed";
      session.starting = false;
      session.complete();
      const browserCleanup = await Promise.allSettled([
        slot.seleniumService.close(),
        slot.cdpService.shutdown(ShutdownReason.LAUNCH_FAILURE),
      ]);
      for (const result of browserCleanup) {
        if (result.status === "rejected") {
          this.logger.error({ err: result.reason, sessionId }, "Browser startup cleanup failed");
        }
      }

      const browserStopped = !slot.seleniumService.isRunning() && !slot.cdpService.isRunning();
      if (browserStopped) {
        this.browserPool.release(sessionId);
      } else {
        this.logger.error(
          { sessionId },
          "Session startup cleanup left a browser process running; keeping its slot reserved",
        );
      }

      const cleanupTasks = [
        Promise.resolve().then(() => session.proxyServer?.close(true)),
        FileService.releaseSession(sessionId),
        ...[...this.sessionEndHooks].map((hook) => Promise.resolve().then(() => hook(sessionId))),
        ...(browserStopped ? [this.cleanupUserDataDir(session)] : []),
      ];
      session.proxyServer = undefined;
      const cleanupResults = await Promise.allSettled(cleanupTasks);
      for (const result of cleanupResults) {
        if (result.status === "rejected") {
          this.logger.error(
            { err: result.reason, sessionId },
            "Session startup resource cleanup failed",
          );
        }
      }
      throw error;
    }
  }

  public async endSession(sessionId?: string): Promise<SessionDetails> {
    let session: Session | undefined;
    if (sessionId) {
      session = this.sessions.get(sessionId);
      if (!session) {
        throw new SessionServiceError(`Session ${sessionId} not found.`, 404, "session_not_found");
      }
    } else {
      session = this.getOnlyActiveSession() ?? undefined;
      if (!session) {
        throw new SessionServiceError(
          "No active browser session to release.",
          404,
          "session_not_found",
        );
      }
    }

    if (session.status === "failed" && session.slot.sessionId !== session.id) {
      throw new SessionServiceError(
        `Session ${session.id} has already ended.`,
        410,
        "session_ended",
      );
    }
    if (session.releasePromise) return session.releasePromise;
    if (session.starting) {
      throw new SessionServiceError(
        `Session ${session.id} is still starting.`,
        409,
        "session_starting",
      );
    }
    if (session.status === "released") return this.toDetails(session);

    session.complete();
    session.status = "released";
    session.duration = Date.now() - Date.parse(session.createdAt);
    session.releasePromise = (async () => {
      try {
        let cdpCleanupError: unknown;
        if (session!.isSelenium) {
          const results = await Promise.allSettled([
            session!.seleniumService.close(),
            session!.cdpService.shutdown(ShutdownReason.SESSION_END),
          ]);
          const rejected = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          cdpCleanupError = rejected?.reason;
        } else {
          try {
            if (session!.cdpService.isRunning()) {
              await session!.cdpService.endSession(ShutdownReason.SESSION_END, {
                relaunchDefault: false,
              });
            } else {
              await session!.cdpService.shutdown(ShutdownReason.SESSION_END);
            }
          } catch (error) {
            cdpCleanupError = error;
            await session!.cdpService.shutdown(ShutdownReason.SESSION_END);
          }
          await session!.seleniumService.close();
        }

        if (session!.cdpService.isRunning() || session!.seleniumService.isRunning()) {
          throw (
            cdpCleanupError ?? new Error("Browser process is still running after session release")
          );
        }
        if (cdpCleanupError) {
          this.logger.warn(
            { err: cdpCleanupError, sessionId: session!.id },
            "Session browser cleanup reported an error after stopping its processes",
          );
        }

        // Preserve the legacy default CDP endpoint on slot 0. Extra slots stay
        // stopped after release instead of retaining one idle Chrome each.
        if (session!.slot.index === 0 && !this.shuttingDown) {
          try {
            await session!.cdpService.launch();
          } catch (error) {
            this.logger.error(
              { err: error },
              "Failed to restore the default browser after release",
            );
          }
        }

        this.browserPool.release(session!.id);
        if (session!.proxyServer) {
          try {
            await session!.proxyServer.close(true);
          } catch (error) {
            this.logger.error(
              { err: error, sessionId: session!.id },
              "Session proxy cleanup failed",
            );
          } finally {
            session!.proxyTxBytes = session!.proxyServer.txBytes;
            session!.proxyRxBytes = session!.proxyServer.rxBytes;
          }
          session!.proxyServer = undefined;
        }

        const cleanupTasks = [
          FileService.releaseSession(session!.id),
          ...[...this.sessionEndHooks].map((hook) =>
            Promise.resolve().then(() => hook(session!.id)),
          ),
          this.cleanupUserDataDir(session!),
        ];
        const cleanupResults = await Promise.allSettled(cleanupTasks);
        for (const result of cleanupResults) {
          if (result.status === "rejected") {
            this.logger.error(
              { err: result.reason, sessionId: session!.id },
              "Session cleanup failed",
            );
          }
        }
        return this.toDetails(session!);
      } catch (error) {
        session!.status = "failed";
        session!.releasePromise = undefined;
        this.logger.error({ err: error, sessionId: session!.id }, "Session release failed");
        throw error;
      }
    })();

    return session.releasePromise;
  }

  public async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    const active = this.getActiveSessions();
    await Promise.allSettled(active.map((session) => this.endSession(session.id)));
    await this.browserPool.shutdownAll();
    const cleanupResults = await Promise.allSettled(
      [...this.sessions.values()].map(async (session) => {
        await session.proxyServer?.close(true).catch((error) => {
          this.logger.error({ err: error, sessionId: session.id }, "Session proxy cleanup failed");
        });
        session.proxyServer = undefined;
        this.browserPool.release(session.id);
        await FileService.releaseSession(session.id);
        if (!session.cdpService.isRunning() && !session.seleniumService.isRunning()) {
          await this.cleanupUserDataDir(session);
        }
        for (const hook of this.sessionEndHooks) await hook(session.id);
      }),
    );
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        this.logger.error({ err: result.reason }, "Session shutdown cleanup failed");
      }
    }
  }

  public setProxyFactory(factory: ProxyFactory): void {
    this.proxyFactory = factory;
  }

  private getUserDataDir(options: { userDataDir?: string; persist?: boolean }, sessionId: string) {
    if (options.userDataDir) return options.userDataDir;
    const root = options.persist
      ? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "user-data-dir")
      : env.CHROME_USER_DATA_DIR || join(os.tmpdir(), "steel-chrome");
    return join(root, sessionId);
  }

  private async cleanupUserDataDir(session: Session): Promise<void> {
    if (session.cleanupUserDataDir && session.userDataDir) {
      await rm(session.userDataDir, { recursive: true, force: true });
      session.userDataDir = undefined;
    }
  }

  private normalizeOptimizeBandwidth(
    value: boolean | OptimizeBandwidthOptions | undefined,
  ): OptimizeBandwidthOptions | undefined {
    if (value === true) {
      return { blockImages: true, blockMedia: true, blockStylesheets: true };
    }
    return value && typeof value === "object" ? { ...value } : undefined;
  }

  private toDetails(session: Session): SessionDetails {
    return {
      id: session.id,
      createdAt: session.createdAt,
      status: session.status,
      duration:
        session.status === "live" || session.starting
          ? Date.now() - Date.parse(session.createdAt)
          : session.duration,
      eventCount: session.eventCount,
      timeout: session.timeout,
      creditsUsed: session.creditsUsed,
      websocketUrl: session.websocketUrl,
      seleniumUrl: session.seleniumUrl,
      debugUrl: session.debugUrl,
      debuggerUrl: session.debuggerUrl,
      sessionViewerUrl: session.sessionViewerUrl,
      userAgent: session.userAgent,
      dimensions: session.dimensions,
      proxy: session.proxy,
      proxyTxBytes: session.proxyTxBytes,
      proxyRxBytes: session.proxyRxBytes,
      solveCaptcha: session.solveCaptcha,
      isSelenium: session.isSelenium,
      deviceConfig: session.deviceConfig,
    };
  }
}
