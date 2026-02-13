import { describe, it, expect, vi, beforeEach } from "vitest";
import { launchProxy } from "../proxy-launcher.actor.js";
import { ProxyServer } from "../../../services/proxy.service.js";

vi.mock("../../../services/proxy.service.js", () => ({
  ProxyServer: vi.fn().mockImplementation(() => ({
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    url: "http://local-proxy:1234",
  })),
}));

describe("Proxy Launcher Actor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null if no proxyUrl is provided", async () => {
    const config = { proxyUrl: undefined } as any;
    const result = await launchProxy(config);
    expect(result).toBeNull();
  });

  it("should launch proxy if proxyUrl is provided", async () => {
    const config = { proxyUrl: "http://upstream:8080", host: "0.0.0.0" } as any;
    const result = await launchProxy(config);

    expect(ProxyServer).toHaveBeenCalledWith(
      "http://upstream:8080",
      expect.objectContaining({ host: "0.0.0.0" }),
    );
    expect(result).toBeDefined();
    expect(result?.url).toBe("http://local-proxy:1234");
  });

  it("should close proxy when close is called", async () => {
    const config = { proxyUrl: "http://upstream:8080" } as any;
    const result = await launchProxy(config);

    await result?.close();

    const mockProxyInstance = vi.mocked(ProxyServer).mock.results[0].value;
    expect(mockProxyInstance.close).toHaveBeenCalledWith(true);
  });
});
