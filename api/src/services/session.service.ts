import { FastifyBaseLogger } from "fastify";
import { Protocol } from "puppeteer-core";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";
import { SessionDetails } from "../modules/sessions/sessions.schema";
import { BrowserLauncherOptions } from "../types";
import { ProxyServer } from "../utils/proxy";
import { CDPService } from "./cdp.service";
import { FileService } from "./file.service";
import { SeleniumService } from "./selenium.service";

type Session = SessionDetails & {
  completion: Promise<void>;
  complete: (value: void) => void;
  proxyServer: ProxyServer | undefined;
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
  websocketUrl: `ws://${env.DOMAIN ?? env.HOST}:${env.PORT}/`,
  debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/sessions/debug`,
  debuggerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
  sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}`,
  dimensions: { width: 1920, height: 1080 },
  userAgent: "",
  isSelenium: false,
  proxy: "",
  solveCaptcha: false,
};

export class SessionService {
  private logger: FastifyBaseLogger;
  private cdpService: CDPService;
  private seleniumService: SeleniumService;
  private fileService: FileService;
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
    this.activeSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...defaultSession,
      ...sessionStats,
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
      cookies?: Protocol.Network.Cookie[];
      localStorage?: Record<string, Record<string, any>>;
    };
    isSelenium?: boolean;
    logSinkUrl?: string;
    blockAds?: boolean;
    extensions?: string[];
    timezone?: string;
    dimensions?: { width: number; height: number };
  }): Promise<SessionDetails> {
    const {
      sessionId,
      proxyUrl,
      userAgent,
      sessionContext,
      extensions,
      logSinkUrl,
      timezone,
      dimensions,
      isSelenium,
      blockAds,
    } = options;

    await this.resetSessionInfo({
      id: sessionId || uuidv4(),
      status: "live",
      proxy: proxyUrl,
      solveCaptcha: false,
      dimensions,
      isSelenium,
    });

    if (proxyUrl) {
      this.activeSession.proxyServer = new ProxyServer(proxyUrl);
      this.activeSession.proxyServer.on("connectionClosed", ({ stats }) => {
        if (stats) {
          this.activeSession.proxyTxBytes += stats.trgTxBytes;
          this.activeSession.proxyRxBytes += stats.trgRxBytes;
        }
      });
      await this.activeSession.proxyServer.listen();
    }

    const browserLauncherOptions: BrowserLauncherOptions = {
      options: {
        headless: env.CHROME_HEADLESS,
        args: [userAgent ? `--user-agent=${userAgent}` : undefined].filter(Boolean) as string[],
        proxyUrl: this.activeSession.proxyServer?.url,
      },
      sessionContext,
      userAgent,
      blockAds,
      extensions: extensions || [],
      logSinkUrl,
      timezone,
      dimensions,
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
        websocketUrl: `ws://${env.DOMAIN ?? env.HOST}:${env.PORT}/`,
        debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/sessions/debug`,
        debuggerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
        sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}`,
        userAgent: this.cdpService.getUserAgent(),
      });
    }

    return this.activeSession;
  }

  public async endSession(): Promise<SessionDetails> {
    this.activeSession.complete();
    this.activeSession.status = "released";

    if (this.activeSession.isSelenium) {
      this.seleniumService.close();
    } else {
      await this.cdpService.endSession();
    }

    const releasedSession = this.activeSession;

    await this.fileService.cleanupFiles({ sessionId: this.activeSession.id });

    await this.resetSessionInfo({
      id: uuidv4(),
      status: "idle",
    });

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
      createdAt: new Date().toISOString(),
      completion: promise,
      complete: resolve,
      proxyServer: undefined,
    };

    return this.activeSession;
  }
}
