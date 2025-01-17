import { FastifyInstance, FastifyReply } from "fastify";
import { handlePDF, handleScrape, handleScreenshot } from "./actions.controller";
import { $ref } from "../../plugins/schemas";
import { PDFRequest, ScrapeRequest, ScreenshotRequest } from "./actions.schema";

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
        response: {
          200: $ref("ScrapeResponse"),
        },
      },
    },
    async (request: ScrapeRequest, reply: FastifyReply) => handleScrape(server.sessionService, server.cdpService, request, reply),
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
        response: {
          200: $ref("ScreenshotResponse"),
        },
      },
    },
    async (request: ScreenshotRequest, reply: FastifyReply) => handleScreenshot(server.sessionService, server.cdpService, request, reply),
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
        response: {
          200: $ref("PDFResponse"),
        },
      },
    },
    async (request: PDFRequest, reply: FastifyReply) => handlePDF(server.sessionService, server.cdpService, request, reply),
  );
}

export default routes;
