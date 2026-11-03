import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import net from "node:net";
import plugin, { parseUpgradeParams } from "./browser-socket.js";

describe("parseUpgradeParams", () => {
  it("reads query params from a normal upgrade path", () => {
    expect(parseUpgradeParams("/v1/sessions/cast?pageId=abc&tabInfo=true")).toEqual({
      pageId: "abc",
      tabInfo: "true",
    });
    expect(parseUpgradeParams("")).toEqual({});
  });

  it.each(["//a b/x", "//[/x", "//%zz/", "http://[x/", "//:99999/"])(
    "returns null instead of throwing for %s",
    (url) => {
      expect(parseUpgradeParams(url)).toBeNull();
    },
  );
});

function makeFastify() {
  const server = new EventEmitter();
  return {
    cdpService: {
      isRunning: () => true,
      proxyWebSocket: vi.fn().mockResolvedValue(undefined),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    decorate: vi.fn(),
    server,
  } as any;
}

async function upgradeHandlerFor(fastify: any, options: any = {}) {
  await (plugin as any)(fastify, options);
  const handlers = fastify.server.listeners("upgrade");
  if (handlers.length === 0) throw new Error("upgrade handler not registered");
  return handlers[0] as (req: any, socket: any, head: Buffer) => Promise<void>;
}

function fakeSocket() {
  const sock: any = new EventEmitter();
  sock.destroyed = false;
  sock.writable = true;
  sock.endedWith = undefined;
  sock.end = vi.fn((data: string, cb?: () => void) => {
    sock.endedWith = data;
    if (cb) queueMicrotask(cb);
    return sock;
  });
  sock.destroy = vi.fn(() => {
    sock.destroyed = true;
    return sock;
  });
  sock.resetAndDestroy = vi.fn(() => {
    sock.destroyed = true;
    return sock;
  });
  return sock;
}

const BAD_REQUEST_400 = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

describe("upgrade handler hardening", () => {
  it("rejects a malformed target with a framed 400 and never invokes the handler", async () => {
    const fastify = makeFastify();
    const upgrade = await upgradeHandlerFor(fastify);
    const sock = fakeSocket();

    await upgrade({ url: "//[/x", headers: {} }, sock, Buffer.alloc(0));
    await vi.waitFor(() => expect(sock.destroy).toHaveBeenCalled());

    expect(sock.endedWith).toBe(BAD_REQUEST_400);
    expect(fastify.cdpService.proxyWebSocket).not.toHaveBeenCalled();
    expect(fastify.log.warn).toHaveBeenCalledWith(
      { url: "//[/x" },
      "Rejecting invalid upgrade target",
    );
    // Log hygiene: upgrade notice only fires after the params guard passes.
    expect(fastify.log.info).not.toHaveBeenCalledWith("Upgrading browser socket...");
    expect(fastify.log.error).not.toHaveBeenCalled();
  });

  it("truncates the logged attack string instead of logging it raw", async () => {
    const fastify = makeFastify();
    const upgrade = await upgradeHandlerFor(fastify);
    const sock = fakeSocket();
    const longBad = "//[/" + "x".repeat(500);

    await upgrade({ url: longBad, headers: {} }, sock, Buffer.alloc(0));
    await vi.waitFor(() => expect(sock.destroy).toHaveBeenCalled());

    const loggedUrl = (fastify.log.warn.mock.calls[0]?.[0] as any)?.url;
    expect(typeof loggedUrl).toBe("string");
    expect(loggedUrl.length).toBeLessThanOrEqual(200);
    expect(sock.endedWith).toBe(BAD_REQUEST_400);
  });

  it("skips the 400 write when the socket is already gone", async () => {
    const fastify = makeFastify();
    const upgrade = await upgradeHandlerFor(fastify);
    const sock = fakeSocket();
    sock.destroyed = true;
    sock.writable = false;

    await upgrade({ url: "//[/x", headers: {} }, sock, Buffer.alloc(0));
    expect(sock.end).not.toHaveBeenCalled();
    expect(fastify.log.warn).toHaveBeenCalled();
  });

  it("writes the 400 over a real socket for a malformed target", async () => {
    const fastify = makeFastify();
    const upgrade = await upgradeHandlerFor(fastify);
    const server = net.createServer();
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as net.AddressInfo).port;
      const serverSocketP = new Promise<net.Socket>((resolve) =>
        server.once("connection", resolve),
      );
      const client = net.connect(port, "127.0.0.1");
      const serverSocket = await serverSocketP;

      await upgrade({ url: "//[/x", headers: {} }, serverSocket as any, Buffer.alloc(0));

      const received = await new Promise<string>((resolve) => {
        let buf = "";
        client.on("data", (chunk) => {
          buf += chunk.toString();
        });
        client.on("close", () => resolve(buf));
        setTimeout(() => resolve(buf), 1000);
      });

      expect(received).toBe(BAD_REQUEST_400);
      expect(fastify.cdpService.proxyWebSocket).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(serverSocket.destroyed).toBe(true));
      client.destroy();
    } finally {
      server.close();
    }
  });

  it("is Host-independent: a bad Host header never crashes and valid paths still delegate", async () => {
    const fastify = makeFastify();
    const upgrade = await upgradeHandlerFor(fastify);

    const bad = fakeSocket();
    await expect(
      upgrade({ url: "//[/x", headers: { host: "a b" } }, bad, Buffer.alloc(0)),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(bad.destroy).toHaveBeenCalled());
    expect(bad.endedWith).toBe(BAD_REQUEST_400);
    expect(fastify.log.error).not.toHaveBeenCalled();

    const valid = fakeSocket();
    await upgrade({ url: "/cdp?x=1", headers: { host: "a b" } }, valid, Buffer.alloc(0));
    expect(fastify.cdpService.proxyWebSocket).toHaveBeenCalledTimes(1);
    expect(valid.end).not.toHaveBeenCalled();
  });

  it("survives rapid client resets after malformed upgrades", async () => {
    const fastify = makeFastify();
    const upgrade = await upgradeHandlerFor(fastify);

    for (let i = 0; i < 30; i++) {
      const sock = fakeSocket();
      const pending = upgrade({ url: "//[/x", headers: {} }, sock, Buffer.alloc(0));
      sock.resetAndDestroy();
      sock.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      await pending;
    }
    await new Promise((resolve) => setImmediate(resolve));

    // The L49 error listener absorbed every reset.
    expect(fastify.log.debug).toHaveBeenCalledWith(
      expect.anything(),
      "Upgrade socket error",
    );

    const valid = fakeSocket();
    await upgrade({ url: "/cdp?ok=1", headers: {} }, valid, Buffer.alloc(0));
    expect(fastify.cdpService.proxyWebSocket).toHaveBeenCalledTimes(1);
  });

  it("delegates valid targets to the matched handler", async () => {
    const fastify = makeFastify();
    const handlerMock = vi.fn().mockResolvedValue(undefined);
    const upgrade = await upgradeHandlerFor(fastify, {
      customHandlers: [{ path: "/test-valid", handler: handlerMock }],
    });
    const sock = fakeSocket();

    await upgrade({ url: "/test-valid?x=1", headers: {} }, sock, Buffer.alloc(0));

    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(sock.end).not.toHaveBeenCalled();
    expect(fastify.log.info).toHaveBeenCalledWith("Upgrading browser socket...");
  });
});
