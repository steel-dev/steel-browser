import { BrowserRef, ResolvedConfig, SupervisorEvent } from "../types.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";

export interface PluginManagerInput {
  browser: BrowserRef;
  config: ResolvedConfig;
  plugins: BrowserPlugin[];
}

export function startPluginManager(
  input: PluginManagerInput,
  sendBack: (event: SupervisorEvent) => void,
): () => void {
  const { browser, config, plugins } = input;

  // Sync/Async: onBrowserLaunch
  plugins.forEach(async (plugin) => {
    try {
      await Promise.resolve(plugin.onBrowserLaunch?.(browser.instance));
    } catch (err) {
      console.error(`[PluginManager] ${plugin.name} onBrowserLaunch failed:`, err);
    }
  });

  // Sync/Async: onBrowserReady
  plugins.forEach(async (plugin) => {
    try {
      await Promise.resolve(plugin.onBrowserReady?.(config));
    } catch (err) {
      console.error(`[PluginManager] ${plugin.name} onBrowserReady failed:`, err);
    }
  });

  const targetCreatedHandler = async (target: any) => {
    if (target.type() === "page") {
      const page = await target.page();
      if (page) {
        for (const plugin of plugins) {
          try {
            await Promise.resolve(plugin.onPageCreated?.(page));
          } catch (err) {
            console.error(`[PluginManager] ${plugin.name} onPageCreated failed:`, err);
          }
        }
      }
    }
  };

  browser.instance.on("targetcreated", targetCreatedHandler);

  return async () => {
    console.log("[PluginManager] Shutting down");
    browser.instance.off("targetcreated", targetCreatedHandler);
  };
}
