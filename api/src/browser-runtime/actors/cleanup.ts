import { BrowserRef, ProxyRef } from "../types.js";

export async function cleanup(browser: BrowserRef | null, proxy: ProxyRef | null): Promise<void> {
  console.log("[Cleanup] Starting cleanup...");

  if (browser) {
    try {
      console.log("[Cleanup] Closing browser...");
      await browser.instance.close();
    } catch (err) {
      console.warn("[Cleanup] Browser close error:", err);
    }
  }

  if (proxy) {
    try {
      console.log("[Cleanup] Closing proxy...");
      await proxy.close();
    } catch (err) {
      console.warn("[Cleanup] Proxy close error:", err);
    }
  }

  console.log("[Cleanup] Complete");
}
