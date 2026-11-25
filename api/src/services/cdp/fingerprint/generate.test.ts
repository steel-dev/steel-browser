import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { describe, expect, test, vi } from "vitest";
import { buildOptionSets, generateFingerprint } from "./generate.js";

const VERSION = { major: 156, full: "156.0.8078.108" };
const CHROME_156_SEC_CH_UA = '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"';

function sample(userAgentData: object | null): BrowserFingerprintWithHeaders {
  return {
    headers: {},
    fingerprint: {
      navigator: {
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        platform: "Linux x86_64",
        userAgentData,
      },
      screen: { width: 1920, height: 1080 },
    },
  } as unknown as BrowserFingerprintWithHeaders;
}

const LINUX_UA_DATA = {
  brands: [],
  fullVersionList: [],
  mobile: false,
  platform: "Linux",
  architecture: "x86",
  bitness: "64",
  model: "",
  platformVersion: "",
  uaFullVersion: "145.0.7632.109",
};

describe("generateFingerprint with the bundled dataset", () => {
  test("generates a Linux desktop Chrome that matches the binary and the window", () => {
    const { fingerprint, headers } = generateFingerprint({
      device: "desktop",
      dimensions: { width: 1920, height: 1080 },
      browserVersion: VERSION,
      hostArch: "x64",
    });
    expect(fingerprint.navigator.userAgent).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    );
    expect(fingerprint.navigator.userAgentData.uaFullVersion).toBe("156.0.8078.108");
    expect(headers["sec-ch-ua"]).toBe(CHROME_156_SEC_CH_UA);
    expect(fingerprint.screen).toMatchObject({ width: 1920, height: 1080 });
  });

  test("never hands out a screen smaller than the window", () => {
    for (const dimensions of [
      { width: 1280, height: 720 },
      { width: 2560, height: 1440 },
      { width: 1111, height: 777 },
    ]) {
      const { screen } = generateFingerprint({
        device: "desktop",
        dimensions,
        browserVersion: VERSION,
      }).fingerprint;
      expect(screen.width).toBeGreaterThanOrEqual(dimensions.width);
      expect(screen.height).toBeGreaterThanOrEqual(dimensions.height);
    }
  });

  test("uses the pixel ratio the browser renders at when one is given", () => {
    const { screen } = generateFingerprint({
      device: "desktop",
      dimensions: { width: 1920, height: 1080 },
      browserVersion: VERSION,
      devicePixelRatio: 1,
    }).fingerprint;
    expect(screen.devicePixelRatio).toBe(1);
  });

  test("keeps Accept-Language in the requested order across generations", () => {
    for (let i = 0; i < 3; i++) {
      const { headers, fingerprint } = generateFingerprint({
        device: "desktop",
        browserVersion: VERSION,
      });
      expect(headers["accept-language"]).toMatch(/^en-US,en;q=0\.\d$/);
      expect(fingerprint.navigator.language).toBe("en-US");
    }
  });

  test("generates only Android Chrome for mobile, never iOS Safari or Firefox", () => {
    for (let i = 0; i < 25; i++) {
      const { fingerprint } = generateFingerprint({ device: "mobile", browserVersion: VERSION });
      expect(fingerprint.navigator.userAgent).toMatch(
        /^Mozilla\/5\.0 \(Linux; Android 10; K\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/156\.0\.0\.0( Mobile)? Safari\/537\.36$/,
      );
      expect(fingerprint.navigator.userAgentData).toMatchObject({
        platform: "Android",
        uaFullVersion: "156.0.8078.108",
      });
    }
  });
});

describe("generateFingerprint fallback", () => {
  test("relaxes the screen before giving up and keeps the version window independent", () => {
    expect(
      buildOptionSets({
        device: "desktop",
        dimensions: { width: 1280, height: 720 },
        browserVersion: VERSION,
      }).map(({ browsers, screen }) => ({ browsers, screen })),
    ).toEqual([
      {
        browsers: [{ name: "chrome", minVersion: 144 }],
        screen: { minWidth: 1280, maxWidth: 1280, minHeight: 720, maxHeight: 720 },
      },
      {
        browsers: [{ name: "chrome" }],
        screen: { minWidth: 1280, maxWidth: 1280, minHeight: 720, maxHeight: 720 },
      },
      {
        browsers: [{ name: "chrome", minVersion: 144 }],
        screen: { minWidth: 1280, minHeight: 720 },
      },
      { browsers: [{ name: "chrome" }], screen: { minWidth: 1280, minHeight: 720 } },
      { browsers: [{ name: "chrome", minVersion: 144 }], screen: undefined },
      { browsers: [{ name: "chrome" }], screen: undefined },
    ]);
  });

  test("asks for Android Chrome only, with no version floor when the binary is unknown", () => {
    expect(buildOptionSets({ device: "mobile", browserVersion: null })).toEqual([
      {
        devices: ["mobile"],
        operatingSystems: ["android"],
        browsers: [{ name: "chrome" }],
        locales: ["en-US", "en"],
        strict: true,
      },
    ]);
  });

  test("moves to the next option set when the dataset has no match", () => {
    const warn = vi.fn();
    const createGenerator = vi.fn((options) => ({
      getFingerprint: () => {
        if (options.screen?.maxWidth) throw new Error("No headers based on this input");
        return sample(LINUX_UA_DATA);
      },
    }));
    const result = generateFingerprint({
      device: "desktop",
      browserVersion: VERSION,
      createGenerator,
      logger: { warn },
    });
    expect(createGenerator).toHaveBeenCalledTimes(3);
    expect(result.fingerprint.navigator.userAgent).toContain("Chrome/156.0.0.0");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        used: expect.objectContaining({ screen: { minWidth: 1920, minHeight: 1080 } }),
      }),
      expect.stringContaining("relaxed constraints"),
    );
  });

  test("throws a clear error instead of returning a sample without userAgentData", () => {
    const createGenerator = () => ({ getFingerprint: () => sample(null) });
    expect(() =>
      generateFingerprint({ device: "mobile", browserVersion: VERSION, createGenerator }),
    ).toThrow("Could not generate a mobile Chrome fingerprint with navigator.userAgentData");
  });

  test("keeps the sample's own version, made consistent, when the binary is unknown", () => {
    const warn = vi.fn();
    const { fingerprint, headers } = generateFingerprint({
      device: "desktop",
      browserVersion: null,
      createGenerator: () => ({ getFingerprint: () => sample(LINUX_UA_DATA) }),
      logger: { warn },
    });
    expect(fingerprint.navigator.userAgentData.uaFullVersion).toBe("145.0.7632.109");
    expect(headers["sec-ch-ua"]).toBe(
      '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    );
    expect(warn).toHaveBeenCalledWith(
      { sampleVersion: "145.0.7632.109" },
      expect.stringContaining("Could not read the Chrome binary version"),
    );
  });
});
