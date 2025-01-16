import proxyChain from "proxy-chain";

export class ProxyServer extends proxyChain.Server {
  public url: string;
  public upstreamProxyUrl: string;
  public txBytes = 0;
  public rxBytes = 0;

  constructor(proxyUrl: string) {
    super({
      host: '127.0.0.1',

      prepareRequestFunction: () => {
        return {
          requestAuthentication: false,
          upstreamProxyUrl: proxyUrl,
        };
      },
    });

    this.on('connectionClosed', ({ stats }) => {
      this.txBytes += stats.trgTxBytes;
      this.rxBytes += stats.trgRxBytes;
    });

    this.url = `http://127.0.0.1:${this.port}`
    this.upstreamProxyUrl = proxyUrl;
  };
}
