import type { BrowserFingerprintWithHeaders, ScreenFingerprint } from "fingerprint-generator";
import { describe, expect, test } from "vitest";
import { alignFingerprintWithBrowser, buildReducedUserAgent, fitScreenToWindow } from "./align.js";

const VERSION = { major: 156, full: "156.0.8078.108" };

// Shapes taken from header-generator 2.1.82 samples, including their mixed-up values.
function linuxSample(): BrowserFingerprintWithHeaders {
  return {
    headers: {
      "sec-ch-ua": '"Chromium";v="139", "Not)A;Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "user-agent":
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    fingerprint: {
      navigator: {
        userAgent:
          "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        appVersion:
          "5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        platform: "Linux aarch64",
        language: "en-US",
        userAgentData: {
          brands: [
            { brand: "Chromium", version: "139" },
            { brand: "Not)A;Brand", version: "99" },
          ],
          mobile: false,
          platform: "Linux",
          architecture: "aarch64",
          bitness: "64",
          model: "",
          platformVersion: "6.8.0",
          uaFullVersion: "139.0.7258.154",
          fullVersionList: [
            { brand: "Chromium", version: "139.0.0.0" },
            { brand: "Not)A;Brand", version: "99.0.0.0" },
          ],
        },
      },
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    },
  } as unknown as BrowserFingerprintWithHeaders;
}

function androidSample(mobile = true): BrowserFingerprintWithHeaders {
  return {
    headers: { "accept-language": "en-US,en;q=0.9" },
    fingerprint: {
      navigator: {
        userAgent: `Mozilla/5.0 (Linux; Android 16; HON-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0${
          mobile ? " Mobile" : ""
        } Safari/537.36`,
        appVersion: "",
        platform: "Linux armv8l",
        userAgentData: {
          brands: [{ brand: "Brave", version: "144" }],
          mobile,
          platform: "Android",
          architecture: "arm",
          bitness: "64",
          model: "HON-AN00",
          platformVersion: "16.0.0",
          uaFullVersion: "131.0.6778.264",
          fullVersionList: [],
        },
      },
      screen: { width: 412, height: 915 },
    },
  } as unknown as BrowserFingerprintWithHeaders;
}

describe("alignFingerprintWithBrowser", () => {
  test("gives a Linux desktop sample the binary's reduced UA and Chrome brands", () => {
    const aligned = alignFingerprintWithBrowser(linuxSample(), VERSION, "x64");
    const { navigator } = aligned.fingerprint;

    expect(navigator.userAgent).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    );
    expect(navigator.appVersion).toBe(navigator.userAgent.slice("Mozilla/".length));
    expect(navigator.platform).toBe("Linux x86_64");
    expect(navigator.userAgentData).toEqual({
      brands: [
        { brand: "Not:A-Brand", version: "8" },
        { brand: "Chromium", version: "156" },
        { brand: "Google Chrome", version: "156" },
      ],
      fullVersionList: [
        { brand: "Not:A-Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "156.0.8078.108" },
        { brand: "Google Chrome", version: "156.0.8078.108" },
      ],
      mobile: false,
      platform: "Linux",
      architecture: "x86",
      bitness: "64",
      model: "",
      platformVersion: "",
      uaFullVersion: "156.0.8078.108",
    });
    expect(aligned.headers).toMatchObject({
      "user-agent": navigator.userAgent,
      "sec-ch-ua": '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "accept-language": "en-US,en;q=0.9",
    });
  });

  test("reports an ARM CPU in UA-CH on an arm64 host, but the reduced navigator.platform", () => {
    const { navigator } = alignFingerprintWithBrowser(linuxSample(), VERSION, "arm64").fingerprint;
    expect(navigator.platform).toBe("Linux x86_64");
    expect(navigator.userAgentData).toMatchObject({ architecture: "arm", bitness: "64" });
    expect(navigator.userAgent).toContain("(X11; Linux x86_64)");
  });

  test("does not modify the sample it is given", () => {
    const sample = linuxSample();
    alignFingerprintWithBrowser(sample, VERSION, "x64");
    expect(sample).toEqual(linuxSample());
  });

  test("gives an Android phone the reduced UA, the Mobile token and empty CPU fields", () => {
    const aligned = alignFingerprintWithBrowser(androidSample(true), VERSION, "x64");
    const { navigator } = aligned.fingerprint;
    expect(navigator.userAgent).toBe(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36",
    );
    expect(navigator.platform).toBe("Linux armv81");
    expect(navigator.userAgentData).toMatchObject({
      mobile: true,
      platform: "Android",
      platformVersion: "16.0.0",
      model: "HON-AN00",
      architecture: "",
      bitness: "",
      uaFullVersion: "156.0.8078.108",
    });
    expect(aligned.headers["sec-ch-ua-mobile"]).toBe("?1");
  });

  test("drops the Mobile token for an Android tablet", () => {
    const { navigator } = alignFingerprintWithBrowser(androidSample(false), VERSION).fingerprint;
    expect(navigator.userAgent).toBe(
      buildReducedUserAgent({ major: 156, android: true, mobile: false }),
    );
    expect(navigator.userAgent).not.toContain("Mobile");
  });
});

describe("fitScreenToWindow", () => {
  const screen = {
    width: 1366,
    height: 768,
    availWidth: 1366,
    availHeight: 730,
    availTop: 38,
    availLeft: 0,
  } as ScreenFingerprint;

  test("keeps a screen that already contains the window", () => {
    expect(fitScreenToWindow(screen, { width: 1280, height: 720 })).toBe(screen);
  });

  test("grows a screen smaller than the window, with no reserved area", () => {
    expect(fitScreenToWindow(screen, { width: 1920, height: 1080 })).toMatchObject({
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1080,
      availTop: 0,
      availLeft: 0,
    });
  });
});
