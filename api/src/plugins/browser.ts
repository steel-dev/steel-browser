import { FastifyPluginAsync } from "fastify";
import { FileService } from "../services/file.service.js";
import { CDPService } from "../services/cdp/cdp.service.js";
import { BrowserLauncherOptions } from "../types/index.js";

declare module "fastify" {
  interface FastifyInstance {
    cdpService: CDPService;
    registerCDPLaunchHook: (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => void;
    registerCDPShutdownHook: (hook: (config: BrowserLauncherOptions | null) => Promise<void> | void) => void;
  }
}

const browserInstancePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.log.info("Launching default browser...");
  const cdpService = new CDPService({}, fastify.log, FileService.getInstance());

  fastify.decorate("cdpService", cdpService);
  fastify.decorate("registerCDPLaunchHook", (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => {
    cdpService.registerLaunchHook(hook);
  });
  fastify.decorate(
    "registerCDPShutdownHook",
    (hook: (config: BrowserLauncherOptions | null) => Promise<void> | void) => {
      cdpService.registerShutdownHook(hook);
    },
  );

  await cdpService.launch();
};

export default fp(browserInstancePlugin, "5.x");
