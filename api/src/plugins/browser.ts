import { FastifyPluginAsync } from "fastify";
import { CDPService } from "../services/cdp/cdp.service.js";
import fp from "fastify-plugin";
import { BrowserLauncherOptions } from "../types/index.js";
import { InMemoryStorage, LogStorage } from "../services/cdp/instrumentation/storage/index.js";

declare module "fastify" {
  interface FastifyInstance {
    cdpService: CDPService;
    registerCDPLaunchHook: (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => void;
    registerCDPShutdownHook: (
      hook: (config: BrowserLauncherOptions | null) => Promise<void> | void,
    ) => void;
  }
}

const browserInstancePlugin: FastifyPluginAsync = async (fastify, _options) => {
  const loggingConfig = fastify.steelBrowserConfig?.logging || {};
  const enableConsoleLogging = loggingConfig.enableConsoleLogging ?? true;

  const storage: LogStorage = loggingConfig.storage ?? new InMemoryStorage(1000);
  await storage.initialize();
  fastify.log.info({ injected: Boolean(loggingConfig.storage) }, "Log storage initialized");

  const cdpService = new CDPService({}, fastify.log, storage, enableConsoleLogging);

  fastify.decorate("cdpService", cdpService);
  fastify.decorate(
    "registerCDPLaunchHook",
    (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => {
      cdpService.registerLaunchHook(hook);
    },
  );
  fastify.decorate(
    "registerCDPShutdownHook",
    (hook: (config: BrowserLauncherOptions | null) => Promise<void> | void) => {
      cdpService.registerShutdownHook(hook);
    },
  );

  fastify.addHook("onListen", async function () {
    this.log.info("Launching default browser...");
    await cdpService.launch();
  });
};

export default fp(browserInstancePlugin, "5.x");
