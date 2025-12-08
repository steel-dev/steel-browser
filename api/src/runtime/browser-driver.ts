import { FastifyBaseLogger } from "fastify";
import puppeteer, { Browser, Page, Target, TargetType } from "puppeteer-core";
import { EventEmitter } from "events";
import { BrowserLauncherOptions } from "../types/browser.js";
import { RuntimeEvent } from "./types.js";
import { getChromeExecutablePath } from "../utils/browser.js";
import { env } from "../env.js";
import os from "os";
import path from "path";

export interface BrowserDriverConfig {
  logger: FastifyBaseLogger;
}

export class BrowserDriver extends EventEmitter {
  private logger: FastifyBaseLogger;
  private browser: Browser | null;
  private primaryPage: Page | null;

  constructor(config: BrowserDriverConfig) {
    super();
    this.logger = config.logger.child({ component: "BrowserDriver" });
    this.browser = null;
    this.primaryPage = null;
  }

  public async launch(
    config: BrowserLauncherOptions,
  ): Promise<{ browser: Browser; primaryPage: Page }> {
    const chromeExecPath = getChromeExecutablePath();
    const isHeadless = !!config.options?.headless;

    const userDataDir = config.userDataDir || path.join(os.tmpdir(), "steel-chrome");
    const dimensions = config.dimensions || { width: 1920, height: 1080 };
    const timezone = await (config.timezone ||
      Promise.resolve(env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone));

    const staticDefaultArgs = [
      "--remote-allow-origins=*",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=PermissionPromptSurvey,IsolateOrigins,site-per-process,TouchpadAndWheelScrollLatching,TrackingProtection3pcd",
      "--enable-features=Clipboard",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-translate",
      "--no-first-run",
      "--disable-search-engine-choice-screen",
      "--disable-blink-features=AutomationControlled",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy",
      "--disable-touch-editing",
      "--disable-touch-drag-drop",
      "--disable-renderer-backgrounding",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-component-update",
      "--no-zygote",
      "--disable-infobars",
      "--disable-breakpad",
      "--disable-background-networking",
    ];

    const headfulArgs = [
      "--ozone-platform=x11",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--use-gl=swiftshader",
      "--in-process-gpu",
      "--enable-crashpad",
      "--crash-dumps-dir=/tmp/chrome-dumps",
    ];

    const headlessArgs = ["--headless=new", "--hide-crash-restore-bubble"];

    const dynamicArgs = [
      config.dimensions ? "" : "--start-maximized",
      `--remote-debugging-address=${env.HOST}`,
      "--remote-debugging-port=9222",
      `--unsafely-treat-insecure-origin-as-secure=http://localhost:3000,http://${env.HOST}:${env.PORT}`,
      `--window-size=${dimensions.width},${dimensions.height}`,
      `--timezone=${timezone}`,
      config.userAgent ? `--user-agent=${config.userAgent}` : "",
      config.options.proxyUrl ? `--proxy-server=${config.options.proxyUrl}` : "",
    ];

    const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

    const launchArgs = uniq([
      ...staticDefaultArgs,
      ...(isHeadless ? headlessArgs : headfulArgs),
      ...dynamicArgs,
      ...(config.options.args || []),
      ...(env.CHROME_ARGS || []),
    ]).filter((arg) => !env.FILTER_CHROME_ARGS.includes(arg));

    const launchOptions = {
      ...config.options,
      defaultViewport: null,
      args: launchArgs,
      executablePath: chromeExecPath,
      ignoreDefaultArgs: ["--enable-automation"],
      timeout: 0,
      env: {
        TZ: timezone,
        ...(isHeadless ? {} : { DISPLAY: env.DISPLAY }),
      },
      userDataDir,
      dumpio: env.DEBUG_CHROME_PROCESS,
    };

    this.logger.info("[BrowserDriver] Launching browser with options:");
    this.logger.debug(JSON.stringify(launchOptions, null, 2));

    try {
      this.browser = await puppeteer.launch(launchOptions);
      const pages = await this.browser.pages();
      this.primaryPage = pages[0];

      this.attachBrowserListeners();

      return { browser: this.browser, primaryPage: this.primaryPage };
    } catch (error) {
      this.logger.error({ err: error }, "[BrowserDriver] Failed to launch browser");
      throw error;
    }
  }

  private attachBrowserListeners(): void {
    if (!this.browser) return;

    this.browser.on("disconnected", () => {
      this.logger.info("[BrowserDriver] Browser disconnected");
      this.emitEvent({
        type: "disconnected",
        timestamp: Date.now(),
      });
    });

    this.browser.on("targetcreated", async (target: Target) => {
      this.logger.debug(`[BrowserDriver] Target created: ${target.type()} ${target.url()}`);
      this.emitEvent({
        type: "targetCreated",
        data: { target },
        timestamp: Date.now(),
      });

      // Attach file protocol detection for pages
      if (target.type() === "page") {
        try {
          const page = await target.page();
          if (page) {
            await this.attachFileProtocolDetection(page);
          }
        } catch (error) {
          this.logger.error(
            { err: error },
            "[BrowserDriver] Failed to attach file protocol detection",
          );
        }
      }
    });

    this.browser.on("targetchanged", (target: Target) => {
      this.logger.debug(`[BrowserDriver] Target changed: ${target.type()} ${target.url()}`);
      this.emitEvent({
        type: "targetChanged",
        data: { target },
        timestamp: Date.now(),
      });
    });

    this.browser.on("targetdestroyed", (target: Target) => {
      const targetId = (target as any)._targetId;
      this.logger.debug(`[BrowserDriver] Target destroyed: ${targetId}`);
      this.emitEvent({
        type: "targetDestroyed",
        data: { targetId },
        timestamp: Date.now(),
      });
    });
  }

  private async attachFileProtocolDetection(page: Page): Promise<void> {
    try {
      await page.setRequestInterception(true);

      page.on("request", (request) => {
        const url = request.url();
        if (url.startsWith("file://")) {
          this.logger.error(`[BrowserDriver] Blocked request to file protocol: ${url}`);
          this.emitFileProtocolViolation(url);
          page.close().catch(() => {});
          request.abort().catch(() => {});
        } else {
          request.continue().catch(() => {});
        }
      });

      page.on("response", (response) => {
        const url = response.url();
        if (url.startsWith("file://")) {
          this.logger.error(`[BrowserDriver] Blocked response from file protocol: ${url}`);
          this.emitFileProtocolViolation(url);
          page.close().catch(() => {});
        }
      });
    } catch (error) {
      this.logger.error({ err: error }, "[BrowserDriver] Failed to set up file protocol detection");
    }
  }

  public emitFileProtocolViolation(url: string): void {
    this.emitEvent({
      type: "fileProtocolViolation",
      data: { url },
      timestamp: Date.now(),
    });
  }

  private emitEvent(event: RuntimeEvent): void {
    this.emit("event", event);
  }

  public getBrowser(): Browser | null {
    return this.browser;
  }

  public getPrimaryPage(): Page | null {
    return this.primaryPage;
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      await this.browser.process()?.kill();
      this.browser = null;
      this.primaryPage = null;
    }
  }
}
