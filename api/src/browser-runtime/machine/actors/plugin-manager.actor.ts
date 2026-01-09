import { BrowserRef, ResolvedConfig, SupervisorEvent } from "../../types.js";
import { BrowserPlugin } from "../../plugins/base-plugin.js";

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

  // Run initialization hooks in background but with proper error handling and awaiting
  (async () => {
    // onBrowserLaunch - parallel
    await Promise.allSettled(
      plugins.map(async (plugin) => {
        try {
          if (plugin.onBrowserLaunch) {
            await plugin.onBrowserLaunch(browser.instance);
          }
        } catch (err) {
          console.error(`[PluginManager] ${plugin.name} onBrowserLaunch failed:`, err);
        }
      }),
    );

    // onBrowserReady - parallel
    await Promise.allSettled(
      plugins.map(async (plugin) => {
        try {
          if (plugin.onBrowserReady) {
            await plugin.onBrowserReady(config);
          }
        } catch (err) {
          console.error(`[PluginManager] ${plugin.name} onBrowserReady failed:`, err);
        }
      }),
    );
  })();

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
