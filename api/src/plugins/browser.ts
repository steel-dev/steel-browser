import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { CDPService } from "../services/cdp/cdp.service";
import { FileService } from "../services/file.service";

const browserInstancePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.log.info("Launching default browser...");
  const cdpService = new CDPService({}, fastify.log, FileService.getInstance());
  fastify.decorate("cdpService", cdpService);
  cdpService.launch();
};

export default fp(browserInstancePlugin, "5.x");
