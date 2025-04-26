import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifySensible from "@fastify/sensible";
import steelBrowserPlugin from "./steel-browser-plugin";
import { loggingConfig } from "./config";
import { MB } from "./utils/size";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const serverInstance = fastify({
  logger: loggingConfig[process.env.NODE_ENV ?? "development"] ?? true,
  trustProxy: true,
  bodyLimit: 100 * MB,
  disableRequestLogging: true,
});

serverInstance.register(fastifySensible);
serverInstance.register(fastifyCors, { origin: true });
serverInstance.register(steelBrowserPlugin, {
  fileStorage: {
    maxSizePerSession: 100 * MB,
  }
});

const startServer = async () => {
  try {
    await serverInstance.listen({ port: PORT, host: HOST });
  } catch (err) {
    serverInstance.log.error(err);
    process.exit(1);
  }
};

startServer();

export const server = serverInstance;
