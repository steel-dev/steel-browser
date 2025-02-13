import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { SeleniumService } from "../services/selenium.service";

const seleniumPlugin: FastifyPluginAsync = async (fastify, options) => {
  const seleniumService = new SeleniumService(fastify.log);
  fastify.decorate("seleniumService", seleniumService);
};

export default fp(seleniumPlugin, "5.x");
