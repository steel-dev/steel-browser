import { BrowserLauncher, BrowserRef, ProxyRef } from "../drivers/types.js";
import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
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
