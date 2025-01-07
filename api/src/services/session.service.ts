import { FastifyBaseLogger } from "fastify";
import { CDPService } from "./cdp.service";
import { SeleniumService } from "./selenium.service";
import { SessionDetails } from "../modules/sessions/sessions.schema";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";
import { BrowserLauncherOptions } from "../types";

const defaultSession = {
  status: "pending" as SessionDetails["status"],
  duration: 0,
  eventCount: 0,
  timeout: 0,
  creditsUsed: 0,
  websocketUrl: `ws://${env.DOMAIN ?? env.HOST}:${env.PORT}/`,
  debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
  sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}`,
  userAgent: "",
  isSelenium: false,
  proxy: "",
  solveCaptcha: false,
}

export class SessionService {
  private logger: FastifyBaseLogger;
  private cdpService: CDPService;
  private seleniumService: SeleniumService;
  public activeSession: SessionDetails;

  constructor(config: { cdpService: CDPService, seleniumService: SeleniumService, logger: FastifyBaseLogger }) {
    this.cdpService = config.cdpService;
    this.seleniumService = config.seleniumService;
    this.logger = config.logger;
    this.activeSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...defaultSession,
      completion: Promise.resolve(),
      complete: () => {},
    }
  }

  public resetSession(overrides?: Partial<SessionDetails>): SessionDetails {
    this.activeSession.complete();

    const { promise, resolve } = Promise.withResolvers<void>();
    this.activeSession = {
      createdAt: new Date().toISOString(),
      id: uuidv4(),
      ...defaultSession,
      ...overrides,
      completion: promise,
      complete: resolve,
    };

    return this.activeSession;
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

    const browserLauncherOptions: BrowserLauncherOptions = {
      options: {
        headless: true,
        args: [userAgent ? `--user-agent=${userAgent}` : undefined].filter(Boolean) as string[],
        proxyUrl,
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
      
      return this.resetSession({
        id: sessionId || uuidv4(),
        status: "live",
        websocketUrl: "",
        debugUrl: "",
        sessionViewerUrl: "",
        userAgent:
          sessionContext?.userAgent ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        proxy: proxyUrl,
        solveCaptcha: false,
        isSelenium,
      });
    } else {
      await this.cdpService.startNewSession(browserLauncherOptions);
      return this.resetSession({
        id: sessionId || uuidv4(),
        status: "live",
        websocketUrl: `ws://${env.DOMAIN ?? env.HOST}:${env.PORT}/`,
        debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
        sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}`,
        userAgent: this.cdpService.getUserAgent(),
        proxy: proxyUrl,
        solveCaptcha: false,
        isSelenium,
      });
    }
  }

  public async endSession(): Promise<void> {
    this.activeSession.complete();
    this.activeSession.status = "released";

    if (this.activeSession.isSelenium) {
      this.seleniumService.close();
    } else {
      await this.cdpService.endSession();
    }
  }   
}
