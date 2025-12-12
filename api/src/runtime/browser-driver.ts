import { FastifyBaseLogger } from "fastify";
import puppeteer, { Browser, Page, Target, TargetType } from "puppeteer-core";
import { EventEmitter } from "events";
import { BrowserLauncherOptions } from "../types/browser.js";
import { RuntimeEvent } from "./types.js";
import { getChromeExecutablePath, installMouseHelper } from "../utils/browser.js";
import { env } from "../env.js";
import os from "os";
import path from "path";
import fs from "fs";
import { validateTimezone } from "../services/cdp/utils/validation.js";
import { getExtensionPaths } from "../utils/extensions.js";
import { deepMerge, getProfilePath } from "../utils/context.js";

export interface BrowserDriverConfig {
  logger: FastifyBaseLogger;
}

type TargetListener = (target: Target) => void;
type TargetAsyncListener = (target: Target) => Promise<void>;
type DisconnectedListener = () => void;

type AnyListener = DisconnectedListener | TargetListener | TargetAsyncListener;

type BrowserEventOff = (event: string, listener: (...args: any[]) => any) => void;

interface BrowserListenerHost {
  off?: BrowserEventOff;
  removeListener?: BrowserEventOff;
}

export class BrowserDriver extends EventEmitter {
  private logger: FastifyBaseLogger;
  private browser: Browser | null;
  private primaryPage: Page | null;
  private onDisconnectedListener: (() => void) | null;
  private onTargetCreatedListener: TargetAsyncListener | null;
  private onTargetChangedListener: TargetListener | null;
  private onTargetDestroyedListener: TargetListener | null;

  constructor(config: BrowserDriverConfig) {
    super();
    this.logger = config.logger.child({ component: "BrowserDriver" });
    this.browser = null;
    this.primaryPage = null;
    this.onDisconnectedListener = null;
    this.onTargetCreatedListener = null;
    this.onTargetChangedListener = null;
    this.onTargetDestroyedListener = null;
  }

  public async launch(
    config: BrowserLauncherOptions,
  ): Promise<{ browser: Browser; primaryPage: Page }> {
    const chromeExecPath = getChromeExecutablePath();
    const isHeadless = !!config.options?.headless;

    const userDataDir = config.userDataDir || path.join(os.tmpdir(), "steel-chrome");
    const dimensions = config.dimensions || { width: 1920, height: 1080 };

    // Validate and resolve timezone
    let timezone = env.DEFAULT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (config.timezone) {
      try {
        if (config.skipFingerprintInjection) {
          this.logger.info(
            "[BrowserDriver] Skipping timezone validation as skipFingerprintInjection is enabled",
          );
        } else {
          timezone = await validateTimezone(this.logger, config.timezone);
          this.logger.info(`[BrowserDriver] Resolved and validated timezone: ${timezone}`);
        }
      } catch (error) {
        this.logger.warn(`[BrowserDriver] Timezone validation failed, using fallback: ${error}`);
      }
    }

    // Resolve extension paths
    const defaultExtensions = isHeadless ? ["recorder"] : [];
    const customExtensions = config.extensions ? [...config.extensions] : [];
    const allExtensions = [...defaultExtensions, ...customExtensions];
    const extensionPaths = await getExtensionPaths(allExtensions);

    const extensionArgs = extensionPaths.length
      ? [
          `--load-extension=${extensionPaths.join(",")}`,
          `--disable-extensions-except=${extensionPaths.join(",")}`,
        ]
      : [];

    // Setup user preferences if provided
    if (userDataDir && config.userPreferences) {
      this.logger.info(`[BrowserDriver] Setting up user preferences in ${userDataDir}`);
      try {
        await this.setupUserPreferences(userDataDir, config.userPreferences);
      } catch (error) {
        this.logger.warn(`[BrowserDriver] Failed to set up user preferences: ${error}`);
      }
    }

    const shouldDisableSandbox = typeof process.getuid === "function" && process.getuid() === 0;

    const staticDefaultArgs = [
      "--remote-allow-origins=*",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees,LinuxNonClientFrame,PermissionPromptSurvey,IsolateOrigins,site-per-process,TouchpadAndWheelScrollLatching,TrackingProtection3pcd,InterestFeedContentSuggestions,PrivacySandboxSettings4,AutofillServerCommunication,OptimizationHints,MediaRouter,DialMediaRouteProvider,CertificateTransparencyComponentUpdater,GlobalMediaControls,AudioServiceOutOfProcess,LazyFrameLoading,AvoidUnnecessaryBeforeUnloadCheckSync",
      "--enable-features=Clipboard",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-translate",
      "--no-first-run",
      "--disable-search-engine-choice-screen",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy",
      "--disable-touch-editing",
      "--disable-touch-drag-drop",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-component-update",
      "--disable-infobars",
      "--disable-breakpad",
      "--disable-background-networking",
      "--disable-session-crashed-bubble",
      "--disable-ipc-flooding-protection",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-domain-reliability",
      "--metrics-recording-only",
      "--no-pings",
      "--disable-backing-store-limit",
      "--password-store=basic",
      ...(shouldDisableSandbox ? ["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote"] : []),
    ];

    const headfulArgs = [
      "--ozone-platform=x11",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--use-gl=swiftshader",
      "--in-process-gpu",
      "--enable-crashpad",
      "--crash-dumps-dir=/tmp/chrome-dumps",
      "--noerrdialogs",
      "--force-device-scale-factor=1",
      "--disable-hang-monitor",
    ];

    const headlessArgs = [
      "--headless=new",
      "--hide-crash-restore-bubble",
      "--disable-blink-features=AutomationControlled",
      `--unsafely-treat-insecure-origin-as-secure=http://localhost:3000,http://${env.HOST}:${env.PORT}`,
    ];

    const dynamicArgs = [
      config.dimensions ? "" : "--start-maximized",
      `--remote-debugging-address=${env.HOST}`,
      "--remote-debugging-port=9222",
      `--window-size=${dimensions.width},${dimensions.height}`,
      config.userAgent ? `--user-agent=${config.userAgent}` : "",
      config.options.proxyUrl ? `--proxy-server=${config.options.proxyUrl}` : "",
    ];

    const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

    const launchArgs = uniq([
      ...staticDefaultArgs,
      ...(isHeadless ? headlessArgs : headfulArgs),
      ...dynamicArgs,
      ...extensionArgs,
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
        HOME: os.userInfo().homedir,
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

      try {
        const pages = await this.browser.pages();
        this.primaryPage = pages[0];
        this.attachBrowserListeners();

        // Only install mouse helper in headless mode
        if (isHeadless) {
          installMouseHelper(this.primaryPage, config.deviceConfig?.device || "desktop");
        }
      } catch (postLaunchError) {
        this.logger.error(
          { err: postLaunchError },
          "[BrowserDriver] Post-launch setup failed, cleaning up browser",
        );
        await this.forceClose();
        throw postLaunchError;
      }

      return { browser: this.browser, primaryPage: this.primaryPage };
    } catch (error) {
      this.logger.error({ err: error }, "[BrowserDriver] Failed to launch browser");
      throw error;
    }
  }

  private async setupUserPreferences(
    userDataDir: string,
    userPreferences: Record<string, any>,
  ): Promise<void> {
    try {
      const preferencesPath = getProfilePath(userDataDir, "Preferences");
      const defaultProfileDir = path.dirname(preferencesPath);

      await fs.promises.mkdir(defaultProfileDir, { recursive: true });

      let existingPreferences = {};

      try {
        const existingContent = await fs.promises.readFile(preferencesPath, "utf8");
        existingPreferences = JSON.parse(existingContent);
      } catch (error) {
        this.logger.debug(`[BrowserDriver] No existing preferences found, creating new: ${error}`);
      }

      const mergedPreferences = deepMerge(existingPreferences, userPreferences);

      await fs.promises.writeFile(preferencesPath, JSON.stringify(mergedPreferences, null, 2));

      this.logger.info(`[BrowserDriver] User preferences written to ${preferencesPath}`);
    } catch (error) {
      this.logger.error(`[BrowserDriver] Error setting up user preferences: ${error}`);
      throw error;
    }
  }

  private attachBrowserListeners(): void {
    if (!this.browser) return;

    this.onDisconnectedListener = this.handleDisconnected.bind(this);
    this.onTargetCreatedListener = this.handleTargetCreated.bind(this);
    this.onTargetChangedListener = this.handleTargetChanged.bind(this);
    this.onTargetDestroyedListener = this.handleTargetDestroyed.bind(this);

    this.browser.on("disconnected", this.onDisconnectedListener);
    this.browser.on("targetcreated", this.onTargetCreatedListener);
    this.browser.on("targetchanged", this.onTargetChangedListener);
    this.browser.on("targetdestroyed", this.onTargetDestroyedListener);
  }

  private handleDisconnected(): void {
    this.logger.info("[BrowserDriver] Browser disconnected");
    this.emitEvent({
      type: "disconnected",
      timestamp: Date.now(),
    });
  }

  private async handleTargetCreated(target: Target): Promise<void> {
    this.logger.debug(`[BrowserDriver] Target created: ${target.type()} ${target.url()}`);
    this.emitEvent({
      type: "targetCreated",
      data: { target },
      timestamp: Date.now(),
    });

    if (target.type() !== "page") {
      return;
    }

    try {
      const page = await target.page();
      if (page) {
        await this.attachFileProtocolDetection(page);
      }
    } catch (error) {
      this.logger.error({ err: error }, "[BrowserDriver] Failed to attach file protocol detection");
    }
  }

  private handleTargetChanged(target: Target): void {
    this.logger.debug(`[BrowserDriver] Target changed: ${target.type()} ${target.url()}`);
    this.emitEvent({
      type: "targetChanged",
      data: { target },
      timestamp: Date.now(),
    });
  }

  private handleTargetDestroyed(target: Target): void {
    const targetId = (target as any)._targetId;
    this.logger.debug(`[BrowserDriver] Target destroyed: ${targetId}`);
    this.emitEvent({
      type: "targetDestroyed",
      data: { targetId },
      timestamp: Date.now(),
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

  private detachBrowserListeners(): void {
    if (!this.browser) return;

    const host = this.browser as unknown as BrowserListenerHost;

    const detach = (event: string, listener: AnyListener | null) => {
      if (!listener) return;
      if (typeof host.off === "function") {
        host.off(event, listener);
        return;
      }
      if (typeof host.removeListener === "function") {
        host.removeListener(event, listener);
      }
    };

    detach("disconnected", this.onDisconnectedListener);
    detach("targetcreated", this.onTargetCreatedListener);
    detach("targetchanged", this.onTargetChangedListener);
    detach("targetdestroyed", this.onTargetDestroyedListener);

    this.onDisconnectedListener = null;
    this.onTargetCreatedListener = null;
    this.onTargetChangedListener = null;
    this.onTargetDestroyedListener = null;
    this.logger.debug("[BrowserDriver] Browser listeners detached");
  }

  public getBrowser(): Browser | null {
    return this.browser;
  }

  public getPrimaryPage(): Page | null {
    return this.primaryPage;
  }

  public async close(): Promise<void> {
    if (!this.browser) return;

    const browser = this.browser;
    this.detachBrowserListeners();
    this.browser = null;
    this.primaryPage = null;

    try {
      await browser.close();
    } catch (error) {
      this.logger.warn({ err: error }, "[BrowserDriver] browser.close() failed");
    }

    try {
      browser.process()?.kill();
    } catch (error) {
      this.logger.warn({ err: error }, "[BrowserDriver] process.kill() failed");
    }
  }

  public async forceClose(): Promise<void> {
    if (!this.browser) {
      return;
    }

    this.logger.info("[BrowserDriver] Force closing browser");

    const browser = this.browser;
    this.detachBrowserListeners();
    this.browser = null;
    this.primaryPage = null;

    try {
      await browser.close();
    } catch (error) {
      this.logger.warn(
        { err: error },
        "[BrowserDriver] Error during browser.close() in forceClose",
      );
    }

    try {
      const process = browser.process();
      if (process) {
        process.kill("SIGKILL");
      }
    } catch (error) {
      this.logger.warn({ err: error }, "[BrowserDriver] Error killing process in forceClose");
    }
  }
}
