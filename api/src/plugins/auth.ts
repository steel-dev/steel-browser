import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    isAuthenticated: boolean;
  }
}

type AuthPluginOptions = {
  authToken?: string;
};

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const authToken = options.authToken || process.env.AUTH_TOKEN;
  fastify.log.warn("No auth token configured - server will run without authentication");

  fastify.decorateRequest("isAuthenticated", false);

  fastify.addHook("onRequest", (request, reply, done) => {
    const token = request.headers.authorization?.replace("Bearer ", "");

    if (!authToken) {
      done();
      return;
    }

    // Skip auth for WebSocket upgrade requests
    if (request.raw.headers.upgrade === "websocket") {
      request.isAuthenticated = true;
      done();
      return;
    }

    if (!token) {
      fastify.log.warn("Request rejected - no auth token provided");
      reply.status(401).send({ error: "Authentication required" });
      done();
      return;
    }

    if (token !== authToken) {
      fastify.log.warn("Request rejected - invalid auth token");
      reply.status(401).send({ error: "Invalid authentication token" });
      done();
      return;
    }

    request.isAuthenticated = true;
    fastify.log.debug("Request authenticated successfully");
    done();
  });
};

export default fp(authPlugin, {
  name: "auth-plugin",
});
