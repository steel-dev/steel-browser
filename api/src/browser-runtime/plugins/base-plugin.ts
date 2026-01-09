import { Browser, Page } from "puppeteer-core";
import { RuntimeConfig } from "../types.js";

export interface BrowserPlugin {
  name: string;
  onBrowserLaunch?(browser: Browser): Promise<void> | void;
  onBrowserReady?(config: RuntimeConfig): Promise<void> | void;
  onPageCreated?(page: Page): Promise<void> | void;
  onBrowserClose?(browser: Browser): Promise<void> | void;
  onBeforePageClose?(page: Page): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
  onSessionEnd?(config: RuntimeConfig): Promise<void> | void;
}
