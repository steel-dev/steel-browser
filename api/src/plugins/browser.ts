import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import path from "node:path";
import os from "node:os";
import { env } from "../env.js";
import { BrowserPool } from "../services/browser-pool.service.js";
import { DuckDBStorage, InMemoryStorage } from "../services/cdp/instrumentation/storage/index.js";
import type { LogStorage } from "../services/cdp/instrumentation/storage/log-storage.interface.js";
import { BrowserLauncherOptions } from "../types/index.js";

declare module "fastify" {
  interface FastifyInstance {
    browserPool: BrowserPool;
    registerCDPLaunchHook: (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => void;
    registerCDPShutdownHook: (
      hook: (config: BrowserLauncherOptions | null) => Promise<void> | void,
    ) => void;
  }
}

function slotStoragePath(basePath: string, index: number): string {
  if (index === 0) return basePath;
  const extension = path.extname(basePath);
  const name = path.basename(basePath, extension);
  return path.join(path.dirname(basePath), `${name}-${index}${extension}`);
}

const browserInstancePlugin: FastifyPluginAsync = async (fastify) => {
  const loggingConfig = fastify.steelBrowserConfig?.logging || {};
  const enableStorage = loggingConfig.enableStorage ?? env.LOG_STORAGE_ENABLED ?? false;
  const enableConsoleLogging = loggingConfig.enableConsoleLogging ?? true;
  const storageBasePath =
    loggingConfig.storagePath ||
    env.LOG_STORAGE_PATH ||
    path.join(os.tmpdir(), "steel-browser-logs", "logs.duckdb");

  const storages: Array<LogStorage | null> = [];
  for (let index = 0; index < env.MAX_SESSIONS; index++) {
    const storage = enableStorage
      ? new DuckDBStorage({
          dbPath: slotStoragePath(storageBasePath, index),
          maxThreads: 1,
          memoryLimit: "128MB",
          parquetCompression: "none",
          enableWriteBuffer: true,
          writeBufferSize: 200,
          writeBufferFlushInterval: 2000,
        })
      : new InMemoryStorage(1000);
    await storage.initialize();
    storages.push(storage);
  }

  fastify.log.info(
    enableStorage
      ? `Initialized browser log storage for ${env.MAX_SESSIONS} sessions`
      : "Using in-memory log storage",
  );

  const browserPool = new BrowserPool({
    maxSessions: env.MAX_SESSIONS,
    cdpPortBase: env.CDP_PORT_BASE,
    seleniumPortBase: env.SELENIUM_PORT_BASE,
    logger: fastify.log,
    storages,
    enableConsoleLogging,
  });

  fastify.decorate("browserPool", browserPool);
  fastify.decorate("cdpService", browserPool.defaultSlot.cdpService);
  fastify.decorate("seleniumService", browserPool.defaultSlot.seleniumService);
  fastify.decorate("registerCDPLaunchHook", (hook) => browserPool.registerLaunchHook(hook));
  fastify.decorate("registerCDPShutdownHook", (hook) => browserPool.registerShutdownHook(hook));

  // Keep the default browser available for existing endpoints that do not create a session.
  fastify.addHook("onListen", async function () {
    this.log.info("Launching default browser...");
    await browserPool.defaultSlot.cdpService.launch();
  });
};

export default fp(browserInstancePlugin, "5.x");
