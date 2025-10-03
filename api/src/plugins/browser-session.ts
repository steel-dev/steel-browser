import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { SessionService } from "../services/session.service.js";

const browserSessionPlugin: FastifyPluginAsync = async (fastify, _options) => {
  const sessionService = new SessionService({
    cdpService: fastify.cdpService,
    seleniumService: fastify.seleniumService,
    fileService: fastify.fileService,
    logger: fastify.log,
  });

  // Initialize session persistence (Redis connection)
  await sessionService.initializePersistence();

  // Cleanup on server close
  fastify.addHook("onClose", async () => {
    await sessionService.shutdownPersistence();
  });

  fastify.decorate("sessionService", sessionService);
};

export default fp(browserSessionPlugin, "5.x");
