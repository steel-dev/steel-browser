import { FastifyBaseLogger } from "fastify";
import { CDPService } from "./cdp.service";
import { SeleniumService } from "./selenium.service";
import { SessionDetails } from "../modules/sessions/sessions.schema";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";
import { BrowserLauncherOptions } from "../types";
import { ProxyServer } from "../utils/proxy";

type Session = SessionDetails & {
  completion: Promise<void>,
  complete: (value: void) => void,
  proxyServer: ProxyServer | undefined,
};

const sessionStats = {
  duration: 0,
  eventCount: 0,
  timeout: 0,
  creditsUsed: 0,
  proxyTxBytes: 0,
  proxyRxBytes: 0,
};

const constructedUrl = process.env.PORT
  ? `${env.DOMAIN ?? env.HOST}:${env.PORT}`
  : `${env.DOMAIN ?? env.HOST}`;

const defaultSession = {
  status: "pending" as SessionDetails["status"],
  websocketUrl: `ws://${constructedUrl}/`,
  debugUrl: `http://${constructedUrl}/v1/devtools/inspector.html`,
  sessionViewerUrl: `http://${constructedUrl}`,
  userAgent: "",
  isSelenium: false,
  proxy: "",
  solveCaptcha: false,
};

export class SessionService {
  private logger: FastifyBaseLogger;
  private cdpService: CDPService;
  private seleniumService: SeleniumService;
  public activeSession: Session;

  constructor(config: { cdpService: CDPService; seleniumService: SeleniumService; logger: FastifyBaseLogger }) {
    this.cdpService = config.cdpService;
    this.seleniumService = config.seleniumService;
    this.logger = config.logger;
    this.activeSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...defaultSession,
      ...sessionStats,
      completion: Promise.resolve(),
      complete: () => {},
      proxyServer: undefined,
    }
  }

  public async startSession(options: {
    sessionId?: string;
    proxyUrl?: string;
    userAgent?: string;
    sessionContext?: Record<string, any>;
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

    this.resetSessionInfo({
      id: sessionId || uuidv4(),
      status: "live",
      proxy: proxyUrl,
      solveCaptcha: false,
      isSelenium,
    });

    if (proxyUrl) {
      this.activeSession.proxyServer = new ProxyServer(proxyUrl);
      this.activeSession.proxyServer.on('connectionClosed', ({ stats }) => {
        if (stats) {
          this.activeSession.proxyTxBytes += stats.trgTxBytes;
          this.activeSession.proxyRxBytes += stats.trgRxBytes;
        }
      });
      await this.activeSession.proxyServer.listen();
    }

    const browserLauncherOptions: BrowserLauncherOptions = {
      options: {
        headless: true,
        args: [userAgent ? `--user-agent=${userAgent}` : undefined].filter(Boolean) as string[],
        proxyUrl: this.activeSession.proxyServer?.url,
      },
      cookies: sessionContext?.cookies || [],
      userAgent: sessionContext?.userAgent,
      blockAds,
      extensions: extensions || [],
      logSinkUrl,
      timezone: timezone || "US/Pacific",
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
          sessionContext?.userAgent ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      });

      return this.activeSession;

    } else {

      await this.cdpService.startNewSession(browserLauncherOptions);
      return this.resetSessionInfo({
        ...this.activeSession,
        id: sessionId || uuidv4(),
        status: "live",
        websocketUrl: `ws://${constructedUrl}/`,
        debugUrl: `http://${constructedUrl}/v1/devtools/inspector.html`,
        sessionViewerUrl: `http://${constructedUrl}`,
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

    await this.activeSession.proxyServer?.close(true);
    this.activeSession.proxyServer = undefined;
    const releasedSession = this.activeSession;

    this.resetSessionInfo({
      id: uuidv4(),
      status: "pending",
    });

    return releasedSession;
  }

  private resetSessionInfo(overrides?: Partial<SessionDetails>): SessionDetails {
    this.activeSession.complete();

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
