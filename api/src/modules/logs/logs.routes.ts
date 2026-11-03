import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { LogQueryInput } from "./logs.schema.js";
import { randomUUID } from "crypto";
import { $ref } from "../../plugins/schemas.js";
import { EmitEvent } from "../../types/enums.js";
import { SessionServiceError } from "../../services/session.service.js";

const logsRoutes: FastifyPluginAsync = async (fastify) => {
  const logServices = (sessionId?: string) => {
    const session = sessionId
      ? fastify.sessionService.getSession(sessionId)
      : fastify.sessionService.getOnlyActiveSession();
    if (sessionId && !session) return null;
    const cdpService = session?.cdpService ?? fastify.cdpService;
    const logger = cdpService.getInstrumentationLogger();
    return { logger, storage: logger?.getStorage?.(), sessionId: sessionId ?? session?.id };
  };

  const errorReply = (reply: any, error: unknown) => {
    const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
    return reply
      .code(statusCode)
      .send({ message: error instanceof Error ? error.message : String(error) });
  };

  if (!logServices()?.storage) {
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
    async (request: FastifyRequest<{ Querystring: LogQueryInput }>, reply) => {
      const query = request.query;
      let services;
      try {
        services = logServices(query.sessionId);
      } catch (error) {
        return errorReply(reply, error);
      }
      if (!services?.storage) {
        return reply.code(query.sessionId ? 404 : 503).send({
          message: query.sessionId
            ? `Session ${query.sessionId} not found`
            : "Log storage unavailable",
        });
      }

      let result;
      try {
        result = await services.storage.query({
          sessionId: services.sessionId,
          startTime: query.startTime ? new Date(query.startTime) : undefined,
          endTime: query.endTime ? new Date(query.endTime) : undefined,
          eventTypes: query.eventTypes ? query.eventTypes.split(",") : undefined,
          pageId: query.pageId,
          targetType: query.targetType,
          limit: query.limit,
          offset: query.offset,
        });
      } catch (error) {
        fastify.log.error({ err: error }, "Error querying logs");
        throw error;
      }

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
        querystring: $ref("SessionLogQuerySchema"),
        tags: ["Logs"],
        description: "Get statistics about stored browser logs",
      },
    },
    async (request: FastifyRequest<{ Querystring: LogQueryInput }>, reply) => {
      let services;
      try {
        services = logServices(request.query.sessionId);
      } catch (error) {
        return errorReply(reply, error);
      }
      if (!services?.storage) {
        return reply
          .code(request.query.sessionId ? 404 : 503)
          .send({ message: "Log storage unavailable" });
      }
      const stats = await services.storage.getStats({ sessionId: services.sessionId });

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
        querystring: $ref("SessionLogQuerySchema"),
        tags: ["Logs"],
        description: "Stream browser logs in real-time using SSE",
      },
    },
    async (request: FastifyRequest<{ Querystring: Pick<LogQueryInput, "sessionId"> }>, reply) => {
      let services;
      try {
        services = logServices(request.query.sessionId);
      } catch (error) {
        return errorReply(reply, error);
      }
      const logger = services?.logger;

      if (!logger) {
        return reply
          .code(request.query.sessionId ? 404 : 503)
          .send({ error: "Browser logger not available" });
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
        if (services.sessionId && context?.sessionId !== services.sessionId) return;
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
    async (request: FastifyRequest<{ Querystring: LogQueryInput }>, reply) => {
      const query = request.query;
      let services;
      try {
        services = logServices(query.sessionId);
      } catch (error) {
        return errorReply(reply, error);
      }
      if (!services?.storage) {
        return reply.code(query.sessionId ? 404 : 503).send({ message: "Log storage unavailable" });
      }

      // Generate a unique filename
      const fileName = `steel-browser-logs-${randomUUID()}.parquet`;
      const filePath = `/tmp/steel-browser-exports/${fileName}`;

      // Export with optional query filters
      const exportedPath = await services.storage.exportToParquet(filePath, {
        ...query,
        sessionId: services.sessionId,
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        eventTypes: query.eventTypes ? query.eventTypes.split(",") : undefined,
      });

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
        querystring: $ref("SessionLogQuerySchema"),
        tags: ["Logs"],
        description: "Clear all browser logs from storage",
      },
    },
    async (request: FastifyRequest<{ Querystring: Pick<LogQueryInput, "sessionId"> }>, reply) => {
      let services;
      try {
        services = logServices(request.query.sessionId);
      } catch (error) {
        return errorReply(reply, error);
      }
      if (!services?.storage) {
        return reply
          .code(request.query.sessionId ? 404 : 503)
          .send({ message: "Log storage unavailable" });
      }
      await services.storage.clear({ sessionId: services.sessionId });

      return {
        message: "Logs cleared successfully",
      };
    },
  );
};

export default logsRoutes;
