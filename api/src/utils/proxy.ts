import { env } from "../env.js";
import { SessionService } from "../services/session.service.js";
import http from "http";
import { createProxyServer as coreCreateProxyServer } from "http-proxy-3";

export class ProxyServer {
  public url: string;
  public upstreamProxyUrl: string;
  public txBytes = 0;
  public rxBytes = 0;

  private server: http.Server;
  private proxy = coreCreateProxyServer({});

  constructor(proxyUrl: string) {
    this.upstreamProxyUrl = proxyUrl;

    this.server = http.createServer((req, res) => {
      const hostname = req.headers.host?.split(":")[0];
      const url = req.url ?? "";
      const isEventsPath = url.endsWith("/v1/events");

      const internalBypassTests = new Set([
        "0.0.0.0",
        process.env.HOST,
      ]);

      if (env.PROXY_INTERNAL_BYPASS) {
        for (const host of env.PROXY_INTERNAL_BYPASS.split(",")) {
          internalBypassTests.add(host.trim());
        }
      }

      const isInternalBypass = internalBypassTests.has(hostname);

      if (isEventsPath) {
        console.error("Bypassing /events request:", url, hostname, isInternalBypass);
        console.error(`\x1b[1m\x1b[91m{ url: "${url}", hostname: "${hostname}", isInternalBypass: "${isInternalBypass}" }\x1b[0m`);
      }

      const target = isInternalBypass ? `http://${hostname}` : proxyUrl;

      this.proxy.web(req, res, { target }, (err) => {
        console.error("Proxy error:", err);
        res.writeHead(502);
        res.end("Proxy error");
      });

      req.on("end", () => {
        const contentLength = parseInt(req.headers["content-length"] || "0", 10);
        this.txBytes += contentLength;
      });
    });

    this.url = ""; // Set after listen()
  }

  async listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        if (typeof addr === "object" && addr?.port) {
          this.url = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  }

  close(_force?: boolean) {
    return this.server.close();
  }
}

const proxyReclaimRegistry = new FinalizationRegistry((heldValue: Function) => heldValue());

export async function createProxyServer(proxyUrl: string): Promise<ProxyServer> {
  const proxy = new ProxyServer(proxyUrl);
  await proxy.listen();
  proxyReclaimRegistry.register(proxy, () => proxy.close());
  return proxy;
}

export async function getProxyServer(
  proxyUrl: string | null | undefined,
  session: SessionService,
): Promise<ProxyServer | null> {
  if (proxyUrl === null) return null;
  if (proxyUrl === undefined || proxyUrl === session.activeSession.proxyServer?.upstreamProxyUrl) {
    return session.activeSession.proxyServer ?? null;
  }
  return createProxyServer(proxyUrl);
}
