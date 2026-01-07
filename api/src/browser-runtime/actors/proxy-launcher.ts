import { ProxyRef, ResolvedConfig } from "../types.js";
import { ProxyServer } from "./proxy.js";

export async function launchProxy(config: ResolvedConfig): Promise<ProxyRef | null> {
  if (!config.proxyUrl) {
    return null;
  }

  const proxy = new ProxyServer(config.proxyUrl, {
    host: config.host,
    internalBypass: config.internalBypass,
  });

  await proxy.listen();

  return {
    url: proxy.url,
    close: async () => {
      await proxy.close(true);
    },
  };
}
