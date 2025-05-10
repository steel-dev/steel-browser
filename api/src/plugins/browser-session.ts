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
  fastify.decorate("sessionService", sessionService);
};

export default fp(browserSessionPlugin, "5.x");
