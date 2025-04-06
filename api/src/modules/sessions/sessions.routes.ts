import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  handleLaunchBrowserSession,
  handleGetBrowserContext,
  handleExitBrowserSession,
  handleGetSessionDetails,
  handleGetSessions,
  handleGetSessionStream,
  handleGetSessionLiveDetails,
} from "./sessions.controller";
import { $ref } from "../../plugins/schemas";
import { CreateSessionRequest, RecordedEvents, SessionStreamRequest } from "./sessions.schema";
import { EmitEvent } from "../../types/enums";
import { unpack } from "@rrweb/packer"; // Importing the unpack function from rrweb/packer

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
      if (!server.cdpService.isRunning()) {
        return reply.status(503).send({ status: "service_unavailable" });
      }
      return reply.send({ status: "ok" });
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
    async (request: CreateSessionRequest, reply: FastifyReply) => handleLaunchBrowserSession(server, request, reply),
  );

  server.get(
    "/sessions",
    {
      schema: {
        operationId: "get_sessions",
        description: "Get all sessions (only returns current session)",
        tags: ["Sessions"],
        summary: "Get all sessions (only returns current session)",
        response: {
          200: $ref("MultipleSessions"),
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => handleGetSessions(server, request, reply),
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
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => handleGetBrowserContext(server.cdpService, request, reply),
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
    async (request: FastifyRequest, reply: FastifyReply) => handleExitBrowserSession(server, request, reply),
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
    async (request: FastifyRequest, reply: FastifyReply) => handleExitBrowserSession(server, request, reply),
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
    async (request: SessionStreamRequest, reply: FastifyReply) => handleGetSessionStream(server, request, reply),
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
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' }
            }
          }
        }
      },
    },
    async (request: FastifyRequest<{ Body: RecordedEvents }>, reply: FastifyReply) => {
      try {
        // unpack the received events
        const unpackedEvents = request.body.events.map(event => {
          try {
            if (typeof event === 'object') return event;
            return unpack(event);
          } catch (error) {
            server.log.error(`Failed to unpack event: ${error}`);
            return null;
          }
        }).filter(Boolean);

        if (unpackedEvents.length === 0) {
          server.log.info('No valid events to process');
          return reply.send({ status: "ok" });
        }
        server.cdpService.customEmit(EmitEvent.Recording, {
          events: unpackedEvents
        });

        return reply.send({ status: "ok" });
      } catch (error) {
        server.log.error(`Error processing events: ${error}`);
        return reply.status(500).send({ 
          status: "error",
          message: "Failed to process events"
        });
      }
    },
  );

  server.get(
    "/sessions/:id/live-details",
    {
      onRequest: [],
      schema: {
        operationId: "get_session_live_details",
        description: "Returns the live state of the session, including pages, tabs, and browser state",
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
}

export default routes;
