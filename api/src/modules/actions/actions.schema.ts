import { FastifyRequest } from "fastify";
import { z } from "zod";
import { ScrapeFormat } from "../../types/enums";

const ScrapeRequest = z.object({
  url: z.string(),
  format: z.array(z.nativeEnum(ScrapeFormat)).optional(),
  screenshot: z.boolean().optional(),
  pdf: z.boolean().optional(),
  proxyUrl: z.string().nullable().optional().describe("Proxy URL to use for the scrape. Provide `null` to disable proxy. If not provided, current session proxy settings will be used."),
  delay: z.number().optional(),
  logUrl: z.string().optional(),
});

const ScrapeResponse = z.object({
  content: z.record(z.nativeEnum(ScrapeFormat), z.any()),
  metadata: z.object({
    title: z.string().optional(),
    ogImage: z.string().optional(),
    ogTitle: z.string().optional(),
    urlSource: z.string().optional(),
    description: z.string().optional(),
    ogDescription: z.string().optional(),
    statusCode: z.number().int(),
    language: z.string().optional(),
    timestamp: z.string().datetime().optional(),
    published_timestamp: z.string().datetime().optional(),
  }),
  links: z.array(
    z.object({
      url: z.string(),
      text: z.string(),
    }),
  ),
  screenshot: z.string().optional(),
  pdf: z.string().optional(),
});

const ScreenshotRequest = z.object({
  url: z.string(),
  proxyUrl: z.string().nullable().optional().describe("Proxy URL to use for the scrape. Provide `null` to disable proxy. If not provided, current session proxy settings will be used."),
  delay: z.number().optional(),
  fullPage: z.boolean().optional(),
  logUrl: z.string().optional(),
});

const ScreenshotResponse = z.any();

const PDFRequest = z.object({
  url: z.string(),
  proxyUrl: z.string().nullable().optional().describe("Proxy URL to use for PDF export. Provide `null` to disable proxy. If not provided, current session proxy settings will be used."),
  delay: z.number().optional(),
  logUrl: z.string().optional(),
});

const PDFResponse = z.any();

export type ScrapeRequestBody = z.infer<typeof ScrapeRequest>;
export type ScrapeRequest = FastifyRequest<{ Body: ScrapeRequestBody }>;

export type ScreenshotRequestBody = z.infer<typeof ScreenshotRequest>;
export type ScreenshotRequest = FastifyRequest<{ Body: ScreenshotRequestBody }>;

export type PDFRequestBody = z.infer<typeof PDFRequest>;
export type PDFRequest = FastifyRequest<{ Body: PDFRequestBody }>;

export const actionsSchemas = {
  ScrapeRequest,
  ScrapeResponse,
  ScreenshotRequest,
  ScreenshotResponse,
  PDFRequest,
  PDFResponse,
};

export default actionsSchemas;
