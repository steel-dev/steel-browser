import { env } from "../env.js";
import { SessionService } from "../services/session.service.js";
import { Server } from "proxy-chain";

export class ProxyServer extends Server {
  public url: string;
  public upstreamProxyUrl: string;
  public txBytes = 0;
  public rxBytes = 0;
  private hostConnections = new Set<number>();

  constructor(proxyUrl: string) {
    super({
      port: 0,

      prepareRequestFunction: ({ connectionId, hostname }) => {
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

        if (isInternalBypass) {
          this.hostConnections.add(connectionId);
          return {
            requestAuthentication: false,
            upstreamProxyUrl: null, // This will ensure that events sent back to the api are not proxied
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
