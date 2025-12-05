import { FastifyPluginAsync } from "fastify";
import { CDPService } from "../services/cdp/cdp.service.js";
import fp from "fastify-plugin";
import { BrowserLauncherOptions } from "../types/index.js";
import {
  DuckDBStorage,
  InMemoryStorage,
  LogStorage,
} from "../services/cdp/instrumentation/storage/index.js";
import path from "path";
import os from "os";
import { env } from "../env.js";

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
  const enableStorage = loggingConfig.enableStorage ?? env.LOG_STORAGE_ENABLED ?? false;
  const enableConsoleLogging = loggingConfig.enableConsoleLogging ?? true;

  let storage: LogStorage | null = null;
  if (enableStorage) {
    const storagePath =
      loggingConfig.storagePath ||
      env.LOG_STORAGE_PATH ||
      path.join(os.tmpdir(), "steel-browser-logs", "logs.duckdb");

    storage = new DuckDBStorage({
      dbPath: storagePath,
      maxThreads: 1,
      memoryLimit: "128MB",
      parquetCompression: "none",
      enableWriteBuffer: true,
      writeBufferSize: 200,
      writeBufferFlushInterval: 2000,
    });

    await storage.initialize();
    fastify.log.info(`Log storage initialized at ${storagePath}`);
  } else {
    // Use in-memory storage for development
    storage = new InMemoryStorage(1000);
    await storage.initialize();
    fastify.log.info("Using in-memory log storage");
  }

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
