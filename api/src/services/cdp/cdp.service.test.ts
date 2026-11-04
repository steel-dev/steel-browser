import { describe, expect, it, vi } from "vitest";
import { CDPService } from "./cdp.service.js";

type BrowserVersionHost = {
  browserInstance: { version: () => Promise<string> } | null;
  logger: { warn: (message: string) => void };
};

const getBrowserVersion = (host: BrowserVersionHost): Promise<string> =>
  CDPService.prototype.getBrowserVersion.call(host as unknown as CDPService);

const logger = { warn: vi.fn() };

describe("CDPService.getBrowserVersion", () => {
  it("returns the version string reported by the browser", async () => {
    const version = "Chrome/150.0.7871.124";

    await expect(
      getBrowserVersion({ browserInstance: { version: async () => version }, logger }),
    ).resolves.toBe(version);
  });

  it("returns an empty string when no browser is running", async () => {
    await expect(getBrowserVersion({ browserInstance: null, logger })).resolves.toBe("");
  });

  it("returns an empty string when the browser fails to report a version", async () => {
    await expect(
      getBrowserVersion({
        browserInstance: {
          version: async () => {
            throw new Error("Target closed");
          },
        },
        logger,
      }),
    ).resolves.toBe("");
  });
});
