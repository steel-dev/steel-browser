import fastifyStatic from "@fastify/static";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import path from "node:path";
import fs from "node:fs";

export interface UIPluginOptions {
  uiDistPath?: string;
  uiPrefix?: string;
}

const uiPlugin: FastifyPluginAsync<UIPluginOptions> = async (fastify, opts) => {
  const uiDistPath = opts.uiDistPath || path.join(process.cwd(), "ui/dist");
  const uiPrefix = opts.uiPrefix || "/ui";

  if (!fs.existsSync(uiDistPath)) {
    fastify.log.info("UI dist not found, skipping UI serving");
    return;
  }

  fastify.log.info(`UI plugin activated: serving from ${uiDistPath} at ${uiPrefix}`);

  await fastify.register(fastifyStatic, {
    root: uiDistPath,
    prefix: uiPrefix,
    decorateReply: true,
  });

  fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    const userAgent = request.headers["user-agent"];

    // If it's a browser, redirect to UI
    if (userAgent && userAgent.includes("Mozilla")) {
      return reply.redirect(uiPrefix);
    }

    return { message: "Steel Browser API", ui: uiPrefix };
  });

  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;
    if (url.startsWith(uiPrefix)) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not Found" });
  });

  fastify.log.info("UI plugin registered successfully");
};

export default fp<UIPluginOptions>(uiPlugin, {
  name: "ui-plugin",
  fastify: "5.x",
});
