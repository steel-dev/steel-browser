import { FastifyBaseLogger } from "fastify";
import { SessionState, RuntimeEvent, SessionContext, TransitionHook } from "./types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { BrowserLauncherOptions } from "../types/browser.js";

export class PluginAdapter implements TransitionHook {
  private plugins: Map<string, BasePlugin>;
  private logger: FastifyBaseLogger;
  private orchestrator: any; // Will be set by orchestrator

  constructor(logger: FastifyBaseLogger) {
    this.plugins = new Map();
    this.logger = logger.child({ component: "PluginAdapter" });
  }

  public setOrchestrator(orchestrator: any): void {
    this.orchestrator = orchestrator;
  }

  public register(plugin: BasePlugin): void {
    if (this.plugins.has(plugin.name)) {
      this.logger.warn(`Plugin with name ${plugin.name} is already registered. Overwriting.`);
    }

    // Set the service reference to the orchestrator
    if (this.orchestrator) {
      plugin.setService(this.orchestrator);
    }

    this.plugins.set(plugin.name, plugin);
    this.logger.info(`Registered plugin: ${plugin.name}`);
  }

  public unregister(pluginName: string): boolean {
    const result = this.plugins.delete(pluginName);
    if (result) {
      this.logger.info(`Unregistered plugin: ${pluginName}`);
    } else {
      this.logger.warn(`Plugin with name ${pluginName} was not registered`);
    }
    return result;
  }

  public getPlugin<T extends BasePlugin>(pluginName: string): T | undefined {
    return this.plugins.get(pluginName) as T | undefined;
  }

  async onEnter(state: SessionState, ctx: SessionContext): Promise<void> {
    if (state === SessionState.Launching && ctx.browser) {
      // onBrowserLaunch
      const promises = Array.from(this.plugins.values()).map(async (plugin) => {
        try {
          await plugin.onBrowserLaunch(ctx.browser!);
        } catch (error) {
          this.logger.error(
            { err: error },
            `Error in plugin ${plugin.name}.onBrowserLaunch: ${error}`,
          );
        }
      });
      await Promise.all(promises);
    }

    if (state === SessionState.Ready && ctx.config) {
      // onBrowserReady (non-blocking)
      for (const plugin of this.plugins.values()) {
        this.logger.debug(`[PluginAdapter] Scheduling onBrowserReady for plugin: ${plugin.name}`);
        const task = Promise.resolve()
          .then(() => plugin.onBrowserReady(ctx.config!))
          .catch((error) => {
            this.logger.error(
              { err: error },
              `Error in plugin ${plugin.name}.onBrowserReady: ${error}`,
            );
          });
        // Note: This would need access to scheduler - we'll handle this in orchestrator
      }
    }
  }

  async onExit(state: SessionState, ctx: SessionContext): Promise<void> {
    if (state === SessionState.Live && ctx.config) {
      // onSessionEnd
      const pluginNames = Array.from(this.plugins.keys());
      this.logger.debug(
        `[PluginAdapter] Invoking onSessionEnd for ${
          pluginNames.length
        } plugins: ${pluginNames.join(", ")}`,
      );

      const promises = Array.from(this.plugins.values()).map(async (plugin) => {
        try {
          await plugin.onSessionEnd(ctx.config!);
        } catch (error) {
          this.logger.error(
            { err: error },
            `Error in plugin ${plugin.name}.onSessionEnd: ${error}`,
          );
        }
      });
      await Promise.all(promises);
    }

    if (state === SessionState.Draining && ctx.browser) {
      // onBrowserClose
      const promises = Array.from(this.plugins.values()).map(async (plugin) => {
        try {
          await plugin.onBrowserClose(ctx.browser!);
        } catch (error) {
          this.logger.error(
            { err: error },
            `Error in plugin ${plugin.name}.onBrowserClose: ${error}`,
          );
        }
      });
      await Promise.all(promises);
    }

    if (state === SessionState.Closed) {
      // onShutdown
      const promises = Array.from(this.plugins.values()).map(async (plugin) => {
        try {
          await plugin.onShutdown();
        } catch (error) {
          this.logger.error({ err: error }, `Error in plugin ${plugin.name}.onShutdown: ${error}`);
        }
      });
      await Promise.all(promises);
    }
  }

  async onEvent(event: RuntimeEvent, ctx: SessionContext): Promise<void> {
    if (event.type === "targetCreated" && event.data.target.type() === "page") {
      const page = await event.data.target.page().catch(() => null);
      if (page) {
        const promises = Array.from(this.plugins.values()).map(async (plugin) => {
          try {
            await plugin.onPageCreated(page);
          } catch (error) {
            this.logger.error(
              { err: error },
              `Error in plugin ${plugin.name}.onPageCreated: ${error}`,
            );
          }
        });
        await Promise.all(promises);
      }
    }

    if (event.type === "targetChanged" && event.data.target.type() === "page") {
      const page = await event.data.target.page().catch(() => null);
      if (page) {
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
    }
  }

  public getAllPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values());
  }
}
