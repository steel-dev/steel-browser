import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { handlePDF, handleScrape, handleScreenshot, handleSearch } from "./actions.controller.js";
import { $ref } from "../../plugins/schemas.js";
import { PDFRequest, ScrapeRequest, ScreenshotRequest, SearchRequest } from "./actions.schema.js";
import { quickAction } from "../commands/commands.guard.js";
import { SessionServiceError } from "../../services/session.service.js";
import type { CDPService } from "../../services/cdp/cdp.service.js";

type BrowserAction = (cdpService: CDPService, sessionId?: string) => Promise<unknown>;

async function runAction(
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  action: BrowserAction,
  sessionId?: string,
) {
  try {
    const session = sessionId
      ? server.sessionService.resolveLiveSession(sessionId)
      : server.sessionService.getOnlyActiveSession();
    if (session?.isSelenium) {
      return reply.code(409).send({ message: "This action requires a CDP browser session." });
    }
    const cdpService = session?.cdpService ?? server.cdpService;
    return quickAction(
      server,
      request as { body?: { proxyUrl?: string | null } },
      reply,
      () => action(cdpService, session?.id),
      session?.id,
    );
  } catch (error) {
    const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
    return reply.code(statusCode).send({
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function routes(server: FastifyInstance) {
  server.post(
    "/scrape",
    {
      schema: {
        operationId: "scrape",
        description: "Scrape a URL",
        tags: ["Browser Actions"],
        summary: "Scrape a URL",
        body: $ref("ScrapeRequest"),
        response: { 200: $ref("ScrapeResponse") },
      },
    },
    async (request: ScrapeRequest, reply: FastifyReply) =>
      runAction(server, request, reply, (cdpService, sessionId) =>
        handleScrape(server.sessionService, cdpService, request, reply, sessionId),
      ),
  );

  server.post(
    "/screenshot",
    {
      schema: {
        operationId: "screenshot",
        description: "Take a screenshot",
        tags: ["Browser Actions"],
        summary: "Take a screenshot",
        body: $ref("ScreenshotRequest"),
        response: { 200: $ref("ScreenshotResponse") },
      },
    },
    async (request: ScreenshotRequest, reply: FastifyReply) =>
      runAction(server, request, reply, (cdpService, sessionId) =>
        handleScreenshot(server.sessionService, cdpService, request, reply, sessionId),
      ),
  );

  server.post(
    "/pdf",
    {
      schema: {
        operationId: "pdf",
        description: "Get the PDF content of a page",
        tags: ["Browser Actions"],
        summary: "Get the PDF content of a page",
        body: $ref("PDFRequest"),
        response: { 200: $ref("PDFResponse") },
      },
    },
    async (request: PDFRequest, reply: FastifyReply) =>
      runAction(server, request, reply, (cdpService, sessionId) =>
        handlePDF(server.sessionService, cdpService, request, reply, sessionId),
      ),
  );

  server.post(
    "/search",
    {
      schema: {
        operationId: "search",
        description: "Use a search engine to search for URLs given a query",
        tags: ["Browser Actions"],
        summary: "Search for URLs",
        body: $ref("SearchRequest"),
        response: { 200: $ref("SearchResponse") },
      },
    },
    async (request: SearchRequest, reply: FastifyReply) =>
      runAction(server, request, reply, (cdpService, sessionId) =>
        handleSearch(server.sessionService, cdpService, request, reply, sessionId),
      ),
  );

  server.post(
    "/sessions/:sessionId/scrape",
    {
      schema: {
        operationId: "scrape_session_by_id",
        summary: "Scrape a browser session",
        description: "Scrape the current page in the specified browser session.",
        tags: ["Browser Actions"],
        body: $ref("ScrapeRequest"),
        response: { 200: $ref("ScrapeResponse") },
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Body: ScrapeRequest["body"] }>,
      reply,
    ) =>
      runAction(
        server,
        request,
        reply,
        (cdpService, sessionId) =>
          handleScrape(
            server.sessionService,
            cdpService,
            request as ScrapeRequest,
            reply,
            sessionId,
          ),
        request.params.sessionId,
      ),
  );

  server.post(
    "/sessions/:sessionId/screenshot",
    {
      schema: {
        operationId: "screenshot_session_by_id",
        summary: "Take a screenshot of a browser session",
        tags: ["Browser Actions"],
        body: $ref("ScreenshotRequest"),
        response: { 200: $ref("ScreenshotResponse") },
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Body: ScreenshotRequest["body"] }>,
      reply,
    ) =>
      runAction(
        server,
        request,
        reply,
        (cdpService, sessionId) =>
          handleScreenshot(
            server.sessionService,
            cdpService,
            request as ScreenshotRequest,
            reply,
            sessionId,
          ),
        request.params.sessionId,
      ),
  );

  server.post(
    "/sessions/:sessionId/pdf",
    {
      schema: {
        operationId: "pdf_session_by_id",
        summary: "Generate a PDF for a browser session",
        tags: ["Browser Actions"],
        body: $ref("PDFRequest"),
        response: { 200: $ref("PDFResponse") },
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Body: PDFRequest["body"] }>,
      reply,
    ) =>
      runAction(
        server,
        request,
        reply,
        (cdpService, sessionId) =>
          handlePDF(server.sessionService, cdpService, request as PDFRequest, reply, sessionId),
        request.params.sessionId,
      ),
  );

  server.post(
    "/sessions/:sessionId/search",
    {
      schema: {
        operationId: "search_session_by_id",
        summary: "Search in a browser session",
        tags: ["Browser Actions"],
        body: $ref("SearchRequest"),
        response: { 200: $ref("SearchResponse") },
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Body: SearchRequest["body"] }>,
      reply,
    ) =>
      runAction(
        server,
        request,
        reply,
        (cdpService, sessionId) =>
          handleSearch(server.sessionService, cdpService, request as SearchRequest, reply, sessionId),
        request.params.sessionId,
      ),
  );
}

export default routes;
