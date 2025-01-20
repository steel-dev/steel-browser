import { SessionService } from "../services/session.service";

const ProxyChain = require("proxy-chain");

export class ProxyServer extends ProxyChain.Server {
  public url: string;
  public upstreamProxyUrl: string;
  public txBytes = 0;
  public rxBytes = 0;

  constructor(proxyUrl: string) {
    super({
      port: 0,

      prepareRequestFunction: ({ hostname }) => {
        if (hostname === process.env.HOST) {
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

    this.on("connectionClosed", ({ stats }) => {
      if (stats) {
        this.txBytes += stats.trgTxBytes;
        this.rxBytes += stats.trgRxBytes;
      }
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
