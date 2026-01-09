import { BrowserLauncher, BrowserRef, ProxyRef } from "../drivers/types.js";
import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { traceOperation } from "../tracing/index.js";

export async function closeBrowser(input: {
  launcher: BrowserLauncher;
  browser: BrowserRef | null;
}): Promise<void> {
  await traceOperation("browser.cleanup.closeBrowser", "detailed", async (span) => {
    if (input.browser) {
      await input.launcher.close(input.browser);
    }
  });
}

export async function closeProxy(input: { proxy: ProxyRef | null }): Promise<void> {
  await traceOperation("browser.cleanup.closeProxy", "detailed", async (span) => {
    if (input.proxy) {
      await input.proxy.close();
    }
  });
}

export async function flushLogs(input: { instrumentationLogger?: BrowserLogger }): Promise<void> {
  await traceOperation("browser.cleanup.flushLogs", "detailed", async (span) => {
    if (input.instrumentationLogger?.flush) {
      await input.instrumentationLogger.flush();
    }
  });
}

export async function notifyPluginsShutdown(input: { plugins: BrowserPlugin[] }): Promise<void> {
  await traceOperation("browser.cleanup.notifyPluginsShutdown", "detailed", async (span) => {
    const promises = input.plugins.map(async (plugin) => {
      try {
        if (plugin.onShutdown) {
          await plugin.onShutdown();
        }
      } catch (err) {
        console.warn(`[Cleanup] Error in plugin onShutdown (${plugin.name}):`, err);
      }
    });
    await Promise.allSettled(promises);
  });
}
