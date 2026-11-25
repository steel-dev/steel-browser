import type { BrowserFingerprintWithHeaders, VideoCard } from "fingerprint-generator";
import type { Protocol } from "puppeteer-core";
import type { loadFingerprintScript } from "../../../scripts/index.js";

export type FingerprintScriptParams = Parameters<typeof loadFingerprintScript>[0];

/** formFactors is newer than the protocol types bundled with puppeteer-core 23.6. */
export type UserAgentMetadata = Protocol.Emulation.UserAgentMetadata & { formFactors: string[] };

export type UserAgentOverride = Protocol.Emulation.SetUserAgentOverrideRequest & {
  userAgentMetadata: UserAgentMetadata;
};

export interface DeviceMetrics {
  metrics: Protocol.Emulation.SetDeviceMetricsOverrideRequest | null;
  touch: Protocol.Emulation.SetTouchEmulationEnabledRequest | null;
}

export class MissingUserAgentDataError extends Error {
  constructor() {
    super(
      "fingerprint.navigator.userAgentData is required: Chromium can only present a Chromium " +
        "fingerprint with UA client hints, and a fingerprint without them cannot be applied",
    );
    this.name = "MissingUserAgentDataError";
  }
}

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  return /phone|android|mobile/i.test(userAgent ?? "");
}

function requireUserAgentData(fingerprintData: BrowserFingerprintWithHeaders) {
  const userAgentData = fingerprintData.fingerprint.navigator.userAgentData;
  if (!userAgentData || !userAgentData.platform) {
    throw new MissingUserAgentDataError();
  }
  return userAgentData;
}

/**
 * Accept-Language with the q-values stripped: Chromium writes them itself from
 * the plain list ("en-US,en" -> "en-US,en;q=0.9").
 */
function acceptLanguageList(headers: Record<string, string>): string | undefined {
  return headers["accept-language"]
    ?.split(",")
    .map((language) => language.split(";")[0].trim())
    .filter(Boolean)
    .join(",");
}

/**
 * Payload for Emulation.setUserAgentOverride (pages) and
 * Network.setUserAgentOverride (workers). With userAgentMetadata set,
 * Chromium generates navigator.userAgentData and every Sec-CH-UA* header
 * from it, so no client hint is sent as a static extra header.
 */
export function buildUserAgentOverride(
  fingerprintData: BrowserFingerprintWithHeaders,
): UserAgentOverride {
  const { fingerprint, headers } = fingerprintData;
  const userAgentData = requireUserAgentData(fingerprintData);
  const navigatorPlatform = fingerprint.navigator.platform || "Linux x86_64";
  return {
    userAgent: fingerprint.navigator.userAgent,
    acceptLanguage: acceptLanguageList(headers),
    platform: navigatorPlatform,
    userAgentMetadata: {
      brands: userAgentData.brands,
      fullVersionList: userAgentData.fullVersionList,
      fullVersion: userAgentData.uaFullVersion,
      platform: userAgentData.platform,
      platformVersion: userAgentData.platformVersion ?? "",
      architecture: userAgentData.architecture ?? "x86",
      model: userAgentData.model ?? "",
      mobile: Boolean(userAgentData.mobile),
      bitness: userAgentData.bitness ?? "64",
      wow64: false,
      // GetFormFactorsClientHint(): "Mobile" or "Desktop" from the mobile bit.
      formFactors: [userAgentData.mobile ? "Mobile" : "Desktop"],
    },
  };
}

/**
 * Device metrics for every page of the session.
 *
 * Mobile: the emulated phone screen, viewport and touch input.
 * Desktop: the viewport is left to the real window (--window-size), so
 * innerHeight stays below outerHeight as in a browser with UI; only the pixel
 * ratio and, when the launch flags do not provide it, the screen size are
 * overridden. Page.setDeviceMetricsOverride also makes the available screen
 * area equal to the screen (screen_metrics_emulator.cc).
 */
export function buildDeviceMetrics(
  fingerprintData: BrowserFingerprintWithHeaders,
  options: { screenFromLaunchFlags: boolean },
): DeviceMetrics {
  const { screen, navigator } = fingerprintData.fingerprint;
  const devicePixelRatio = screen.devicePixelRatio || 1;

  if (isMobileUserAgent(navigator.userAgent)) {
    return {
      metrics: {
        screenWidth: screen.width,
        screenHeight: screen.height,
        width: screen.innerWidth || screen.width,
        height: screen.innerHeight || screen.height,
        mobile: true,
        screenOrientation:
          screen.height > screen.width
            ? { angle: 0, type: "portraitPrimary" }
            : { angle: 90, type: "landscapePrimary" },
        deviceScaleFactor: devicePixelRatio,
      },
      touch: { enabled: true, maxTouchPoints: navigator.maxTouchPoints ?? 1 },
    };
  }

  if (options.screenFromLaunchFlags && devicePixelRatio === 1) {
    return { metrics: null, touch: null };
  }
  return {
    metrics: {
      width: 0,
      height: 0,
      mobile: false,
      deviceScaleFactor: devicePixelRatio,
      ...(options.screenFromLaunchFlags
        ? {}
        : { screenWidth: screen.width, screenHeight: screen.height }),
    },
    touch: null,
  };
}

/** Values for loadFingerprintScript() and loadWorkerFingerprintScript(). */
export function buildScriptParams(
  fingerprintData: BrowserFingerprintWithHeaders,
): FingerprintScriptParams {
  const { fingerprint } = fingerprintData;
  const userAgentData = requireUserAgentData(fingerprintData);
  const videoCard = fingerprint.videoCard as VideoCard | null;
  return {
    fixedPlatform: fingerprint.navigator.platform || "Linux x86_64",
    fixedUaPlatform: userAgentData.platform,
    fixedMobile: Boolean(userAgentData.mobile),
    fixedVendor: videoCard?.vendor,
    fixedRenderer: videoCard?.renderer,
    fixedDeviceMemory: fingerprint.navigator.deviceMemory || 8,
    fixedHardwareConcurrency: fingerprint.navigator.hardwareConcurrency || 8,
    fixedArchitecture: userAgentData.architecture ?? "x86",
    fixedBitness: userAgentData.bitness ?? "64",
    fixedModel: userAgentData.model ?? "",
    fixedPlatformVersion: userAgentData.platformVersion ?? "",
    fixedUaFullVersion: userAgentData.uaFullVersion,
    fixedBrands: userAgentData.brands ?? [],
  };
}

/**
 * Headless Chromium reports an 800x600 screen whatever the window size;
 * --screen-info sets the screen for every target from the first frame
 * (components/headless/screen_info/headless_screen_info.cc, physical pixels).
 */
export function buildScreenInfoSwitch(screen: {
  width: number;
  height: number;
  devicePixelRatio?: number;
}): string {
  const devicePixelRatio = screen.devicePixelRatio || 1;
  if (devicePixelRatio === 1) {
    return `--screen-info={${screen.width}x${screen.height}}`;
  }
  const width = Math.round(screen.width * devicePixelRatio);
  const height = Math.round(screen.height * devicePixelRatio);
  return `--screen-info={${width}x${height} devicePixelRatio=${devicePixelRatio}}`;
}
