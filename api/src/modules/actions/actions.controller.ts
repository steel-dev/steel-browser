import { FastifyReply } from "fastify";
import { CDPService } from "../../services/cdp/cdp.service.js";
import { SessionService } from "../../services/session.service.js";
import { scrape, pdf, screenshot, search } from "./actions.service.js";
import { PDFRequest, ScrapeRequest, ScreenshotRequest, SearchRequest } from "./actions.schema.js";

export const handleScrape = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: ScrapeRequest,
  reply: FastifyReply,
) => {
  try {
    const { url, format, pdf, screenshot, proxyUrl, logUrl } = request.body;
    const scrapeResponse = await scrape(
      sessionService,
      browserService,
      url,
      format,
      pdf,
      screenshot,
      proxyUrl,
      logUrl,
    );
    if (scrapeResponse) {
      return reply.code(200).send(scrapeResponse);
    }
  } catch (error: any) {
    console.error(error);
    return reply.code(500).send({ error: error.message });
  }
};

export const handleSearch = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: SearchRequest,
  reply: FastifyReply,
) => {
  try {
    const { query, proxyUrl, logUrl } = request.body;
    const searchResponse = await search(sessionService, browserService, query, proxyUrl, logUrl);
    if (searchResponse) {
      return reply.code(200).send(searchResponse);
    }
  } catch (error: any) {
    console.error(error);
    return reply.code(500).send({ error: error.message });
  }
};

export const handleScreenshot = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: ScreenshotRequest,
  reply: FastifyReply,
) => {
  try {
    const { url, delay, fullPage, proxyUrl, logUrl } = request.body;
    const screenshotResponse = await screenshot(
      sessionService,
      browserService,
      url,
      logUrl,
      proxyUrl,
      delay,
      fullPage,
    );
    if (screenshotResponse) {
      return reply.code(200).send(screenshotResponse);
    }
  } catch (error: any) {
    console.error(error);
    return reply.code(500).send({ error: error.message });
  }
};

export const handlePDF = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: PDFRequest,
  reply: FastifyReply,
) => {
  try {
    const { url, delay, proxyUrl, logUrl } = request.body;
    const scrapeResponse = await pdf(sessionService, browserService, url, logUrl, proxyUrl, delay);
    if (scrapeResponse) {
      return reply.code(200).send(scrapeResponse);
    }
  } catch (error: any) {
    console.error(error);
    return reply.code(500).send({ error: error.message });
  }
};
