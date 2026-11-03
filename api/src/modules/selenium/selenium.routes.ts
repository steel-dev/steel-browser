import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyReplyFrom from "@fastify/reply-from";
import type { SeleniumService } from "../../services/selenium.service.js";
import { SessionServiceError } from "../../services/session.service.js";

function appendJsonHeaders(headers: Record<string, any>) {
  headers["content-type"] = "application/json; charset=utf-8";
  headers["accept"] = "application/json; charset=utf-8";
  return headers;
}

async function proxySeleniumRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  service: SeleniumService,
  routePrefix: string,
) {
  const parsedUrl = new URL(request.url, "http://localhost");
  let upstreamPath = parsedUrl.pathname.slice(routePrefix.length) || "/";
  if (!upstreamPath.startsWith("/")) upstreamPath = `/${upstreamPath}`;

  if (upstreamPath === "/session" && request.method === "POST") {
    const body = (request.body ?? {}) as Record<string, any>;
    body.capabilities ??= {};
    body.capabilities.alwaysMatch ??= {};
    body.capabilities.alwaysMatch["goog:chromeOptions"] ??= {};
    body.capabilities.alwaysMatch["goog:chromeOptions"].args ??= [];
    body.capabilities.alwaysMatch["goog:chromeOptions"].args.push(
      ...(await service.getChromeArgs()),
    );
    request.body = body;
  }

  const upstreamUrl = `${service.getSeleniumServerUrl()}${upstreamPath}${parsedUrl.search}`;
  return reply.from(upstreamUrl, {
    body: request.body,
    rewriteHeaders: appendJsonHeaders,
    rewriteRequestHeaders: (_request, headers) => appendJsonHeaders(headers),
  });
}

async function routes(server: FastifyInstance) {
  server.register(fastifyReplyFrom, {
    base: server.seleniumService.getSeleniumServerUrl(),
  });

  server.all(
    "/v1/sessions/:sessionId/selenium/wd/*",
    { schema: { hide: true } },
    async (
      request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const session = server.sessionService.resolveLiveSession(request.params.sessionId);
        if (!session?.isSelenium) {
          return reply.code(404).send({ message: "Session is not a Selenium session." });
        }
        return proxySeleniumRequest(
          request,
          reply,
          session.seleniumService,
          `/v1/sessions/${request.params.sessionId}/selenium/wd`,
        );
      } catch (error) {
        const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
        return reply
          .code(statusCode)
          .send({ message: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.all(
    "/selenium/wd/*",
    { schema: { hide: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const session = server.sessionService.getOnlyActiveSession();
        if (!session?.isSelenium) {
          return reply.code(404).send({ message: "No active Selenium session." });
        }
        return proxySeleniumRequest(request, reply, session.seleniumService, "/selenium/wd");
      } catch (error) {
        const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
        return reply
          .code(statusCode)
          .send({ message: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}

export default routes;
