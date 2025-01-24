import fastifyGracefulShutdown from "fastify-graceful-shutdown";
import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { SessionService } from "../services/session.service";
import { env } from "../env";

const browserSessionPlugin: FastifyPluginAsync = async (fastify, options) => {
  const sessionService = new SessionService({
    cdpService: fastify.cdpService,
    seleniumService: fastify.seleniumService,
    logger: fastify.log,
  });
  fastify.decorate("sessionService", sessionService);

  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");

  const gracefulOptions = {
    timeout: parseInt(env.KILL_TIMEOUT) * 1000,
  };
  fastify.register(fastifyGracefulShutdown, gracefulOptions).after((err) => {
    if (err) {
      fastify.log.error(err);
    }

    fastify.gracefulShutdown(async (_signal) => {
      if (sessionService.activeSession.status === "live") {
        fastify.log.info("Waiting for active session to be released...");
        await sessionService.activeSession.completion;
        fastify.log.info("Active session has been released...");
      }

      await fastify.cdpService.shutdown();
      await fastify.seleniumService.close();
    });
  });
};

export default fp(browserSessionPlugin, "4.x");
