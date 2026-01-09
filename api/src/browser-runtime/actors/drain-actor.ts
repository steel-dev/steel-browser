import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { ResolvedConfig } from "../drivers/types.js";

export interface DrainInput {
  instrumentationLogger?: BrowserLogger;
  plugins: BrowserPlugin[];
  config: ResolvedConfig;
}

export async function drain(input: DrainInput): Promise<void> {
  // 1. Notify plugins of session end (best-effort, non-blocking)
  const pluginPromises = input.plugins.map(async (plugin) => {
    try {
      if (plugin.onSessionEnd) {
        await plugin.onSessionEnd(input.config);
      }
    } catch (err) {
      console.warn(`[DrainActor] Error in plugin onSessionEnd (${plugin.name}):`, err);
    }
  });

  // 2. Flush instrumentation logger
  const flushPromise = input.instrumentationLogger?.flush
    ? input.instrumentationLogger.flush()
    : Promise.resolve();

  // We wait for all to complete but don't fail if some fail
  await Promise.allSettled([...pluginPromises, flushPromise]);
}
