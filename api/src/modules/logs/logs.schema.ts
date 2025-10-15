import { z } from "zod";

export const LogQuerySchema = z.object({
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  eventTypes: z.string().optional(),
  pageId: z.string().optional(),
  targetType: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
});

export const LogStatsSchema = z.object({
  totalEvents: z.number(),
  oldestEvent: z.string().datetime().nullable(),
  newestEvent: z.string().datetime().nullable(),
  sizeBytes: z.number(),
});

export const LogQueryResultSchema = z.object({
  events: z.array(z.record(z.any())),
  total: z.number(),
  hasMore: z.boolean(),
});

export const ExportLogsSchema = z.object({
  query: LogQuerySchema.optional(),
});

export type LogQueryInput = z.infer<typeof LogQuerySchema>;
export type LogStatsOutput = z.infer<typeof LogStatsSchema>;
export type LogQueryResultOutput = z.infer<typeof LogQueryResultSchema>;
export type ExportLogsInput = z.infer<typeof ExportLogsSchema>;

export const loggingSchemas = {
  LogQuerySchema,
  LogStatsSchema,
  LogQueryResultSchema,
  ExportLogsSchema,
};

export default loggingSchemas;
