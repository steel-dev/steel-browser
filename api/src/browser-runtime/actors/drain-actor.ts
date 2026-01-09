import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { BrowserRef, ResolvedConfig } from "../drivers/types.js";
import { TaskRegistryRef } from "./task-registry.js";

export interface DrainInput {
  instrumentationLogger?: BrowserLogger;
  plugins: BrowserPlugin[];
  config: ResolvedConfig;
  browser: BrowserRef | null;
  taskRegistry: TaskRegistryRef | null;
}

export async function drain(input: DrainInput): Promise<void> {
  // 1. Drain pending background tasks
  if (input.taskRegistry) {
    await input.taskRegistry.drain(5000);
  }

  // 2. Notify plugins of browser close
  if (input.browser) {
    const closePromises = input.plugins.map(async (plugin) => {
      try {
        if (plugin.onBrowserClose) {
          await plugin.onBrowserClose(input.browser!.instance);
        }
      } catch (err) {
        console.warn(`[DrainActor] Error in plugin onBrowserClose (${plugin.name}):`, err);
      }
    });
    await Promise.allSettled(closePromises);
  }

  // 3. Notify plugins of session end (best-effort, non-blocking)
  const pluginPromises = input.plugins.map(async (plugin) => {
    try {
      if (plugin.onSessionEnd) {
        await plugin.onSessionEnd(input.config);
      }
    } catch (err) {
      console.warn(`[DrainActor] Error in plugin onSessionEnd (${plugin.name}):`, err);
    }
  });

  // 3. Flush instrumentation logger
  const flushPromise = input.instrumentationLogger?.flush
    ? input.instrumentationLogger.flush()
    : Promise.resolve();

  // We wait for all to complete but don't fail if some fail
  await Promise.allSettled([...pluginPromises, flushPromise]);

  // 4. Cancel any remaining tasks
  if (input.taskRegistry) {
    input.taskRegistry.cancelAll("session-end");
  }
}
