import { describe, expect, test } from "vitest";
import type { BrowserLauncherOptions } from "../../types/browser.js";
import { CDPService } from "./cdp.service.js";

const prototype = CDPService.prototype as unknown as {
  requiresRequestInterception(this: {
    launchConfig?: Partial<BrowserLauncherOptions>;
    compiledUrlPatterns: RegExp[];
  }): boolean;
};

function requiresRequestInterception(
  launchConfig?: Partial<BrowserLauncherOptions>,
  compiledUrlPatterns: RegExp[] = [],
) {
  return prototype.requiresRequestInterception.call({ launchConfig, compiledUrlPatterns });
}

describe("CDPService request interception", () => {
  test("leaves interception disabled without blocking features", () => {
    expect(requiresRequestInterception()).toBe(false);
    expect(requiresRequestInterception({ blockAds: false })).toBe(false);
    expect(requiresRequestInterception({ optimizeBandwidth: false })).toBe(false);
    expect(requiresRequestInterception({ optimizeBandwidth: {} })).toBe(false);
  });

  test("enables interception for ad and URL blocking", () => {
    expect(requiresRequestInterception({ blockAds: true })).toBe(true);
    expect(requiresRequestInterception({}, [/ads/])).toBe(true);
  });

  test.each([
    { blockImages: true },
    { blockMedia: true },
    { blockStylesheets: true },
    { blockHosts: ["example.com"] },
    { blockUrlPatterns: ["**/tracking/**"] },
  ])(
    "enables interception for optimizeBandwidth $blockImages$blockMedia$blockStylesheets",
    (optimizeBandwidth) => {
      expect(requiresRequestInterception({ optimizeBandwidth })).toBe(true);
    },
  );
});
