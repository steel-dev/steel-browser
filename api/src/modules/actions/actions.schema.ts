import { FastifyRequest } from "fastify";
import { z } from "zod";
import { ScrapeFormat } from "../../types/enums.js";

const ScrapeRequest = z.object({
  url: z.string().optional(),
  format: z.array(z.nativeEnum(ScrapeFormat)).optional(),
  screenshot: z.boolean().optional(),
  pdf: z.boolean().optional(),
  proxyUrl: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Proxy URL to use for the scrape. Provide `null` to disable proxy. If not provided, current session proxy settings will be used.",
    ),
  delay: z.number().optional(),
  logUrl: z.string().optional(),
});

const ScrapeResponse = z.object({
  content: z.record(z.nativeEnum(ScrapeFormat), z.any()),
  metadata: z.object({
    title: z.string().optional(),
    language: z.string().optional(),
    urlSource: z.string().optional(),
    timestamp: z.string().datetime().optional(),

    description: z.string().optional(),
    keywords: z.string().optional(),
    author: z.string().optional(),

    ogTitle: z.string().optional(),
    ogDescription: z.string().optional(),
    ogImage: z.string().optional(),
    ogUrl: z.string().optional(),
    ogSiteName: z.string().optional(),

    articleAuthor: z.string().optional(),
    publishedTime: z.string().optional(),
    modifiedTime: z.string().optional(),

    canonical: z.string().optional(),
    favicon: z.string().optional(),

    jsonLd: z.any().optional(),
    statusCode: z.number().int(),
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
  url: z.string().optional(),
  proxyUrl: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Proxy URL to use for the scrape. Provide `null` to disable proxy. If not provided, current session proxy settings will be used.",
    ),
  delay: z.number().optional(),
  fullPage: z.boolean().optional(),
  logUrl: z.string().optional(),
});

const ScreenshotResponse = z.any();

const PDFRequest = z.object({
  url: z.string().optional(),
  proxyUrl: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Proxy URL to use for the scrape. Provide `null` to disable proxy. If not provided, current session proxy settings will be used.",
    ),
  delay: z.number().optional(),
  logUrl: z.string().optional(),
});

const SearchRequest = z.object({
  query: z.string(),
  proxyUrl: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Proxy URL to use for the scrape. Provide `null` to disable proxy. If not provided, current session proxy settings will be used.",
    ),
  logUrl: z.string().optional(),
});

const SearchResponse = z.object({
  results: z.array(
    z.object({
      title: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
    }),
  ),
});

const PDFResponse = z.any();

export type ScrapeRequestBody = z.infer<typeof ScrapeRequest>;
export type ScrapeRequest = FastifyRequest<{ Body: ScrapeRequestBody }>;

export type ScreenshotRequestBody = z.infer<typeof ScreenshotRequest>;
export type ScreenshotRequest = FastifyRequest<{ Body: ScreenshotRequestBody }>;

export type PDFRequestBody = z.infer<typeof PDFRequest>;
export type PDFRequest = FastifyRequest<{ Body: PDFRequestBody }>;

export type SearchRequestBody = z.infer<typeof SearchRequest>;
export type SearchRequest = FastifyRequest<{ Body: SearchRequestBody }>;

export const actionsSchemas = {
  ScrapeRequest,
  ScrapeResponse,
  ScreenshotRequest,
  ScreenshotResponse,
  PDFRequest,
  PDFResponse,
  SearchRequest,
  SearchResponse,
};

export default actionsSchemas;
