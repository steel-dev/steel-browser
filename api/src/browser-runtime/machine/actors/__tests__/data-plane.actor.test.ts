import { describe, it, expect, vi, beforeEach } from "vitest";
import { startDataPlane } from "../data-plane.actor.js";
import http from "node:http";
import { WebSocketServer } from "ws";

vi.mock("node:http", () => ({
  default: {
    createServer: vi.fn().mockReturnValue({
      listen: vi.fn().mockImplementation((port, host, cb) => cb?.()),
      close: vi.fn(),
      on: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 3000 }),
    }),
  },
}));

vi.mock("ws", () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    handleUpgrade: vi.fn(),
    close: vi.fn(),
  })),
  WebSocket: vi.fn(),
}));

describe("Data Plane Actor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start http server on correct port", async () => {
    const config = { port: 3000, dataPlanePort: 4000 } as any;
    const browser = { wsEndpoint: "ws://b" } as any;
    const launcher = { onDisconnected: vi.fn(() => () => {}) } as any;
    const sendBack = vi.fn();

    const stop = startDataPlane({ browser, config, launcher }, sendBack);

    expect(http.createServer).toHaveBeenCalled();
    const server = vi.mocked(http.createServer).mock.results[0].value;
    expect(server.listen).toHaveBeenCalledWith(4000, "0.0.0.0", expect.any(Function));

    stop();
    expect(server.close).toHaveBeenCalled();
  });

  it("should handle EADDRINUSE error", async () => {
    const config = { port: 3000 } as any;
    const browser = { wsEndpoint: "ws://b" } as any;
    const launcher = { onDisconnected: vi.fn(() => () => {}) } as any;
    const sendBack = vi.fn();

    startDataPlane({ browser, config, launcher }, sendBack);

    const server = vi.mocked(http.createServer).mock.results[0].value;
    const errorHandler = server.on.mock.calls.find((c) => c[0] === "error")[1];

    errorHandler({ code: "EADDRINUSE" });

    expect(sendBack).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "FATAL_ERROR",
        error: expect.objectContaining({ message: expect.stringContaining("already in use") }),
      }),
    );
  });

  it("should handle browser disconnect", async () => {
    const config = { port: 3000 } as any;
    const browser = { wsEndpoint: "ws://b" } as any;
    const launcher = { onDisconnected: vi.fn() } as any;
    const sendBack = vi.fn();

    startDataPlane({ browser, config, launcher }, sendBack);

    const disconnectHandler = launcher.onDisconnected.mock.calls[0][1];
    disconnectHandler();

    expect(sendBack).toHaveBeenCalledWith(expect.objectContaining({ type: "BROWSER_CRASHED" }));
  });
});
