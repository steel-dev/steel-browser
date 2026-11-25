import type { BrowserFingerprintWithHeaders, ScreenFingerprint } from "fingerprint-generator";
import type { ChromeVersion } from "./chrome-version.js";
import { formatSecChUa, getUserAgentBrandLists } from "./user-agent-brands.js";

/**
 * Returns true for Android fingerprints, by UA-CH platform or by UA string.
 */
export function isAndroidFingerprint(fingerprintData: BrowserFingerprintWithHeaders): boolean {
  const { navigator } = fingerprintData.fingerprint;
  return navigator.userAgentData?.platform === "Android" || /Android/i.test(navigator.userAgent);
}

/**
 * Builds the reduced User-Agent string Chromium sends since UA reduction:
 * minor/build/patch are zero and the platform is the unified one.
 * user_agent_utils.cc: GetUnifiedPlatform(), BuildUserAgentFromOSAndProduct().
 */
export function buildReducedUserAgent(options: {
  major: number;
  android: boolean;
  mobile: boolean;
}): string {
  const platform = options.android ? "Linux; Android 10; K" : "X11; Linux x86_64";
  const product = `Chrome/${options.major}.0.0.0${
    options.android && options.mobile ? " Mobile" : ""
  }`;
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) ${product} Safari/537.36`;
}

/**
 * `navigator.platform` of a reduced-UA Chrome, whatever the real CPU
 * (navigator_base.cc: GetReducedNavigatorPlatform()).
 */
export const REDUCED_NAVIGATOR_PLATFORM = {
  linux: "Linux x86_64",
  android: "Linux armv81",
} as const;

/**
 * UA-CH CPU fields Chromium reports on a Linux desktop
 * (GetPosixCpuArchitecture(), GetCpuBitness()): the real CPU of the host.
 */
export function linuxCpuForArch(arch: string): { architecture: string; bitness: string } {
  return arch === "arm64"
    ? { architecture: "arm", bitness: "64" }
    : { architecture: "x86", bitness: "64" };
}

/**
 * Rewrites the browser identity of a generated fingerprint so it matches the
 * Chrome binary that will present it: reduced UA with the real major, the
 * GREASE brand list Chromium generates for that major, the real full version,
 * and the CPU fields of the host. The fingerprint-generator dataset lags real
 * Chrome releases and mixes values from different versions and browsers.
 */
export function alignFingerprintWithBrowser(
  fingerprintData: BrowserFingerprintWithHeaders,
  version: ChromeVersion,
  hostArch: string = process.arch,
): BrowserFingerprintWithHeaders {
  const aligned = structuredClone(fingerprintData);
  const { navigator } = aligned.fingerprint;
  const userAgentData = navigator.userAgentData;
  const android = isAndroidFingerprint(aligned);
  const mobile = android && Boolean(userAgentData.mobile);
  const { brands, fullVersionList } = getUserAgentBrandLists(version.full);

  navigator.userAgent = buildReducedUserAgent({ major: version.major, android, mobile });
  navigator.appVersion = navigator.userAgent.replace(/^Mozilla\//, "");

  userAgentData.brands = brands;
  userAgentData.fullVersionList = fullVersionList;
  userAgentData.uaFullVersion = version.full;
  userAgentData.mobile = mobile;

  if (android) {
    userAgentData.platform = "Android";
    navigator.platform = REDUCED_NAVIGATOR_PLATFORM.android;
    // GetCpuArchitecture()/GetCpuBitness() are empty on Android phones and tablets.
    userAgentData.architecture = "";
    userAgentData.bitness = "";
  } else {
    const cpu = linuxCpuForArch(hostArch);
    userAgentData.platform = "Linux";
    // GetPlatformVersion() is empty on Linux.
    userAgentData.platformVersion = "";
    userAgentData.architecture = cpu.architecture;
    userAgentData.bitness = cpu.bitness;
    userAgentData.model = "";
    navigator.platform = REDUCED_NAVIGATOR_PLATFORM.linux;
  }

  const headers = aligned.headers;
  headers["user-agent"] = navigator.userAgent;
  headers["sec-ch-ua"] = formatSecChUa(brands);
  headers["sec-ch-ua-mobile"] = mobile ? "?1" : "?0";
  headers["sec-ch-ua-platform"] = `"${userAgentData.platform}"`;

  return aligned;
}

/**
 * Makes the fingerprint's screen at least as large as the browser window, with
 * the available area equal to the screen: a window larger than the screen it
 * is on is impossible on a real desktop.
 */
export function fitScreenToWindow(
  screen: ScreenFingerprint,
  window: { width: number; height: number },
): ScreenFingerprint {
  const width = Math.max(screen.width, window.width);
  const height = Math.max(screen.height, window.height);
  if (width === screen.width && height === screen.height) return screen;
  return {
    ...screen,
    width,
    height,
    availWidth: width,
    availHeight: height,
    availTop: 0,
    availLeft: 0,
  };
}
