import type { Browser, Page } from "puppeteer-core";
import type { CDPService } from "../../cdp.service.js";
import type { BrowserLauncherOptions } from "../../../../types/browser.js";
import type { BrowserLogger } from "../../../../plugins/logging/browser-logger.js";

export interface PluginOptions {
  name: string;
  [key: string]: any;
}

export interface PluginContext {
  logger: BrowserLogger;
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
  public async onBrowserLaunch(browser: Browser): Promise<void>;
  public async onBrowserLaunch(browser: Browser, ctx: PluginContext): Promise<void>;
  public async onBrowserLaunch(browser: Browser, ctx?: PluginContext): Promise<void> {}

  public onBrowserReady(context: BrowserLauncherOptions): void;
  public onBrowserReady(context: BrowserLauncherOptions, ctx: PluginContext): void;
  public onBrowserReady(context: BrowserLauncherOptions, ctx?: PluginContext): void {}

  public async onPageCreated(page: Page): Promise<void>;
  public async onPageCreated(page: Page, ctx: PluginContext): Promise<void>;
  public async onPageCreated(page: Page, ctx?: PluginContext): Promise<void> {}

  public async onPageNavigate(page: Page): Promise<void>;
  public async onPageNavigate(page: Page, ctx: PluginContext): Promise<void>;
  public async onPageNavigate(page: Page, ctx?: PluginContext): Promise<void> {}

  public async onPageUnload(page: Page): Promise<void>;
  public async onPageUnload(page: Page, ctx: PluginContext): Promise<void>;
  public async onPageUnload(page: Page, ctx?: PluginContext): Promise<void> {}

  public async onBrowserClose(browser: Browser): Promise<void>;
  public async onBrowserClose(browser: Browser, ctx: PluginContext): Promise<void>;
  public async onBrowserClose(browser: Browser, ctx?: PluginContext): Promise<void> {}

  public async onBeforePageClose(page: Page): Promise<void>;
  public async onBeforePageClose(page: Page, ctx: PluginContext): Promise<void>;
  public async onBeforePageClose(page: Page, ctx?: PluginContext): Promise<void> {}

  public async onShutdown(): Promise<void>;
  public async onShutdown(ctx: PluginContext): Promise<void>;
  public async onShutdown(ctx?: PluginContext): Promise<void> {}

  public async onSessionEnd(sessionConfig: BrowserLauncherOptions): Promise<void>;
  public async onSessionEnd(
    sessionConfig: BrowserLauncherOptions,
    ctx: PluginContext,
  ): Promise<void>;
  public async onSessionEnd(
    sessionConfig: BrowserLauncherOptions,
    ctx?: PluginContext,
  ): Promise<void> {}
}

export type { BrowserLauncherOptions };
