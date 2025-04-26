import fastifyView from "@fastify/view";
import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import path from "node:path";
import browserInstancePlugin from "./plugins/browser";
import browserSessionPlugin from "./plugins/browser-session";
import browserWebSocket from "./plugins/browser-socket/browser-socket";
import customBodyParser from "./plugins/custom-body-parser";
import fileStoragePlugin from "./plugins/file-storage";
import requestLogger from "./plugins/request-logger";
import openAPIPlugin from "./plugins/schemas";
import seleniumPlugin from "./plugins/selenium";
import { actionsRoutes, cdpRoutes, filesRoutes, seleniumRoutes, sessionsRoutes } from "./routes";

declare module "fastify" {
  interface FastifyInstance {
    steelBrowserConfig: SteelBrowserConfig;
  }
}

export interface SteelBrowserConfig {
  fileStorage?: {
    maxSizePerSession?: number;
  };
}

const steelBrowserPlugin: FastifyPluginAsync<SteelBrowserConfig> =
  async (fastify, opts) => {
    fastify.decorate("steelBrowserConfig", opts);
    // Plugins
    await fastify.register(fastifyView, {
      engine: {
        ejs: require("ejs"),
      },
      root: path.join(__dirname, "templates"), // dirname(fileURLToPath(import.meta))
    });
    await fastify.register(requestLogger); // move to app?
    await fastify.register(openAPIPlugin);
    await fastify.register(fileStoragePlugin);
    await fastify.register(browserInstancePlugin);
    await fastify.register(seleniumPlugin);
    await fastify.register(browserWebSocket);
    await fastify.register(customBodyParser);
    await fastify.register(browserSessionPlugin);

    // Routes
    await fastify.register(actionsRoutes, { prefix: "/v1" });
    await fastify.register(sessionsRoutes, { prefix: "/v1" });
    await fastify.register(cdpRoutes, { prefix: "/v1" });
    await fastify.register(seleniumRoutes);
    await fastify.register(filesRoutes, { prefix: "/v1" });
  };

export default fp(steelBrowserPlugin, {
  name: "steel-browser",
  fastify: "5.x",
});