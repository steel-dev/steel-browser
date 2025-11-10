import { Browser, Page } from "puppeteer-core";
import { CDPService } from "../../cdp.service.js";
import { BasePlugin } from "./base-plugin.js";
import { FastifyBaseLogger } from "fastify";
import { BrowserLauncherOptions } from "../../../../types/browser.js";

export class PluginManager {
  private plugins: Map<string, BasePlugin>;
  private service: CDPService;
  private logger: FastifyBaseLogger;
  private pending: Set<Promise<void>>;

  constructor(service: CDPService, logger: FastifyBaseLogger) {
    this.plugins = new Map();
    this.service = service;
    this.logger = logger;
    this.pending = new Set();
  }

  /**
   * Track a background task without blocking
   */
  private track(task: Promise<void>): void {
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
  }

  /**
   * Schedule a background task to complete before session teardown
   */
  public waitUntil(task: Promise<void>): void {
    this.track(task);
  }

  /**
   * Wait for all pending background tasks to complete, with timeout
   */
  public async drainPending(timeoutMs: number = 5000): Promise<void> {
    const tasks = Array.from(this.pending);
    if (tasks.length === 0) {
      this.logger.debug("[PluginManager] No pending tasks to drain");
      return;
    }

    this.logger.info(
      `[PluginManager] Draining ${tasks.length} pending tasks (timeout: ${timeoutMs}ms)`,
    );

    const allSettled = Promise.allSettled(tasks).then(() => undefined);
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("PluginManager drain timeout")), timeoutMs),
    );

    try {
      await Promise.race([allSettled, timeout]);
      this.logger.info("[PluginManager] All pending tasks drained successfully");
    } catch (err) {
      this.logger.warn(
        `[PluginManager] Drain timed out after ${timeoutMs}ms with ${this.pending.size} tasks still pending`,
      );
    }
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
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onBrowserLaunch(browser);
      } catch (error) {
        this.logger.error(
          { err: error },
          `Error in plugin ${plugin.name}.onBrowserLaunch: ${error}`,
        );
      }
    });
    await Promise.all(promises);
  }

  public onBrowserReady(context: BrowserLauncherOptions): void {
    for (const plugin of this.plugins.values()) {
      this.logger.debug(`[PluginManager] Scheduling onBrowserReady for plugin: ${plugin.name}`);
      const task = Promise.resolve()
        .then(() => plugin.onBrowserReady(context))
        .catch((error) => {
          this.logger.error(
            { err: error },
            `Error in plugin ${plugin.name}.onBrowserReady: ${error}`,
          );
        });
      this.track(task);
    }
  }

  /**
   * Notify all plugins about a page creation
   */
  public async onPageCreated(page: Page): Promise<void> {
    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onPageCreated(page);
      } catch (error) {
        this.logger.error({ err: error }, `Error in plugin ${plugin.name}.onPageCreated: ${error}`);
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
        this.logger.error(
          { err: error },
          `Error in plugin ${plugin.name}.onBrowserClose: ${error}`,
        );
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
        this.logger.error(
          { err: error },
          `Error in plugin ${plugin.name}.onPageNavigate: ${error}`,
        );
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
        this.logger.error({ err: error }, `Error in plugin ${plugin.name}.onPageUnload: ${error}`);
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
        this.logger.error(
          { err: error },
          `Error in plugin ${plugin.name}.onBeforePageClose: ${error}`,
        );
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
        this.logger.error({ err: error }, `Error in plugin ${plugin.name}.onShutdown: ${error}`);
      }
    });
    await Promise.all(promises);
  }

  /**
   * Notify all plugins when a session has ended
   */
  public async onSessionEnd(sessionConfig: BrowserLauncherOptions): Promise<void> {
    const pluginNames = Array.from(this.plugins.keys());
    this.logger.debug(
      `[PluginManager] Invoking onSessionEnd for ${pluginNames.length} plugins: ${pluginNames.join(
        ", ",
      )}`,
    );

    const promises = Array.from(this.plugins.values()).map(async (plugin) => {
      try {
        await plugin.onSessionEnd(sessionConfig);
      } catch (error) {
        this.logger.error({ err: error }, `Error in plugin ${plugin.name}.onSessionEnd: ${error}`);
      }
    });
    await Promise.all(promises);
  }
}
