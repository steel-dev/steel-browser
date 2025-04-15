import { FastifyServerOptions } from "fastify";
import { env } from "./env";
import stringify from "json-stringify-safe";

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
    ...(env.ENABLE_VERBOSE_LOGGING
      ? {
          hooks: {
            logMethod(inputArgs: any[], method: any) {
              if (inputArgs.length > 1) {
                try {
                  let resultingMessage = "";
                  if (typeof inputArgs[0] === "string") {
                    const [message, ...args] = inputArgs;
                    resultingMessage = `${message} ${stringify(args)}`;
                  } else {
                    resultingMessage = stringify(inputArgs);
                  }
                  return method.apply(this, [resultingMessage]);
                } catch (error) {
                  console.error("Error trying to process logs with verbose logging enabled: ", error);
                }
              }
              return method.apply(this, inputArgs);
            },
          },
        }
      : {}),
    level: process.env.LOG_LEVEL || "debug",
  },
  production: {},
  test: false,
};
