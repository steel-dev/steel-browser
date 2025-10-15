import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { LogQuerySchema, ExportLogsSchema } from "./logs.schema.js";
import { randomUUID } from "crypto";
import { $ref } from "../../plugins/schemas.js";
import { LogQuery } from "../../services/cdp/instrumentation/storage/index.js";
import { EmitEvent } from "../../types/enums.js";

const logsRoutes: FastifyPluginAsync = async (fastify) => {
  const storage = fastify.cdpService.getInstrumentationLogger()?.getStorage?.();

  if (!storage) {
    fastify.log.warn("Log storage not available. Logs routes will not work.");
    return;
  }

  /**
   * Query logs from local storage
   */
  fastify.get(
    "/query",
    {
      schema: {
        querystring: $ref("LogQuerySchema"),
        tags: ["Logs"],
        description: "Query browser logs from local storage",
      },
    },
    async (request: FastifyRequest<{ Querystring: LogQuery }>) => {
      const query = request.query;

      const result = await storage.query({
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        eventTypes: query.eventTypes,
        pageId: query.pageId,
        targetType: query.targetType,
        limit: query.limit,
        offset: query.offset,
      });

      return result;
    },
  );

  /**
   * Get log statistics
   */
  fastify.get(
    "/stats",
    {
      schema: {
        tags: ["Logs"],
        description: "Get statistics about stored browser logs",
      },
    },
    async () => {
      const stats = await storage.getStats();

      return {
        totalEvents: stats.totalEvents,
        oldestEvent: stats.oldestEvent?.toISOString() || null,
        newestEvent: stats.newestEvent?.toISOString() || null,
        sizeBytes: stats.sizeBytes,
      };
    },
  );

  /**
   * Stream logs in real-time using Server-Sent Events
   */
  fastify.get(
    "/stream",
    {
      schema: {
        tags: ["Logs"],
        description: "Stream browser logs in real-time using SSE",
      },
    },
    async (request, reply) => {
      const logger = fastify.cdpService.getInstrumentationLogger();

      if (!logger) {
        return reply.code(503).send({ error: "Browser logger not available" });
      }

      // Set SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send initial comment to establish connection
      reply.raw.write(": connected\n\n");

      // Listen for new log events
      const handleLog = (event: any, context: any) => {
        const data = JSON.stringify({ ...event, ...context });
        reply.raw.write(`data: ${data}\n\n`);
      };

      logger.on?.(EmitEvent.Log, handleLog);

      // Clean up on disconnect
      request.raw.on("close", () => {
        logger.off?.(EmitEvent.Log, handleLog);
      });
    },
  );

  /**
   * Export logs to Parquet format
   */
  fastify.post(
    "/export",
    {
      schema: {
        querystring: $ref("LogQuerySchema"),
        tags: ["Logs"],
        description: "Export browser logs to Parquet format",
      },
    },
    async (request: FastifyRequest<{ Querystring: LogQuery }>) => {
      const query = request.query;

      // Generate a unique filename
      const fileName = `steel-browser-logs-${randomUUID()}.parquet`;
      const filePath = `/tmp/steel-browser-exports/${fileName}`;

      // Export with optional query filters
      const exportedPath = await storage.exportToParquet(filePath, query);

      return {
        filePath: exportedPath,
        message: "Logs exported successfully",
      };
    },
  );

  /**
   * Clear all logs from storage
   */
  fastify.delete(
    "/",
    {
      schema: {
        tags: ["Logs"],
        description: "Clear all browser logs from storage",
      },
    },
    async () => {
      await storage.clear();

      return {
        message: "Logs cleared successfully",
      };
    },
  );
};

export default logsRoutes;
