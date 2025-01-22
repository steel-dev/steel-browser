import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FastifyRequest } from "fastify";
import { env } from "../env";

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

export async function verifyAuthToken(request: FastifyRequest): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    throw new Error("No authorization header present");
  }

  // Bearer token format
  const [bearer, token] = authHeader.split(" ");

  if (bearer !== "Bearer" || !token) {
    throw new Error("Invalid authorization header format");
  }

  if (!isValidToken(token)) {
    throw new Error("Invalid token");
  }
}

function isValidToken(token: string): boolean {
  console.log(token, env.AUTH_SECRET);
  if (token === env.AUTH_SECRET) {
    return true;
  }
  return false;
}
