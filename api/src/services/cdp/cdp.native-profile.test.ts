import { describe, expect, it, vi } from "vitest";
import { CDPService } from "./cdp.service.js";

describe("Core native display", () => {
  it("does not install a page-only device metrics override over Core's display", async () => {
    // Avoid constructing a service or starting its proxy/timezone lookup.
    const service = Object.assign(Object.create(CDPService.prototype), {
      launchConfig: { extra: { stealthConfig: { useStealthBrowser: true } } },
      fingerprintData: {
        fingerprint: { screen: { width: 1920, height: 1080, devicePixelRatio: 1 } },
      },
    });

    const page = { createCDPSession: vi.fn() };

    await service.applyDeviceMetricsOverride(page);

    expect(page.createCDPSession).not.toHaveBeenCalled();
  });
});
