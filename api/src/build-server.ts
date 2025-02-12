import fastify, { FastifyServerOptions } from "fastify";
import fastifySensible from "@fastify/sensible";
import fastifyCors from "@fastify/cors";
import fastifyView from "@fastify/view";
import fastifyVite from "@fastify/vite";
import openAPIPlugin from "./plugins/schemas";
import requestLogger from "./plugins/request-logger";
import browserInstancePlugin from "./plugins/browser";
import browserSessionPlugin from "./plugins/browser-session";
import browserWebSocket from "./plugins/browser-socket/browser-socket";
import seleniumPlugin from "./plugins/selenium";
import customBodyParser from "./plugins/custom-body-parser";
import { sessionsRoutes, seleniumRoutes, actionsRoutes, cdpRoutes } from "./routes";
import path from "node:path";

export default async function buildFastifyServer(options?: FastifyServerOptions) {
  const server = fastify(options);

  // Plugins
  server.register(fastifySensible);
  server.register(fastifyCors, { origin: true });
  server.register(fastifyView, {
    engine: {
      ejs: require("ejs"),
    },
    root: path.join(__dirname, "templates"),
  });
  server.register(requestLogger);
  server.register(openAPIPlugin);
  server.register(browserInstancePlugin);
  server.register(seleniumPlugin);
  server.register(browserWebSocket);
  server.register(customBodyParser);
  server.register(browserSessionPlugin);

  // Routes
  server.register(actionsRoutes, { prefix: "/v1" });
  server.register(sessionsRoutes, { prefix: "/v1" });
  server.register(cdpRoutes, { prefix: "/v1" });
  server.register(seleniumRoutes);

  
  // UI
  const uiPath = path.join(process.cwd(), "../ui");
  await server.register(fastifyVite, {
    root: uiPath,
    dev: true, // not sure if there's a point in not using dev
    spa: true
  })

  return server;
}
