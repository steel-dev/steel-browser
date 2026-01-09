import { FastifyPluginAsync } from "fastify";
import { CDPService } from "../services/cdp/cdp.service.js";
import { createBrowserLogger } from "../services/cdp/instrumentation/browser-logger.js";
import { Orchestrator } from "../runtime/index.js";
import { BrowserRuntime as XStateRuntime } from "../browser-runtime/index.js";
import { XStateAdapter } from "../browser-runtime/adapter.js";
import { RollingFileStorage } from "../browser-runtime/storage/rolling-file-storage.js";
import { StateTransitionLogger } from "../browser-runtime/logging/state-transition-logger.js";
import fp from "fastify-plugin";
import { BrowserLauncherOptions } from "../types/index.js";
import { BrowserRuntime } from "../types/browser-runtime.interface.js";
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
    cdpService: BrowserRuntime;
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

  // Choose runtime based on env flag
  const useXStateRuntime = env.USE_XSTATE_RUNTIME;
  const useSessionMachine = env.USE_SESSION_MACHINE;
  let cdpService: BrowserRuntime;

  if (useXStateRuntime) {
    fastify.log.info("Using isolated XState runtime");

    const instrumentationLogger = createBrowserLogger({
      baseLogger: fastify.log,
      initialContext: {},
      storage: storage || undefined,
      enableConsoleLogging: enableConsoleLogging ?? true,
    });

    let stateTransitionLogger: StateTransitionLogger | undefined;
    if (env.STATE_TRANSITION_LOG_ENABLED) {
      const rollingStorage = new RollingFileStorage({
        directory: env.STATE_TRANSITION_LOG_DIR,
        filenamePrefix: "transitions",
        maxFileSizeBytes: env.STATE_TRANSITION_LOG_MAX_SIZE_MB * 1024 * 1024,
        maxFiles: env.STATE_TRANSITION_LOG_MAX_FILES,
      });
      await rollingStorage.initialize();

      stateTransitionLogger = new StateTransitionLogger({
        baseLogger: fastify.log,
        storage: rollingStorage,
        enableConsoleLogging: true,
      });
      fastify.log.info(`State transition logging enabled in ${env.STATE_TRANSITION_LOG_DIR}`);
    }

    const xstateRuntime = new XStateRuntime({
      instrumentationLogger,
      appLogger: fastify.log,
      stateTransitionLogger,
    });

    const defaultLaunchConfig: BrowserLauncherOptions = {
      options: {
        headless: env.CHROME_HEADLESS,
        args: [],
        ignoreDefaultArgs: ["--enable-automation"],
      },
      blockAds: true,
      extensions: [],
      userDataDir: env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "steel-chrome"),
      userPreferences: {
        plugins: {
          always_open_pdf_externally: true,
          plugins_disabled: ["Chrome PDF Viewer"],
        },
      },
      deviceConfig: { device: "desktop" },
    };

    cdpService = new XStateAdapter(xstateRuntime, fastify.log, instrumentationLogger, {
      keepAlive: true,
      defaultLaunchConfig,
    });
  } else if (useSessionMachine) {
    fastify.log.info("Using SessionMachine runtime");
    cdpService = new Orchestrator({
      keepAlive: true,
      logger: fastify.log,
      storage,
      enableConsoleLogging,
    });
  } else {
    fastify.log.info("Using legacy CDPService runtime");
    cdpService = new CDPService({}, fastify.log, storage, enableConsoleLogging);
  }

  // Both CDPService and Orchestrator implement BrowserRuntime interface
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
