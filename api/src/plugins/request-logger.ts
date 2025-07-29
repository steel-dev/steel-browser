import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyReply {
    startTime: number;
  }
}

// https://github.com/fastify/fastify/blob/main/lib/logger.js#L67
function now() {
  const ts = process.hrtime();
  return ts[0] * 1e3 + ts[1] / 1e6;
}

const logger: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", (req, reply, done) => {
    reply.startTime = now();
    done();
  });

  fastify.addHook("onResponse", (req, reply, done) => {
    if (
      req.method !== "OPTIONS" &&
      req.raw.url !== "/status" &&
      req.raw.url !== "/v1/events" &&
      req.raw.url !== "/"
    ) {
      req.log.info(
        {
          ip: getClientIp(req),
          url: req.raw.url,
          method: req.method,
          statusCode: reply.raw.statusCode,
          durationMs: roundMS(now() - reply.startTime),
        },
        "request completed",
      );
    }
    done();
  });
};

export default fp(logger);

function roundMS(num: number): number {
  return Math.trunc(num * 100) / 100;
}

function getClientIp(req: any): string {
  if (req.headers["x-forwarded-for"]) {
    return req.headers["x-forwarded-for"].split(",")[0];
  }
  if (req.headers["x-real-ip"]) {
    return req.headers["x-real-ip"];
  }
  if (req.raw && req.raw.connection) {
    return req.raw.connection.remoteAddress || "unknown";
  }
  if (req.raw && req.raw.socket) {
    return req.raw.socket.remoteAddress || "unknown";
  }
  if (req.socket) {
    return req.socket.remoteAddress || "unknown";
  }
  return "unknown";
}
