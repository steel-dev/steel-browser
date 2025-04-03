import { Browser, Page } from "puppeteer-core";
import { CDPService } from "../../cdp.service";
import { BasePlugin, PluginOptions } from "./base-plugin";
import { FastifyBaseLogger } from "fastify";

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
   * Notify all plugins about a browser launch
   */
  public async onBrowserLaunch(browser: Browser): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.onBrowserLaunch(browser);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBrowserLaunch: ${error}`);
      }
    }
  }

  /**
   * Notify all plugins about a page creation
   */
  public async onPageCreated(page: Page): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.onPageCreated(page);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onPageCreated: ${error}`);
      }
    }
  }

  /**
   * Notify all plugins before browser closes
   */
  public async onBrowserClose(browser: Browser): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.onBrowserClose(browser);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBrowserClose: ${error}`);
      }
    }
  }

  /**
   * Notify all plugins before a page closes
   */
  public async onBeforePageClose(page: Page): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.onBeforePageClose(page);
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onBeforePageClose: ${error}`);
      }
    }
  }

  /**
   * Notify all plugins about shutdown
   */
  public async onShutdown(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.onShutdown();
      } catch (error) {
        this.logger.error(`Error in plugin ${plugin.name}.onShutdown: ${error}`);
      }
    }
  }
}
