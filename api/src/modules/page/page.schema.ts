import { FastifyRequest } from "fastify";
import { z } from "zod";
import { ScrapeFormat } from "../../types/enums";

const CurrentPageScrapeRequest = z.object({
  format: z.array(z.nativeEnum(ScrapeFormat)).optional(),
  screenshot: z.boolean().optional(),
  pdf: z.boolean().optional(),
  delay: z.number().optional(),
  logUrl: z.string().optional(),
});

const CurrentPageScrapeResponse = z.object({
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

const CurrentPageScreenshotRequest = z.object({
  delay: z.number().optional(),
  fullPage: z.boolean().optional(),
  logUrl: z.string().optional(),
});

const CurrentPageScreenshotResponse = z.any();

const CurrentPagePDFRequest = z.object({
  delay: z.number().optional(),
  logUrl: z.string().optional(),
});

const CurrentPagePDFResponse = z.any();

export type CurrentPageScrapeRequestBody = z.infer<typeof CurrentPageScrapeRequest>;
export type CurrentPageScrapeRequest = FastifyRequest<{ Body: CurrentPageScrapeRequestBody }>;

export type CurrentPageScreenshotRequestBody = z.infer<typeof CurrentPageScreenshotRequest>;
export type CurrentPageScreenshotRequest = FastifyRequest<{ Body: CurrentPageScreenshotRequestBody }>;

export type CurrentPagePDFRequestBody = z.infer<typeof CurrentPagePDFRequest>;
export type CurrentPagePDFRequest = FastifyRequest<{ Body: CurrentPagePDFRequestBody }>;

export const pageSchemas = {
  CurrentPageScrapeRequest,
  CurrentPageScrapeResponse,
  CurrentPagePDFRequest,
  CurrentPagePDFResponse,
  CurrentPageScreenshotRequest,
  CurrentPageScreenshotResponse,
};

export default pageSchemas;
