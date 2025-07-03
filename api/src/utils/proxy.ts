import { env } from "../env.js";
import { SessionService } from "../services/session.service.js";
import { PrepareRequestFunctionOpts, PrepareRequestFunctionResult, Server } from "proxy-chain";
import { PassthroughServer } from "./passthough-proxy.js";
import http, { IncomingHttpHeaders } from "node:http";

const hopByHop = new Set([
  "connection",
  "proxy-authenticate",
  "proxy-authorization",
  "keep-alive",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const makePassthrough = function ({ request, hostname, port }: PrepareRequestFunctionOpts): NonNullable<PrepareRequestFunctionResult['customResponseFunction']> {
  return async () => {
    const proxyRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const forward = http.request(
          {
            hostname,
            port,
            method: request.method,
            path: request.url,
            headers: request.headers,
          },
          resolve,
        );
        forward.on("error", reject);
        request.pipe(forward);
      });
    
    const chunks: Buffer[] = [];
    for await (const chunk of proxyRes) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const headers: IncomingHttpHeaders = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!hopByHop.has(k.toLowerCase()) && v !== undefined) {
        headers[k] = Array.isArray(v) ? v.join(",") : v;
      }
    }
    
    return {
      statusCode: proxyRes.statusCode ?? 500,
      headers: proxyRes.headers as Record<string, string>,
      body,
    };
  };
}

export class ProxyServer extends Server {
  public url: string;
  public upstreamProxyUrl: string;
  public txBytes = 0;
  public rxBytes = 0;
  private hostConnections = new Set<number>();

  constructor(proxyUrl: string) {
    super({
      port: 0,

      prepareRequestFunction: (options) => {
        const { connectionId, hostname, request } = options;
        const url = request?.url ?? "";
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

        if (isInternalBypass) {
          
          this.hostConnections.add(connectionId);
          // return {
          //   requestAuthentication: false,
          //   upstreamProxyUrl: null, // This will ensure that events sent back to the api are not proxied
          // };

          return {
            customConnectServer: PassthroughServer,
            customResponseFunction: makePassthrough(options),
          };
        }
        return {
          requestAuthentication: false,
          upstreamProxyUrl: proxyUrl,
        };
      },
    });

    this.on("connectionClosed", ({ connectionId, stats }) => {
      if (stats && !this.hostConnections.has(connectionId)) {
        this.txBytes += stats.trgTxBytes;
        this.rxBytes += stats.trgRxBytes;
      }
      this.hostConnections.delete(connectionId);
    });

    this.url = `http://127.0.0.1:${this.port}`;
    this.upstreamProxyUrl = proxyUrl;
  }

  async listen(): Promise<void> {
    await super.listen();
    this.url = `http://127.0.0.1:${this.port}`;
  }
}

const proxyReclaimRegistry = new FinalizationRegistry((heldValue: Function) => heldValue());

export async function createProxyServer(proxyUrl: string): Promise<ProxyServer> {
  const proxy = new ProxyServer(proxyUrl);
  await proxy.listen();
  proxyReclaimRegistry.register(proxy, proxy.close);
  return proxy;
}

export async function getProxyServer(
  proxyUrl: string | null | undefined,
  session: SessionService,
): Promise<ProxyServer | null> {
  if (proxyUrl === null) {
    return null;
  }

  if (proxyUrl === undefined || proxyUrl === session.activeSession.proxyServer?.upstreamProxyUrl) {
    return session.activeSession.proxyServer ?? null;
  }

  return createProxyServer(proxyUrl);
}
