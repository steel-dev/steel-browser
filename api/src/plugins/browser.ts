import { FastifyPluginAsync } from "fastify";
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
import { BrowserPool } from "../services/browser-pool.service.js";
import { CDPService } from "../services/cdp/cdp.service.js";

declare module "fastify" {
  interface FastifyInstance {
    browserPool: BrowserPool;
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

  function createStorage(): LogStorage {
    if (enableStorage) {
      const storagePath =
        loggingConfig.storagePath ||
        env.LOG_STORAGE_PATH ||
        path.join(os.tmpdir(), "steel-browser-logs", "logs.duckdb");

      return new DuckDBStorage({
        dbPath: storagePath,
        maxThreads: 1,
        memoryLimit: "128MB",
        parquetCompression: "none",
        enableWriteBuffer: true,
        writeBufferSize: 200,
        writeBufferFlushInterval: 2000,
      });
    }
    return new InMemoryStorage(1000);
  }

  const initialStorage = createStorage();
  await initialStorage.initialize();
  fastify.log.info(
    enableStorage ? `Log storage initialized` : "Using in-memory log storage",
  );

  const browserPool = new BrowserPool(
    env.MAX_SESSIONS,
    env.CDP_PORT_BASE,
    fastify.log,
    () => {
      const s = createStorage();
      s.initialize().catch((err: Error) =>
        fastify.log.error({ err }, "Failed to initialize slot storage"),
      );
      return s;
    },
    enableConsoleLogging,
  );

  fastify.decorate("browserPool", browserPool);

  // Backward-compat: expose the first slot's CDPService as cdpService
  // so existing routes/handlers that haven't been refactored still work.
  const defaultSlot = browserPool.getSlotByCdpPort(env.CDP_PORT_BASE);
  if (defaultSlot) {
    fastify.decorate("cdpService", defaultSlot.cdpService);
  }

  fastify.decorate(
    "registerCDPLaunchHook",
    (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => {
      if (defaultSlot) {
        defaultSlot.cdpService.registerLaunchHook(hook);
      }
    },
  );
  fastify.decorate(
    "registerCDPShutdownHook",
    (hook: (config: BrowserLauncherOptions | null) => Promise<void> | void) => {
      if (defaultSlot) {
        defaultSlot.cdpService.registerShutdownHook(hook);
      }
    },
  );
};

export default fp(browserInstancePlugin, "5.x");
