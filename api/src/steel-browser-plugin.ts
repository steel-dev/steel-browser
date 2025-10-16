import fastifyView from "@fastify/view";
import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import path, { dirname } from "node:path";
import browserInstancePlugin from "./plugins/browser.js";
import browserSessionPlugin from "./plugins/browser-session.js";
import browserWebSocket from "./plugins/browser-socket/browser-socket.js";
import customBodyParser from "./plugins/custom-body-parser.js";
import fileStoragePlugin from "./plugins/file-storage.js";
import requestLogger from "./plugins/request-logger.js";
import openAPIPlugin from "./plugins/schemas.js";
import seleniumPlugin from "./plugins/selenium.js";
import {
  actionsRoutes,
  cdpRoutes,
  filesRoutes,
  logsRoutes,
  seleniumRoutes,
  sessionsRoutes,
} from "./routes.js";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { CDPService } from "./services/cdp/cdp.service.js";
import type { BrowserLauncherOptions } from "./types/browser.js";
import { WebSocketHandler } from "./types/websocket.js";
import { WebSocketRegistryService } from "./services/websocket-registry.service.js";
import { SessionService } from "./services/session.service.js";
import { LogStorage } from "./services/cdp/instrumentation/storage/log-storage.interface.js";

// We need to redeclare any decorators from within the plugin that we want to expose
declare module "fastify" {
  interface FastifyInstance {
    steelBrowserConfig: SteelBrowserConfig;
    cdpService: CDPService;
    sessionService: SessionService;
    webSocketRegistry: WebSocketRegistryService;
    registerCDPLaunchHook: (hook: (config: BrowserLauncherOptions) => Promise<void> | void) => void;
    registerCDPShutdownHook: (
      hook: (config: BrowserLauncherOptions | null) => Promise<void> | void,
    ) => void;
  }

  interface LogStorageInterface extends LogStorage {}
}

export interface SteelBrowserConfig {
  fileStorage?: {
    maxSizePerSession?: number;
  };
  customWsHandlers?: WebSocketHandler[];
  logging?: {
    enableStorage?: boolean;
    storagePath?: string;
    enableConsoleLogging?: boolean;
    enableLogsRoutes?: boolean;
  };
}

const steelBrowserPlugin: FastifyPluginAsync<SteelBrowserConfig> = async (fastify, opts) => {
  fastify.decorate("steelBrowserConfig", opts);
  // Plugins
  await fastify.register(fastifyView, {
    engine: {
      ejs,
    },
    root: path.join(dirname(fileURLToPath(import.meta.url)), "templates"),
  });
  await fastify.register(requestLogger);
  await fastify.register(openAPIPlugin);
  await fastify.register(fileStoragePlugin);
  await fastify.register(browserInstancePlugin);
  await fastify.register(seleniumPlugin);
  await fastify.register(browserWebSocket, {
    customHandlers: opts.customWsHandlers,
  });
  await fastify.register(customBodyParser);
  await fastify.register(browserSessionPlugin);

  // Routes
  await fastify.register(actionsRoutes, { prefix: "/v1" });
  await fastify.register(sessionsRoutes, { prefix: "/v1" });
  await fastify.register(cdpRoutes, { prefix: "/v1" });
  await fastify.register(seleniumRoutes);
  await fastify.register(filesRoutes, { prefix: "/v1" });

  const enableLogsRoutes = opts.logging?.enableLogsRoutes ?? true;
  if (enableLogsRoutes) {
    await fastify.register(logsRoutes, { prefix: "/v1/logs" });
  }
};

export default fp<SteelBrowserConfig>(steelBrowserPlugin, {
  name: "steel-browser",
  fastify: "5.x",
});
