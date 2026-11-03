import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  handleLaunchBrowserSession,
  handleGetBrowserContext,
  handleExitBrowserSession,
  handleGetSessionDetails,
  handleGetSessions,
  handleGetSessionStream,
  handleGetSessionLiveDetails,
} from "./sessions.controller.js";
import { handleScrape, handleScreenshot, handlePDF } from "../actions/actions.controller.js";
import { $ref } from "../../plugins/schemas.js";
import {
  CreateSessionRequest,
  RecordedEvents,
  SessionStreamRequest,
  SessionsScrapeRequest,
  SessionsScreenshotRequest,
  SessionsPDFRequest,
} from "./sessions.schema.js";
import { BrowserEventType, EmitEvent } from "../../types/enums.js";
import { quickAction } from "../commands/commands.guard.js";
import { SessionServiceError } from "../../services/session.service.js";

function sessionActionError(reply: FastifyReply, error: unknown) {
  const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
  return reply
    .code(statusCode)
    .send({ message: error instanceof Error ? error.message : String(error) });
}

async function routes(server: FastifyInstance) {
  server.get(
    "/health",
    {
      schema: {
        operationId: "health",
        description: "Check if the server and browser are running",
        tags: ["Health"],
        summary: "Check if the server and browser are running",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!server.browserPool) {
        return reply.status(503).send({ status: "service_unavailable" });
      }
      return reply.send({
        status: "ok",
        activeSessions: server.browserPool.activeCount,
        maxSessions: server.browserPool.maxSessions,
      });
    },
  );
  server.post(
    "/sessions",
    {
      schema: {
        operationId: "launch_browser_session",
        description: "Launch a browser session",
        tags: ["Sessions"],
        summary: "Launch a browser session",
        body: $ref("CreateSession"),
        response: {
          200: $ref("SessionDetails"),
        },
      },
    },
    async (request: CreateSessionRequest, reply: FastifyReply) =>
      handleLaunchBrowserSession(server, request, reply),
  );

  server.get(
    "/sessions",
    {
      schema: {
        operationId: "get_sessions",
        description: "Get all sessions",
        tags: ["Sessions"],
        summary: "Get all sessions",
        response: {
          200: $ref("MultipleSessions"),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) =>
      handleGetSessions(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId",
    {
      schema: {
        operationId: "get_session_details",
        description: "Get session details",
        tags: ["Sessions"],
        summary: "Get session details",
        response: {
          200: $ref("SessionDetails"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) =>
      handleGetSessionDetails(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId/context",
    {
      schema: {
        operationId: "get_browser_context",
        description: "Get a browser context",
        tags: ["Sessions"],
        summary: "Get a browser context",
        response: {
          200: $ref("SessionContextSchema"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) =>
      handleGetBrowserContext(server, request, reply),
  );

  server.post(
    "/sessions/:sessionId/release",
    {
      schema: {
        operationId: "release_browser_session",
        description: "Release a browser session",
        tags: ["Sessions"],
        summary: "Release a browser session",
        response: {
          200: $ref("ReleaseSession"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) =>
      handleExitBrowserSession(server, request, reply),
  );

  server.post(
    "/sessions/release",
    {
      schema: {
        operationId: "release_browser_sessions",
        description: "Release browser sessions",
        tags: ["Sessions"],
        summary: "Release browser sessions",
        response: {
          200: $ref("ReleaseSession"),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) =>
      handleExitBrowserSession(
        server,
        request as FastifyRequest<{ Params: { sessionId?: string } }>,
        reply,
      ),
  );

  server.get(
    "/sessions/debug",
    {
      onRequest: [],
      schema: {
        operationId: "get_session_debugger_stream",
        description: "Returns an HTML page with a live debugger view of the session",
        tags: ["Sessions"],
        summary: "Get session debugger view",
        querystring: $ref("SessionStreamQuery"),
        response: {
          200: $ref("SessionStreamResponse"),
        },
      },
    },
    async (request: SessionStreamRequest, reply: FastifyReply) =>
      handleGetSessionStream(
        server,
        request as SessionStreamRequest & FastifyRequest<{ Params: { sessionId?: string } }>,
        reply,
      ),
  );

  server.get(
    "/sessions/:sessionId/debug",
    {
      onRequest: [],
      schema: {
        operationId: "get_session_debugger_stream_by_id",
        description: "Returns an HTML page with a live debugger view for a specific session",
        tags: ["Sessions"],
        summary: "Get a session-specific debugger view",
        querystring: $ref("SessionStreamQuery"),
        response: { 200: $ref("SessionStreamResponse") },
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Querystring: any }>,
      reply: FastifyReply,
    ) =>
      handleGetSessionStream(
        server,
        request as SessionStreamRequest & FastifyRequest<{ Params: { sessionId?: string } }>,
        reply,
      ),
  );

  server.post(
    "/events",
    {
      schema: {
        operationId: "receive_events",
        description: "Receive recorded events from the browser",
        tags: ["Sessions"],
        summary: "Receive recorded events from the browser",
        body: $ref("RecordedEvents"),
      },
    },
    async (request: FastifyRequest<{ Body: RecordedEvents }>, reply: FastifyReply) => {
      try {
        const session = server.sessionService.getOnlyActiveSession();
        const cdpService = session?.cdpService ?? server.cdpService;
        cdpService.getInstrumentationLogger().record({
          type: BrowserEventType.Recording,
          timestamp: new Date().toISOString(),
          data: request.body,
        });
        return reply.send({ status: "ok" });
      } catch (error) {
        return sessionActionError(reply, error);
      }
    },
  );

  server.post(
    "/sessions/:sessionId/events",
    {
      schema: {
        operationId: "receive_session_events",
        description: "Receive recorded events for a specific browser session",
        tags: ["Sessions"],
        summary: "Receive session events",
        body: $ref("RecordedEvents"),
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Body: RecordedEvents }>,
      reply: FastifyReply,
    ) => {
      try {
        const session = server.sessionService.resolveLiveSession(request.params.sessionId);
        session?.cdpService.getInstrumentationLogger().record({
          type: BrowserEventType.Recording,
          timestamp: new Date().toISOString(),
          data: request.body,
        });
        return reply.send({ status: "ok" });
      } catch (error) {
        return sessionActionError(reply, error);
      }
    },
  );

  server.get(
    "/sessions/:id/live-details",
    {
      onRequest: [],
      schema: {
        operationId: "get_session_live_details",
        description:
          "Returns the live state of the session, including pages, tabs, and browser state",
        tags: ["Sessions"],
        summary: "Get session live details",
        response: {
          200: $ref("SessionLiveDetailsResponse"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) =>
      handleGetSessionLiveDetails(server, request, reply),
  );

  server.post(
    "/sessions/scrape",
    {
      schema: {
        operationId: "scrape_session",
        description: "Scrape Current Session",
        tags: ["Sessions"],
        summary: "Scrape Current Session",
        body: $ref("ScrapeRequest"),
        response: {
          200: $ref("ScrapeResponse"),
        },
      },
    },
    async (request: SessionsScrapeRequest, reply: FastifyReply) => {
      try {
        const session = server.sessionService.getOnlyActiveSession();
        const cdpService = session?.cdpService ?? server.cdpService;
        return quickAction(
          server,
          request,
          reply,
          () => handleScrape(server.sessionService, cdpService, request, reply, session?.id),
          session?.id,
        );
      } catch (error) {
        return sessionActionError(reply, error);
      }
    },
  );

  server.post(
    "/sessions/screenshot",
    {
      schema: {
        operationId: "screenshot_session",
        description: "Take Screenshot of Current Session",
        tags: ["Sessions"],
        summary: "Take Screenshot of Current Session",
        body: $ref("ScreenshotRequest"),
        response: {
          200: $ref("ScreenshotResponse"),
        },
      },
    },
    async (request: SessionsScreenshotRequest, reply: FastifyReply) => {
      try {
        const session = server.sessionService.getOnlyActiveSession();
        const cdpService = session?.cdpService ?? server.cdpService;
        return quickAction(
          server,
          request,
          reply,
          () => handleScreenshot(server.sessionService, cdpService, request, reply, session?.id),
          session?.id,
        );
      } catch (error) {
        return sessionActionError(reply, error);
      }
    },
  );

  server.post(
    "/sessions/pdf",
    {
      schema: {
        operationId: "pdf_session",
        description: "Generate PDF of Current Session",
        tags: ["Sessions"],
        summary: "Generate PDF of Current Session",
        body: $ref("PDFRequest"),
        response: {
          200: $ref("PDFResponse"),
        },
      },
    },
    async (request: SessionsPDFRequest, reply: FastifyReply) => {
      try {
        const session = server.sessionService.getOnlyActiveSession();
        const cdpService = session?.cdpService ?? server.cdpService;
        return quickAction(
          server,
          request,
          reply,
          () => handlePDF(server.sessionService, cdpService, request, reply, session?.id),
          session?.id,
        );
      } catch (error) {
        return sessionActionError(reply, error);
      }
    },
  );
}

export default routes;
