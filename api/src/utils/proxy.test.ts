import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

vi.mock("../env.js", () => ({ env: {} }));

import { ProxyServer } from "./proxy.js";

describe("ProxyServer close", () => {
  async function listen(server: net.Server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as net.AddressInfo).port;
  }

  async function tunnel(proxyPort: number, target: string, size: number) {
    const req = http.request({
      host: "127.0.0.1",
      port: proxyPort,
      method: "CONNECT",
      path: target,
      agent: false,
    });
    req.end();
    const [, socket] = (await once(req, "connect")) as [http.IncomingMessage, net.Socket];
    socket.on("error", () => undefined);
    let echoed = 0;
    socket.on("data", (chunk: Buffer) => {
      echoed += chunk.length;
    });
    socket.write(Buffer.alloc(size));
    await vi.waitFor(() => expect(echoed).toBe(size));
  }

  it("settles bytes for the connections it force-closes", async () => {
    const echo = net.createServer((socket) => {
      socket.on("error", () => undefined);
      socket.pipe(socket);
    });
    const echoPort = await listen(echo);
    const upstream = http.createServer();
    upstream.on("connect", (_req, client) => {
      client.on("error", () => undefined);
      const target = net.connect(echoPort, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        target.pipe(client).pipe(target);
      });
      target.on("error", () => client.destroy());
    });
    const upstreamPort = await listen(upstream);
    const server = new ProxyServer(`http://user:pass@127.0.0.1:${upstreamPort}`);
    await server.listen();

    try {
      await tunnel(server.port, "example.com:443", 1_000);
      const stats = server.getConnectionStats(server.getConnectionIds()[0])!;
      expect(stats.trgRxBytes).toBeGreaterThan(1_000);

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => server.close(true).then(resolve, reject), 0);
      });

      expect({ tx: server.txBytes, rx: server.rxBytes }).toEqual({
        tx: stats.trgTxBytes,
        rx: stats.trgRxBytes,
      });
    } finally {
      await server.close(true).catch(() => undefined);
      upstream.close();
      echo.close();
    }
  });
});
