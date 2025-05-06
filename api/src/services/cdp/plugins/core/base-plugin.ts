import { Browser, Page } from "puppeteer-core";
import { CDPService } from "../../cdp.service.js";

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
  public async onBrowserLaunch(browser: Browser): Promise<void> {}
  public async onPageCreated(page: Page): Promise<void> {}
  public async onPageNavigate(page: Page): Promise<void> {}
  public async onPageUnload(page: Page): Promise<void> {}
  public async onBrowserClose(browser: Browser): Promise<void> {}
  public async onBeforePageClose(page: Page): Promise<void> {}
  public async onShutdown(): Promise<void> {}
}
