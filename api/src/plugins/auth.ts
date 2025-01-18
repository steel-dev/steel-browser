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
    console.log("request", request);
    const token = request.headers.authorization?.replace("Bearer ", "");

    if (!authToken) {
      done();
      console.log("no auth token");
      return;
    }

    // Skip auth for WebSocket upgrade requests
    if (request.raw.headers.upgrade === "websocket") {
      request.isAuthenticated = true;
      console.log("websocket");
      done();
      return;
    }

    if (!token) {
      fastify.log.warn("Request rejected - no auth token provided");
      console.log("no token");
      reply.status(401).send({ error: "Authentication required" });
      done();
      return;
    }

    if (token !== authToken) {
      fastify.log.warn("Request rejected - invalid auth token");
      console.log("invalid token");
      reply.status(401).send({ error: "Invalid authentication token" });
      done();
      return;
    }

    request.isAuthenticated = true;
    fastify.log.debug("Request authenticated successfully");
    console.log("authenticated");
    done();
  });
};

export default fp(authPlugin, {
  name: "auth-plugin",
});
