import puppeteer, { Browser, Page } from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";
import { BrowserRef, ProxyRef, ResolvedConfig } from "../types.js";
import { getChromeExecutablePath, installMouseHelper } from "./browser-utils.js";
import { validateTimezone } from "./validation.js";
import { getExtensionPaths } from "./extensions.js";
import { deepMerge } from "../utils.js";

export async function launchBrowser(
  config: ResolvedConfig,
  proxy: ProxyRef | null,
): Promise<BrowserRef> {
  const chromeExecPath = getChromeExecutablePath(config.chromeExecutablePath);
  const isHeadless = config.headless;
  const dimensions = config.dimensions || { width: 1920, height: 1080 };

  // Resolve and validate timezone
  let timezone = "UTC";
  try {
    if (config.skipFingerprintInjection) {
      console.log("[BrowserLauncher] Skipping timezone validation");
    } else {
      timezone = await validateTimezone(config.timezone);
    }
  } catch (error) {
    console.warn(`[BrowserLauncher] Timezone validation failed: ${error}`);
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
    await setupUserPreferences(config.userDataDir, config.userPreferences);
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
    defaultViewport: null,
    args: launchArgs,
    executablePath: chromeExecPath,
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: 0,
    env: {
      HOME: os.userInfo().homedir,
      TZ: timezone,
      ...(isHeadless ? {} : { DISPLAY: config.display || process.env.DISPLAY }),
    },
    userDataDir: config.userDataDir,
    dumpio: config.debugChromeProcess,
  };

  const instance = await puppeteer.launch(launchOptions);
  const pages = await instance.pages();
  const primaryPage = pages[0];

  if (isHeadless) {
    await installMouseHelper(primaryPage, config.deviceConfig?.device || "desktop");
  }

  return {
    instance,
    primaryPage,
    pid: instance.process()?.pid || 0,
    wsEndpoint: instance.wsEndpoint(),
  };
}

async function setupUserPreferences(
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
