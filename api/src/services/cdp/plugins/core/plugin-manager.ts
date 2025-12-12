import { Browser, Page } from "puppeteer-core";
import { CDPService } from "../../cdp.service.js";
import { BasePlugin } from "./base-plugin.js";
import { FastifyBaseLogger } from "fastify";
import { BrowserLauncherOptions } from "../../../../types/browser.js";

export class PluginManager {
  private plugins: Map<string, BasePlugin>;
  private service: CDPService;
  private logger: FastifyBaseLogger;

  constructor(service: CDPService, logger: FastifyBaseLogger) {
    this.plugins = new Map();
    this.service = service;
    this.logger = logger;
  }

  /**
   * Register a plugin with the plugin manager
   */
  public register(plugin: BasePlugin): void {
    if (this.plugins.has(plugin.name)) {
      this.logger.warn(`Plugin with name ${plugin.name} is already registered. Overwriting.`);
    }

    plugin.setService(this.service);
    this.plugins.set(plugin.name, plugin);
    this.logger.info(`Registered plugin: ${plugin.name}`);
  }

  /**
   * Unregister a plugin from the plugin manager
   */
  public unregister(pluginName: string): boolean {
    const result = this.plugins.delete(pluginName);
    if (result) {
      this.logger.info(`Unregistered plugin: ${pluginName}`);
    } else {
      this.logger.warn(`Plugin with name ${pluginName} was not registered`);
    }
    return result;
  }

  /**
   * Get a plugin by name
   */
  public getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return this.plugins.get(pluginName) as T | undefined;
  }

  /**
   * Track async plugin tasks and surface errors
   */
  public waitUntil(task: Promise<void>): void {
    task.catch((error) => {
      this.logger.error({ err: error }, "Plugin task failed in waitUntil");
    });
  }

  /**
   * Notify all plugins about a browser launch
   */
  public async onBrowserLaunch(browser: Browser): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onBrowserLaunch(browser);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBrowserLaunch: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  public async onBrowserReady(context: BrowserLauncherOptions): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        // handle both async and sync hooks
        await Promise.resolve(plugin.onBrowserReady(context));
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBrowserReady: ${error}`);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Notify all plugins about a page creation
   */
  public async onPageCreated(page: Page): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onPageCreated(page);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onPageCreated: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins before browser closes
   */
  public async onBrowserClose(browser: Browser): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onBrowserClose(browser);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBrowserClose: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins before a page navigates
   */
  public async onPageNavigate(page: Page): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onPageNavigate(page);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onPageNavigate: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins before a page unloads
   */
  public async onPageUnload(page: Page): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onPageUnload(page);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onPageUnload: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins before a page closes
   */
  public async onBeforePageClose(page: Page): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onBeforePageClose(page);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBeforePageClose: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins about shutdown
   */
  public async onShutdown(): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onShutdown();
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onShutdown: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins when a session has ended
   */
  public async onSessionEnd(sessionConfig: BrowserLauncherOptions): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onSessionEnd(sessionConfig);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onSessionEnd: ${error}`);
      }
    });
    await Promise.all(promises);
  }
}
