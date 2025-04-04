import { FastifyPluginAsync } from "fastify";
import { CDPService } from "../services/cdp/cdp.service";
import fp from "fastify-plugin";

const browserInstancePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.log.info("Launching default browser...");
  const cdpService = new CDPService({}, fastify.log);
  fastify.decorate("cdpService", cdpService);
  cdpService.launch();
};

export default fp(browserInstancePlugin, "5.x");
