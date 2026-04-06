import type { Browser, Page } from "puppeteer-core";
import type { CDPService } from "../../cdp.service.js";
import type { BrowserLauncherOptions } from "../../../../types/browser.js";

/**
 * Reason why the browser is being shut down.
 * Plugins can use this to decide what cleanup actions to take.
 */
export enum ShutdownReason {
  /** Normal session end — user or system ended the session gracefully */
  SESSION_END = "session_end",
  /** Security violation detected (e.g. file:// protocol access) */
  SECURITY_VIOLATION = "security_violation",
  /** Browser is being relaunched (closing old instance before new launch) */
  RELAUNCH = "relaunch",
  /** Browser launch failed — cleanup before retry */
  LAUNCH_FAILURE = "launch_failure",
  /** Switching to a different browser mode (e.g. CDP → Selenium) */
  MODE_SWITCH = "mode_switch",
}

export interface PluginOptions {
  name: string;
  [key: string]: any;
}

export abstract class BasePlugin {
  public name: string;
  protected options: PluginOptions;
  protected cdpService: CDPService | null;

  constructor(options: PluginOptions) {
    this.name = options.name;
    this.options = options;
    this.cdpService = null;
  }

  public setService(service: CDPService): void {
    this.cdpService = service;
  }

  // Lifecycle methods
  public onSessionStart(sessionConfig: BrowserLauncherOptions): void | Promise<void> {}
  public onBeforeSessionEnd(sessionConfig: BrowserLauncherOptions): void | Promise<void> {}
  public onAfterSessionEnd(sessionConfig: BrowserLauncherOptions): void | Promise<void> {}
  public async onBrowserLaunch(browser: Browser): Promise<void> {}
  public onBrowserReady(context: BrowserLauncherOptions): void | Promise<void> {}
  public async onPageCreated(page: Page): Promise<void> {}
  public async onPageNavigate(page: Page): Promise<void> {}
  public async onPageUnload(page: Page): Promise<void> {}
  public async onBrowserClose(browser: Browser): Promise<void> {}
  public async onBeforePageClose(page: Page): Promise<void> {}
  public async onShutdown(reason: ShutdownReason): Promise<void> {}
  public async onSessionEnd(sessionConfig: BrowserLauncherOptions): Promise<void> {}
}

export type { BrowserLauncherOptions };
