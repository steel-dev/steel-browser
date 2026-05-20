import { describe, expect, it } from "vitest";
import { isSimilarConfig } from "./validation.js";
import type { BrowserLauncherOptions } from "../../../types/browser.js";

describe("isSimilarConfig", () => {
  const baseConfig: BrowserLauncherOptions = {
    options: { headless: true },
    userDataDir: "/tmp/steel-profile",
    blockAds: true,
  };

  it.each([
    [
      "optimizeBandwidth",
      {
        optimizeBandwidth: {
          blockImages: true,
          blockMedia: true,
          blockStylesheets: true,
          blockHosts: ["ads.example"],
        },
      },
    ],
    ["customHeaders", { customHeaders: { authorization: "Bearer new-token" } }],
    ["logSinkUrl", { logSinkUrl: "https://sink.example/session-2" }],
    ["dangerouslyLogRequestDetails", { dangerouslyLogRequestDetails: true }],
  ] satisfies [string, Partial<BrowserLauncherOptions>][])(
    "treats changed %s as requiring a new browser",
    async (_name, changedConfig) => {
      await expect(isSimilarConfig(baseConfig, { ...baseConfig, ...changedConfig })).resolves.toBe(
        false,
      );
    },
  );
});
