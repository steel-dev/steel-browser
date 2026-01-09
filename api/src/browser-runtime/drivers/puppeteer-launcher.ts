import puppeteer, { Browser, Page, Target } from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";
import { BrowserLauncher, BrowserProcess, BrowserRef, ProxyRef, ResolvedConfig } from "./types.js";
import { getChromeExecutablePath, installMouseHelper } from "../actors/browser-utils.js";
import { validateTimezone } from "../actors/validation.js";
import { getExtensionPaths } from "../actors/extensions.js";
import { deepMerge } from "../utils.js";
import { injectFingerprint } from "../services/fingerprint.service.js";
import { traceOperation } from "../tracing/index.js";
import { pino } from "pino";

const dummyLogger = pino({ level: "silent" });

export class PuppeteerLauncher implements BrowserLauncher {
  async launch(config: ResolvedConfig, proxy: ProxyRef | null): Promise<BrowserRef> {
    return traceOperation("browser.launch", "minimal", async (span) => {
      span.setAttribute("session.id", config.sessionId);
      span.setAttribute("browser.headless", config.headless);

      const chromeExecPath = getChromeExecutablePath(config.chromeExecutablePath);
      const isHeadless = config.headless;
      const dimensions = config.dimensions || { width: 1920, height: 1080 };

      // Resolve and validate timezone
      let timezone = "UTC";
      try {
        if (config.skipFingerprintInjection) {
          console.log("[PuppeteerLauncher] Skipping timezone validation");
        } else {
          timezone = await validateTimezone(config.timezone);
        }
      } catch (error) {
        console.warn(`[PuppeteerLauncher] Timezone validation failed: ${error}`);
      }

      // Extensions
      const defaultExtensions = isHeadless ? ["recorder"] : [];
      const customExtensions = config.extensions || [];
      const allExtensions = [...defaultExtensions, ...customExtensions];
      const extensionPaths = await getExtensionPaths(allExtensions);

      const extensionArgs = extensionPaths.length
        ? [
            `--load-extension=${extensionPaths.join(",")}`,
            `--disable-extensions-except=${extensionPaths.join(",")}`,
          ]
        : [];

      // Setup user preferences
      if (config.userDataDir && config.userPreferences) {
        await this.setupUserPreferences(config.userDataDir, config.userPreferences);
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
        ...(shouldDisableSandbox
          ? ["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote"]
          : []),
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
        "--window-position=0,0",
      ];

      const headlessArgs = [
        "--headless=new",
        "--hide-crash-restore-bubble",
        "--disable-blink-features=AutomationControlled",
        `--unsafely-treat-insecure-origin-as-secure=http://localhost:3000,http://${
          config.host || "localhost"
        }:${config.port}`,
      ];

      const dynamicArgs = [
        config.dimensions ? "" : "--start-maximized",
        `--remote-debugging-address=${config.host || "0.0.0.0"}`,
        "--remote-debugging-port=9222",
        `--window-size=${dimensions.width},${dimensions.height}`,
        config.userAgent ? `--user-agent=${config.userAgent}` : "",
        proxy?.url ? `--proxy-server=${proxy.url}` : "",
      ];

      const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

      const launchArgs = uniq([
        ...staticDefaultArgs,
        ...(isHeadless ? headlessArgs : headfulArgs),
        ...dynamicArgs,
        ...extensionArgs,
        ...(config.chromeArgs || []),
      ]).filter((arg) => !(config.filterChromeArgs || []).includes(arg));

      const launchOptions = {
        headless: isHeadless,
        defaultViewport: null,
        args: launchArgs,
        executablePath: chromeExecPath,
        ignoreDefaultArgs: ["--enable-automation"],
        timeout: 30000, // 30s timeout
        env: {
          HOME: os.userInfo().homedir,
          TZ: timezone,
          ...(isHeadless
            ? {}
            : {
                DISPLAY: config.display || process.env.DISPLAY,
                XAUTHORITY: process.env.XAUTHORITY,
              }),
        },
        userDataDir: config.userDataDir,
        dumpio: config.debugChromeProcess,
      };

      let instance: Browser | null = null;
      try {
        instance = await puppeteer.launch(launchOptions);

        const pages = await instance.pages();
        if (pages.length === 0) {
          throw new Error("Browser launched with no pages");
        }
        const primaryPage = pages[0];

        if (isHeadless) {
          await installMouseHelper(primaryPage, config.deviceConfig?.device || "desktop");
        }

        if (config.fingerprint) {
          await injectFingerprint(primaryPage, config.fingerprint, dummyLogger);
        }

        const pid = instance.process()?.pid || 0;

        const browserRef: BrowserRef = {
          id: config.sessionId,
          instance,
          primaryPage,
          pid,
          wsEndpoint: instance.wsEndpoint(),
          launchedAt: Date.now(),
        };

        await this.setupFileProtocolBlocking(primaryPage, config.sessionId, (url) => {
          instance!.emit("fileProtocolViolation", { url });
        });

        if (config.sessionContext?.cookies?.length) {
          const client = await primaryPage.createCDPSession();
          try {
            await client.send("Network.setCookies", {
              cookies: config.sessionContext.cookies.map((cookie) => ({
                ...cookie,
                partitionKey: cookie.partitionKey as any,
              })),
            });
          } finally {
            await client.detach().catch(() => {});
          }
        }

        span.setAttribute("browser.pid", pid);

        return browserRef;
      } catch (err) {
        if (instance) {
          await instance.close().catch(() => {});
        }
        if (err instanceof Error) {
          span.recordException(err);
        }
        throw err;
      }
    });
  }

  private async setupFileProtocolBlocking(
    page: Page,
    sessionId: string,
    onViolation?: (url: string) => void,
  ): Promise<void> {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().startsWith("file://")) {
        console.warn(`[PuppeteerLauncher] Blocked file:// access in session ${sessionId}`);
        if (onViolation) {
          onViolation(request.url());
        }
        request.abort("accessdenied");
      } else {
        request.continue();
      }
    });
  }

  async close(browser: BrowserRef): Promise<void> {
    console.log(
      `[PuppeteerLauncher] Closing browser (session: ${browser.id}, pid: ${browser.pid})`,
    );
    console.log(
      `[PuppeteerLauncher] Browser connected before close: ${browser.instance.isConnected()}`,
    );
    try {
      await browser.instance.close();
      console.log(`[PuppeteerLauncher] Browser closed successfully`);
    } catch (err) {
      console.warn("[PuppeteerLauncher] Error closing browser:", err);
    }
  }

  async forceClose(browser: BrowserRef): Promise<void> {
    try {
      await browser.instance.close();
    } catch (err) {}

    const process = browser.instance.process();
    if (process) {
      try {
        process.kill("SIGKILL");
      } catch (err) {
        console.warn("[PuppeteerLauncher] Error killing process:", err);
      }
    }
  }

  getProcess(browser: BrowserRef): BrowserProcess | null {
    const process = browser.instance.process();
    if (!process) return null;
    return {
      pid: process.pid || 0,
      kill: (signal) => process.kill(signal),
    };
  }

  onDisconnected(browser: BrowserRef, callback: () => void): () => void {
    browser.instance.on("disconnected", callback);
    return () => browser.instance.off("disconnected", callback);
  }

  onTargetCreated(browser: BrowserRef, callback: (target: Target) => void): () => void {
    browser.instance.on("targetcreated", callback);
    return () => browser.instance.off("targetcreated", callback);
  }

  onTargetDestroyed(browser: BrowserRef, callback: (targetId: string) => void): () => void {
    const handler = (target: Target) => {
      callback((target as any)._targetId);
    };
    browser.instance.on("targetdestroyed", handler);
    return () => browser.instance.off("targetdestroyed", handler);
  }

  private async setupUserPreferences(
    userDataDir: string,
    userPreferences: Record<string, any>,
  ): Promise<void> {
    const preferencesPath = path.join(userDataDir, "Default", "Preferences");
    const dir = path.dirname(preferencesPath);

    await fs.promises.mkdir(dir, { recursive: true });

    let existingPreferences = {};
    try {
      const existingContent = await fs.promises.readFile(preferencesPath, "utf8");
      existingPreferences = JSON.parse(existingContent);
    } catch (error) {}

    const mergedPreferences = deepMerge(existingPreferences, userPreferences);
    await fs.promises.writeFile(preferencesPath, JSON.stringify(mergedPreferences, null, 2));
  }
}
