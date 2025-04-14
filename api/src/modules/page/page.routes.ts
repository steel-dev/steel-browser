import { FastifyInstance, FastifyReply } from "fastify";
import { handleCurrentPagePDF, handleCurrentPageScrape, handleCurrentPageScreenshot } from "./page.controller";
import { $ref } from "../../plugins/schemas";
import { CurrentPageScreenshotRequest, CurrentPageScrapeRequest, CurrentPagePDFRequest } from "./page.schema";

async function routes(server: FastifyInstance) {
  server.post(
    "/page/scrape",
    {
      schema: {
        operationId: "scrape",
        description: "Scrape Current Page",
        tags: ["Browser Actions"],
        summary: "Scrape Current Page",
        body: $ref("CurrentPageScrapeRequest"),
        response: {
          200: $ref("CurrentPageScrapeResponse"),
        },
      },
    },
    async (request: CurrentPageScrapeRequest, reply: FastifyReply) =>
      handleCurrentPageScrape(server.sessionService, server.cdpService, request, reply),
  );
  server.post(
    "/page/screenshot",
    {
      schema: {
        operationId: "screenshot",
        description: "Take a screenshot of current page",
        tags: ["Browser Actions"],
        summary: "Take a screenshot of current page",
        body: $ref("CurrentPageScreenshotRequest"),
        response: {
          200: $ref("CurrentPageScreenshotResponse"),
        },
      },
    },
    async (request: CurrentPageScreenshotRequest, reply: FastifyReply) =>
      handleCurrentPageScreenshot(server.sessionService, server.cdpService, request, reply),
  );

  server.post(
    "/page/pdf",
    {
      schema: {
        operationId: "pdf",
        description: "Get the PDF content of current page",
        tags: ["Browser Actions"],
        summary: "Get the PDF content of current page",
        body: $ref("CurrentPagePDFRequest"),
        response: {
          200: $ref("CurrentPagePDFResponse"),
        },
      },
    },
    async (request: CurrentPagePDFRequest, reply: FastifyReply) =>
      handleCurrentPagePDF(server.sessionService, server.cdpService, request, reply),
  );
}

export default routes;
