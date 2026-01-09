import http, { IncomingHttpHeaders } from "node:http";
import { Server, PrepareRequestFunctionOpts, PrepareRequestFunctionResult } from "proxy-chain";

// Headers that are hop-by-hop and should not be forwarded RFC 2616, Section 13.5.1
export const hopByHopHeaders = new Set([
  "connection",
  "proxy-authenticate",
  "proxy-authorization",
  "keep-alive",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Creates a simple http proxy which reverse proxies the original request to the original host.
 */
export const PassthroughServer = http.createServer((clientReq, clientRes) => {
  const targetUrl = new URL(clientReq.url ?? "/", `http://${clientReq.headers.host}`);

  const proxyHeaders: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(clientReq.headers)) {
    const lowerKey = key.toLowerCase();
    if (!hopByHopHeaders.has(lowerKey)) {
      proxyHeaders[lowerKey] = value;
    }
  }

  proxyHeaders["host"] = targetUrl.host;
  proxyHeaders["x-forwarded-for"] = clientReq.socket.remoteAddress || "";
  proxyHeaders["x-forwarded-proto"] = "http";
  proxyHeaders["x-forwarded-host"] = clientReq.headers.host || "";

  const proxyReq = http.request(
    {
      method: clientReq.method,
      headers: proxyHeaders,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
    },
    (proxyRes) => {
      const clientResHeaders = {};
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (!hopByHopHeaders.has(key.toLowerCase())) {
          clientResHeaders[key] = value;
        }
      }

      clientRes.writeHead(proxyRes.statusCode ?? 500, clientResHeaders);
      proxyRes.pipe(clientRes);
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`Proxy error for ${targetUrl}:`, err);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
    }
    clientRes.end("Proxy error: Could not connect to the target service.");
  });

  clientReq.on("error", (err) => {
    console.error(`Client request error:`, err);
    proxyReq.destroy();
  });

  clientReq.pipe(proxyReq);
});

type Result<T> = [err: Error, result: null] | [err: null, result: T];

/**
 * There's an issue with proxy-chain's handling of chunked requests when doing a direct passthrough.
 */
export const makePassthrough = function ({
  request,
  hostname,
  port,
}: PrepareRequestFunctionOpts): NonNullable<
  PrepareRequestFunctionResult["customResponseFunction"]
> {
  return async () => {
    const [err, proxyRes]: Result<http.IncomingMessage> = await new Promise((resolve) => {
      const forward = http.request(
        {
          hostname,
          port,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        (res) => resolve([null, res]),
      );

      forward.on("error", (err) => resolve([err, null]));
      request.pipe(forward);
    });

    if (err) {
      console.error(`Request failed "${err.name}": ${err.message}`);
      throw err;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of proxyRes) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    return {
      statusCode: proxyRes.statusCode ?? 500,
      headers: proxyRes.headers as Record<string, string>,
      body,
    };
  };
};

export class ProxyServer extends Server {
  public url: string;
  public txBytes = 0;
  public rxBytes = 0;
  private hostConnections = new Set<number>();

  constructor(proxyUrl: string, options: { host?: string; internalBypass?: string } = {}) {
    super({
      port: 0,
      prepareRequestFunction: (prepareOptions) => {
        const { connectionId, hostname } = prepareOptions;

        const internalBypassTests = new Set(["0.0.0.0", options.host]);

        if (options.internalBypass) {
          for (const host of options.internalBypass.split(",")) {
            internalBypassTests.add(host.trim());
          }
        }

        if (internalBypassTests.has(hostname)) {
          this.hostConnections.add(connectionId);
          return {
            customConnectServer: PassthroughServer as any,
            customResponseFunction: makePassthrough(prepareOptions),
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
  }

  async listen(): Promise<void> {
    await super.listen();
    this.url = `http://127.0.0.1:${this.port}`;
  }
}
