import { describe, expect, test, vi } from "vitest";

import { CDPService } from "./cdp.service.js";

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe("CDPService mobile device emulation", () => {
  test("uses the mobile layout viewport and enables matching touch input", async () => {
    const service = new CDPService({}, logger as any);
    const send = vi.fn().mockResolvedValue({});
    const detach = vi.fn().mockResolvedValue(undefined);
    const page = {
      createCDPSession: vi.fn().mockResolvedValue({ send, detach }),
    };

    Object.assign(service as any, {
      fingerprintData: {
        fingerprint: {
          navigator: {
            userAgent: "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/150 Mobile",
            maxTouchPoints: 10,
          },
          screen: {
            width: 508,
            height: 1074,
            devicePixelRatio: 3,
          },
        },
      },
      currentSessionConfig: {},
    });

    await (service as any).applyDeviceMetricsOverride(page);

    expect(send).toHaveBeenNthCalledWith(1, "Page.setDeviceMetricsOverride", {
      screenWidth: 508,
      screenHeight: 1074,
      width: 508,
      height: 1074,
      mobile: true,
      screenOrientation: { angle: 0, type: "portraitPrimary" },
      deviceScaleFactor: 3,
    });
    expect(send).toHaveBeenNthCalledWith(2, "Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 10,
    });
    expect(detach).toHaveBeenCalledOnce();
  });
});
