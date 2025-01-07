import fastify, { FastifyServerOptions } from "fastify";
import fastifySensible from "@fastify/sensible";
import fastifyCors from "@fastify/cors";
import openAPIPlugin from "./plugins/schemas";
import requestLogger from "./plugins/request-logger";
import browserInstancePlugin from "./plugins/browser";
import browserSessionPlugin from "./plugins/browser-session";
import browserWebSocket from "./plugins/browser-socket";
import seleniumPlugin from "./plugins/selenium";
import customBodyParser from "./plugins/custom-body-parser";
import { sessionsRoutes, seleniumRoutes, actionsRoutes, cdpRoutes } from "./routes";

export default function buildFastifyServer(options?: FastifyServerOptions) {
  const server = fastify(options);

  // Plugins
  server.register(requestLogger);
  server.register(fastifySensible);
  server.register(fastifyCors, { origin: true });
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

  return server;
}
