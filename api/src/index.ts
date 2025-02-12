import buildFastifyServer from "./build-server";
import { loggingConfig } from "./config";

export const server = buildFastifyServer({
  logger: loggingConfig[process.env.NODE_ENV ?? "production"] ?? true,
  disableRequestLogging: false,
  trustProxy: true,
  bodyLimit: 100000000,
});

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

server.then(s => s.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
}));