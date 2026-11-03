import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { $ref } from "../../plugins/schemas.js";
import cdpSchemas from "./cdp.schemas.js";
import { getSessionUrl } from "../../utils/url.js";
import { SessionServiceError, type Session } from "../../services/session.service.js";

function scopedPageWebSocketUrl(sessionId: string, pageId: string): string {
  return getSessionUrl(sessionId, `cdp/devtools/page/${encodeURIComponent(pageId)}`, "ws").replace(
    /^wss?:\/\//,
    "",
  );
}

function redirectToSessionInspector(reply: FastifyReply, session: Session, pageId?: string) {
  if (session.isSelenium) {
    return reply.code(409).send({ message: "DevTools is unavailable for Selenium sessions." });
  }
  const targetId = session.cdpService.getPageTargetId(pageId);
  if (!targetId) return reply.code(404).send({ message: "Browser page not found." });
  const url = new URL(session.cdpService.getDebuggerUrl());
  url.searchParams.set("ws", scopedPageWebSocketUrl(session.id, targetId));
  return reply.redirect(url.toString());
}

async function routes(server: FastifyInstance) {
  server.get(
    "/sessions/:sessionId/devtools/inspector.html",
    {
      schema: {
        operationId: "getSessionDevtoolsUrl",
        description: "Get the DevTools inspector URL for a browser session",
        tags: ["CDP"],
        summary: "Get a session-scoped DevTools inspector URL",
        querystring: $ref("GetDevtoolsUrlSchema"),
      },
    },
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Querystring: z.infer<typeof cdpSchemas.GetDevtoolsUrlSchema>;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const session = server.sessionService.resolveLiveSession(request.params.sessionId);
        return redirectToSessionInspector(reply, session, request.query.pageId ?? undefined);
      } catch (error) {
        const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
        return reply.code(statusCode).send({
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.get(
    "/devtools/inspector.html",
    {
      schema: {
        operationId: "getDevtoolsUrl",
        description: "Get the URL for the DevTools inspector",
        tags: ["CDP"],
        summary: "Get the URL for the DevTools inspector",
        querystring: $ref("GetDevtoolsUrlSchema"),
      },
    },
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof cdpSchemas.GetDevtoolsUrlSchema> }>,
      reply: FastifyReply,
    ) => {
      try {
        const session = server.sessionService.getOnlyActiveSession();
        if (session) {
          return redirectToSessionInspector(reply, session, request.query.pageId);
        }
        const url = new URL(server.cdpService.getDebuggerUrl());
        url.searchParams.set(
          "ws",
          server.cdpService.getDebuggerWsUrl(request.query.pageId).replace(/^wss?:\/\//, ""),
        );
        return reply.redirect(url.toString());
      } catch (error) {
        const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
        return reply.code(statusCode).send({
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}

export default routes;
