import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { describe, expect, test } from "vitest";
import {
  buildDeviceMetrics,
  buildScreenInfoSwitch,
  buildScriptParams,
  buildUserAgentOverride,
  MissingUserAgentDataError,
} from "./overrides.js";

const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

function desktop(screen: object = {}): BrowserFingerprintWithHeaders {
  return {
    headers: { "accept-language": "de-DE,de;q=0.9,en;q=0.8" },
    fingerprint: {
      navigator: {
        userAgent: DESKTOP_UA,
        platform: "Linux x86_64",
        hardwareConcurrency: 12,
        deviceMemory: 8,
        maxTouchPoints: 0,
        userAgentData: {
          brands: [{ brand: "Chromium", version: "156" }],
          fullVersionList: [{ brand: "Chromium", version: "156.0.8078.108" }],
          uaFullVersion: "156.0.8078.108",
          platform: "Linux",
          platformVersion: "",
          architecture: "x86",
          bitness: "64",
          model: "",
          mobile: false,
        },
      },
      videoCard: { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel)" },
      screen: { width: 1920, height: 1080, devicePixelRatio: 1, ...screen },
    },
  } as unknown as BrowserFingerprintWithHeaders;
}

describe("buildUserAgentOverride", () => {
  test("carries the full UA metadata, the plain language list and a form factor", () => {
    expect(buildUserAgentOverride(desktop())).toEqual({
      userAgent: DESKTOP_UA,
      acceptLanguage: "de-DE,de,en",
      platform: "Linux x86_64",
      userAgentMetadata: {
        brands: [{ brand: "Chromium", version: "156" }],
        fullVersionList: [{ brand: "Chromium", version: "156.0.8078.108" }],
        fullVersion: "156.0.8078.108",
        platform: "Linux",
        platformVersion: "",
        architecture: "x86",
        model: "",
        mobile: false,
        bitness: "64",
        wow64: false,
        formFactors: ["Desktop"],
      },
    });
  });

  test("fails with a clear error for a fingerprint without UA client hints", () => {
    const firefox = desktop();
    (firefox.fingerprint.navigator as any).userAgentData = undefined;
    expect(() => buildUserAgentOverride(firefox)).toThrow(MissingUserAgentDataError);
    expect(() => buildScriptParams(firefox)).toThrow(/userAgentData is required/);
  });
});

describe("buildDeviceMetrics for desktop", () => {
  test("overrides nothing when the launch flags give the screen and the ratio is 1", () => {
    expect(buildDeviceMetrics(desktop(), { screenFromLaunchFlags: true })).toEqual({
      metrics: null,
      touch: null,
    });
  });

  test("keeps the real window as viewport and only sets the pixel ratio", () => {
    expect(
      buildDeviceMetrics(desktop({ devicePixelRatio: 2 }), { screenFromLaunchFlags: true }),
    ).toEqual({
      metrics: { width: 0, height: 0, mobile: false, deviceScaleFactor: 2 },
      touch: null,
    });
  });

  test("sets the screen when no launch flag does (headful)", () => {
    expect(buildDeviceMetrics(desktop(), { screenFromLaunchFlags: false }).metrics).toEqual({
      width: 0,
      height: 0,
      mobile: false,
      deviceScaleFactor: 1,
      screenWidth: 1920,
      screenHeight: 1080,
    });
  });
});

describe("buildScriptParams", () => {
  test("passes the fingerprint values the page and worker scripts use", () => {
    expect(buildScriptParams(desktop())).toEqual({
      fixedPlatform: "Linux x86_64",
      fixedUaPlatform: "Linux",
      fixedMobile: false,
      fixedVendor: "Google Inc. (Intel)",
      fixedRenderer: "ANGLE (Intel)",
      fixedDeviceMemory: 8,
      fixedHardwareConcurrency: 12,
      fixedArchitecture: "x86",
      fixedBitness: "64",
      fixedModel: "",
      fixedPlatformVersion: "",
      fixedUaFullVersion: "156.0.8078.108",
      fixedBrands: [{ brand: "Chromium", version: "156" }],
    });
  });
});

describe("buildScreenInfoSwitch", () => {
  test("uses the screen size for a pixel ratio of 1", () => {
    expect(buildScreenInfoSwitch({ width: 1920, height: 1080, devicePixelRatio: 1 })).toBe(
      "--screen-info={1920x1080}",
    );
  });

  test("gives physical pixels and the ratio otherwise", () => {
    expect(buildScreenInfoSwitch({ width: 1440, height: 900, devicePixelRatio: 2 })).toBe(
      "--screen-info={2880x1800 devicePixelRatio=2}",
    );
  });
});
