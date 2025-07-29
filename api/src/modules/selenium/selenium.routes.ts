import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyReplyFrom from "@fastify/reply-from";

async function routes(server: FastifyInstance) {
  server.register(fastifyReplyFrom, {
    base: server.seleniumService.getSeleniumServerUrl(),
  });

  server.all(
    "/selenium/wd/*",
    { schema: { hide: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.url === "/selenium/wd/session" && request.method === "POST") {
        const body = request.body as any;
        if (!body.capabilities) {
          body.capabilities = {};
        }
        if (!body.capabilities.alwaysMatch) {
          body.capabilities.alwaysMatch = {};
        }
        if (!body.capabilities.alwaysMatch["goog:chromeOptions"]) {
          body.capabilities.alwaysMatch["goog:chromeOptions"] = {};
        }
        if (!body.capabilities.alwaysMatch["goog:chromeOptions"].args) {
          body.capabilities.alwaysMatch["goog:chromeOptions"].args = [];
        }
        const chromeArgs = await server.seleniumService.getChromeArgs();
        body.capabilities.alwaysMatch["goog:chromeOptions"].args.push(...chromeArgs);
        request.body = body;

        return reply.from("/session", {
          body,
          rewriteHeaders(headers, request) {
            headers["content-type"] = "application/json; charset=utf-8";
            headers["accept"] = "application/json; charset=utf-8";
            return headers;
          },
          rewriteRequestHeaders(request, headers) {
            headers["content-type"] = "application/json; charset=utf-8";
            headers["accept"] = "application/json; charset=utf-8";
            return headers;
          },
        });
      }
      return reply.from(request.url.replace("/selenium/wd", ""), {
        body: request.body,
        rewriteRequestHeaders(request, headers) {
          headers["content-type"] = "application/json; charset=utf-8";
          headers["accept"] = "application/json; charset=utf-8";
          return headers;
        },
        rewriteHeaders(headers, request) {
          headers["content-type"] = "application/json; charset=utf-8";
          headers["accept"] = "application/json; charset=utf-8";
          return headers;
        },
      });
    },
  );
}

export default routes;
