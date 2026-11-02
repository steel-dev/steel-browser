import { describe, expect, it, vi } from "vitest";
import { CDPService } from "./cdp.service.js";

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe("worker fingerprint readiness", () => {
  it("does not treat plugin registration as successful initialization", () => {
    const service = new CDPService({}, logger as any);
    const plugin = { isReady: vi.fn(() => false) };
    Object.assign(service, {
      launchConfig: {},
      fingerprintData: {},
      pluginManager: { getPlugin: () => plugin },
    });
    expect((service as any).isWorkerFingerprintReady()).toBe(false);
    expect(() => (service as any).assertWorkerFingerprintReady()).toThrow(
      "Worker fingerprint initialization did not complete",
    );
    plugin.isReady.mockReturnValue(true);
    expect(() => (service as any).assertWorkerFingerprintReady()).not.toThrow();
    expect((service as any).isWorkerFingerprintReady()).toBe(true);
  });

  it("does not require JS worker injection for native, disabled or unconfigured sessions", () => {
    const service = new CDPService({}, logger as any);
    Object.assign(service, {
      launchConfig: { skipFingerprintInjection: true },
      fingerprintData: {},
      pluginManager: { getPlugin: () => ({ isReady: () => false }) },
    });
    expect(() => (service as any).assertWorkerFingerprintReady()).not.toThrow();
    Object.assign(service, { launchConfig: {}, fingerprintData: null });
    expect(() => (service as any).assertWorkerFingerprintReady()).not.toThrow();
    Object.assign(service, { fingerprintData: {}, pluginManager: { getPlugin: () => undefined } });
    expect(() => (service as any).assertWorkerFingerprintReady()).not.toThrow();
  });
});
