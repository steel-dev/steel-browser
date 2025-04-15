import buildFastifyServer from "./build-server";
import { loggingConfig } from "./config";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

export const server = buildFastifyServer({
  logger: loggingConfig[process.env.NODE_ENV ?? "development"] ?? true,
  disableRequestLogging: false,
  trustProxy: true,
  bodyLimit: 100000000,
}).then(async (server) =>
  server.listen({ port: PORT, host: HOST }, (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  }),
);
