import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifySensible from "@fastify/sensible";
import fastifyView from "@fastify/view";
import fastify, { FastifyServerOptions } from "fastify";
import path from "node:path";
import browserInstancePlugin from "./plugins/browser";
import browserSessionPlugin from "./plugins/browser-session";
import browserWebSocket from "./plugins/browser-socket/browser-socket";
import customBodyParser from "./plugins/custom-body-parser";
import fileStoragePlugin from "./plugins/file-storage";
import artifactStoragePlugin from "./plugins/artifact-storage";
import requestLogger from "./plugins/request-logger";
import openAPIPlugin from "./plugins/schemas";
import seleniumPlugin from "./plugins/selenium";
import { actionsRoutes, cdpRoutes, filesRoutes, seleniumRoutes, sessionsRoutes } from "./routes";
import artifactsRoutes from "./modules/artifacts/artifacts.routes";

const KB = 1024;
const MB = 1024 * KB;

export default async function buildFastifyServer(options?: FastifyServerOptions) {
  const server = fastify(options);

  // Plugins
  server.register(fastifySensible);
  server.register(fastifyCors, { origin: true });
  server.register(fastifyMultipart, {
    limits: {
      fileSize: 100 * MB,
    },
  });
  server.register(fastifyView, {
    engine: {
      ejs: require("ejs"),
    },
    root: path.join(__dirname, "templates"),
  });
  server.register(requestLogger);
  server.register(openAPIPlugin);
  server.register(fileStoragePlugin);
  server.register(artifactStoragePlugin);
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
  server.register(filesRoutes, { prefix: "/v1" });
  server.register(artifactsRoutes, { prefix: "/v1" });

  return server;
}
