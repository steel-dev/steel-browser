import { FastifyBaseLogger } from "fastify";
import { CDPService } from "./cdp.service";
import { SeleniumService } from "./selenium.service";
import { SessionDetails } from "../modules/sessions/sessions.schema";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";
import { BrowserLauncherOptions } from "../types";
import { ProxyServer } from "../utils/proxy";
import { CookieData } from "puppeteer-core";

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

    const releasedSessionId = this.activeSession.id;

    if (this.activeSession.isSelenium) {
      this.seleniumService.close();
    } else {
      await this.cdpService.endSession();
    }

    const releasedSession = this.activeSession;

    await this.cleanupSessionFiles(releasedSessionId);

    await this.resetSessionInfo({
      id: uuidv4(),
      status: "idle",
    });

    return releasedSession;
  }

  private async cleanupSessionFiles(sessionId: string): Promise<void> {
    try {
      const { fileStorage } = await import("../utils/file-storage");
      await fileStorage.deleteSessionDirectory(sessionId);
      this.logger.info(`Cleaned up files for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error cleaning up session files: ${error}`);
    }
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

  public async uploadFileToSession(
    content: Buffer,
    options: { fileName?: string; mimeType?: string; metadata?: Record<string, any> } = {},
  ): Promise<{ id: string; fileSize: number }> {
    const { fileStorage } = await import("../utils/file-storage");

    try {
      const { id, fileSize } = await fileStorage.saveFile(this.activeSession.id, content, {
        fileName: options.fileName,
        mimeType: options.mimeType,
        metadata: options.metadata,
      });

      this.logger.info(`File uploaded: ${id} (${fileSize} bytes)`);

      return {
        id,
        fileSize,
      };
    } catch (error) {
      this.logger.error(`Error uploading file: ${error}`);
      throw error;
    }
  }

  public async downloadFileFromSession(fileId: string): Promise<{
    buffer: Buffer;
    fileName: string;
    fileSize: number;
    mimeType: string;
    metadata?: Record<string, any>;
  }> {
    const { fileStorage } = await import("../utils/file-storage");

    try {
      const { buffer, fileName, fileSize, mimeType, metadata } = await fileStorage.getFile(
        this.activeSession.id,
        fileId,
      );

      this.logger.info(`File downloaded: ${fileId} (${fileSize} bytes)`);

      return {
        buffer,
        fileName,
        fileSize,
        mimeType,
        metadata,
      };
    } catch (error) {
      this.logger.error(`Error downloading file: ${error}`);
      throw error;
    }
  }

  public async listSessionFiles(): Promise<{
    items: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      createdAt: Date;
      updatedAt: Date;
      metadata?: Record<string, any>;
    }>;
    count: number;
  }> {
    const { fileStorage } = await import("../utils/file-storage");

    try {
      console.log(`Listing files in session: ${this.activeSession.id}`);
      const { items, count } = await fileStorage.listFiles(this.activeSession.id);
      console.log(items);
      return { items, count };
    } catch (error) {
      this.logger.error(`Error listing files: ${error}`);
      throw error;
    }
  }

  public async deleteSessionFile(fileId: string): Promise<{ success: boolean }> {
    const { fileStorage } = await import("../utils/file-storage");

    try {
      const { success } = await fileStorage.deleteFile(this.activeSession.id, fileId);

      this.logger.info(`File deleted: ${fileId}`);

      return { success };
    } catch (error) {
      this.logger.error(`Error deleting file: ${error}`);
      throw error;
    }
  }
  public async deleteAllSessionFiles(): Promise<{ success: boolean }> {
    const { fileStorage } = await import("../utils/file-storage");

    try {
      const { success } = await fileStorage.deleteSessionDirectory(this.activeSession.id);

      this.logger.info(`All files deleted`);

      return { success };
    } catch (error) {
      this.logger.error(`Error deleting all files: ${error}`);
      throw error;
    }
  }
}
