import { describe, it, expect } from "vitest";
import { CDPService } from "./cdp.service.js";

// getBrowserVersion only reads this.browserInstance, so we can exercise it
// against a stand-in without constructing the full service.
const callGetBrowserVersion = (browserInstance: unknown) =>
  (CDPService.prototype.getBrowserVersion as () => Promise<string>).call({ browserInstance });

describe("CDPService.getBrowserVersion", () => {
  it("returns the browser version string, not a stringified object", async () => {
    const version = "Chrome/150.0.7871.124";
    const result = await callGetBrowserVersion({ version: async () => version });
    expect(result).toBe(version);
    expect(result).not.toBe("[object Object]");
  });

  it("returns an empty string when the browser is not initialized", async () => {
    expect(await callGetBrowserVersion(null)).toBe("");
  });
});
