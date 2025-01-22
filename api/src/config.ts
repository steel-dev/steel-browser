import { FastifyServerOptions } from "fastify";

interface LoggingConfig {
  [key: string]: FastifyServerOptions["logger"];
}

export const loggingConfig: LoggingConfig = {
  development: {
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
  production: {
    level: process.env.LOG_LEVEL || "warn",
  },
  test: false,
};

export type Config = {
  authToken?: string;
};
