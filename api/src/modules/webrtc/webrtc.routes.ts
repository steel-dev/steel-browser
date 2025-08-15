import {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import webRTCServer from "../../plugins/webrtc/webrtc-server.js";
import streamCapture from "../../plugins/webrtc/stream-capture.js";
import { webRTCDebugUtils } from "../../plugins/webrtc/debug-utils.js";
import fastifyStatic from "@fastify/static";
import * as path from "path";
import * as fs from "fs/promises";

interface DebugQueryParams {
  clientId?: string;
  duration?: string;
  format?: string;
}

interface HealthQueryParams {
  detailed?: string;
}

const webRTCRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Get WebRTC server status and statistics
  fastify.get("/webrtc/status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const serverStats = webRTCServer.getServerStats();
      const streamStats = streamCapture.getStats();
      const isStreamHealthy = streamCapture.isHealthy();

      const status = {
        timestamp: new Date().toISOString(),
        server: {
          activeConnections: serverStats.activeConnections,
          totalBytesReceived: serverStats.totalBytesReceived,
          totalBytesSent: serverStats.totalBytesSent,
          connections: serverStats.connections.map((conn) => ({
            clientId: conn.clientId,
            state: conn.state,
            connectedDuration: conn.connectedDuration
              ? Math.round(conn.connectedDuration / 1000)
              : undefined,
            stats: {
              bytesReceived: conn.stats.bytesReceived,
              bytesSent: conn.stats.bytesSent,
              packetsLost: conn.stats.packetsLost,
              rtt: conn.stats.rtt,
            },
          })),
        },
        stream: {
          active: streamStats.active,
          healthy: isStreamHealthy,
          clients: streamStats.clients,
          rtpStats: {
            packetsReceived: streamStats.rtpStats.packetsReceived,
            bytesReceived: streamStats.rtpStats.bytesReceived,
            packetsPerSecond: Math.round(streamStats.rtpStats.packetsPerSecond),
            bitrateMbps: Math.round((streamStats.rtpStats.bitrate / 1000000) * 100) / 100,
            framerate: Math.round(streamStats.rtpStats.framerate),
          },
          ffmpegStatus: {
            running: streamStats.ffmpegStatus.isRunning,
            pid: streamStats.ffmpegStatus.pid,
            errorCount: streamStats.ffmpegStatus.errorCount,
            restartCount: streamStats.ffmpegStatus.restartCount,
          },
        },
      };

      return reply.code(200).send(status);
    } catch (error) {
      fastify.log.error("Error getting WebRTC status:", error as undefined);
      return reply.code(500).send({
        error: "Failed to get WebRTC status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get detailed system health check
  fastify.get(
    "/webrtc/health",
    async (request: FastifyRequest<{ Querystring: HealthQueryParams }>, reply: FastifyReply) => {
      try {
        const { detailed } = request.query;

        if (detailed === "true") {
          const health = await webRTCDebugUtils.getSystemHealth();
          return reply.code(200).send(health);
        } else {
          // Quick health check
          const streamStats = streamCapture.getStats();
          const serverStats = webRTCServer.getServerStats();
          const isHealthy = streamCapture.isHealthy();

          const quickHealth = {
            timestamp: new Date().toISOString(),
            overall: isHealthy ? "healthy" : "unhealthy",
            summary: {
              streamActive: streamStats.active,
              streamHealthy: isHealthy,
              activeConnections: serverStats.activeConnections,
              packetsReceived: streamStats.rtpStats.packetsReceived,
              ffmpegRunning: streamStats.ffmpegStatus.isRunning,
            },
          };

          return reply.code(200).send(quickHealth);
        }
      } catch (error) {
        fastify.log.error("Error getting system health:", error as undefined);
        return reply.code(500).send({
          error: "Failed to get system health",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Get connection diagnostics for a specific client
  fastify.get(
    "/webrtc/diagnostics/:clientId",
    async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
      try {
        const { clientId } = request.params;

        const diagnostics = await webRTCDebugUtils.getConnectionDiagnostics(clientId);

        if (!diagnostics) {
          return reply.code(404).send({
            error: "Client not found",
            message: `No diagnostics available for client ${clientId}`,
          });
        }

        return reply.code(200).send(diagnostics);
      } catch (error) {
        fastify.log.error(
          `Error getting diagnostics for client ${request.params.clientId}:`,
          error as undefined,
        );
        return reply.code(500).send({
          error: "Failed to get connection diagnostics",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Test WebRTC connectivity
  fastify.post(
    "/webrtc/test-connectivity",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await webRTCDebugUtils.testWebRTCConnectivity();

        const statusCode = result.success ? 200 : 500;

        return reply.code(statusCode).send({
          test: "webrtc-connectivity",
          timestamp: new Date().toISOString(),
          ...result,
        });
      } catch (error) {
        fastify.log.error("Error testing WebRTC connectivity:", error as undefined);
        return reply.code(500).send({
          error: "Failed to test WebRTC connectivity",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Test RTP packet reception
  fastify.post(
    "/webrtc/test-rtp",
    async (request: FastifyRequest<{ Querystring: DebugQueryParams }>, reply: FastifyReply) => {
      try {
        const duration = parseInt(request.query.duration || "10000", 10);

        if (duration < 1000 || duration > 60000) {
          return reply.code(400).send({
            error: "Invalid duration",
            message: "Duration must be between 1000ms and 60000ms",
          });
        }

        const result = await webRTCDebugUtils.testRTPReception(duration);

        return reply.code(200).send({
          test: "rtp-reception",
          timestamp: new Date().toISOString(),
          duration,
          ...result,
        });
      } catch (error) {
        fastify.log.error("Error testing RTP reception:", error as undefined);
        return reply.code(500).send({
          error: "Failed to test RTP reception",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Generate comprehensive debug report
  fastify.get(
    "/webrtc/debug-report",
    async (request: FastifyRequest<{ Querystring: DebugQueryParams }>, reply: FastifyReply) => {
      try {
        const { format } = request.query;

        const report = await webRTCDebugUtils.generateDebugReport();

        if (format === "download") {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `webrtc-debug-report-${timestamp}.json`;

          return reply
            .header("Content-Type", "application/json")
            .header("Content-Disposition", `attachment; filename="${filename}"`)
            .send(report);
        } else {
          return reply.header("Content-Type", "application/json").send(JSON.parse(report));
        }
      } catch (error) {
        fastify.log.error("Error generating debug report:", error as undefined);
        return reply.code(500).send({
          error: "Failed to generate debug report",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Validate WebRTC configuration
  fastify.get("/webrtc/validate-config", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validation = webRTCDebugUtils.validateConfiguration();

      const statusCode = validation.valid ? 200 : 400;

      return reply.code(statusCode).send({
        timestamp: new Date().toISOString(),
        ...validation,
      });
    } catch (error) {
      fastify.log.error("Error validating configuration:", error as undefined);
      return reply.code(500).send({
        error: "Failed to validate configuration",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get list of active clients
  fastify.get("/webrtc/clients", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const activeClients = webRTCServer.getActiveClients();
      const serverStats = webRTCServer.getServerStats();

      const clients = activeClients.map((clientId) => {
        const connection = serverStats.connections.find((c) => c.clientId === clientId);
        const state = webRTCServer.getConnectionState(clientId);

        return {
          clientId,
          state: state?.connectionState || "unknown",
          connectedAt: state?.connectedAt?.toISOString(),
          lastStateChange: state?.lastStateChange?.toISOString(),
          stats: connection?.stats || null,
        };
      });

      return reply.code(200).send({
        timestamp: new Date().toISOString(),
        totalClients: clients.length,
        clients,
      });
    } catch (error) {
      fastify.log.error("Error getting client list:", error as undefined);
      return reply.code(500).send({
        error: "Failed to get client list",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Force cleanup of a specific client connection
  fastify.delete(
    "/webrtc/clients/:clientId",
    async (request: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
      try {
        const { clientId } = request.params;

        const activeClients = webRTCServer.getActiveClients();
        if (!activeClients.includes(clientId)) {
          return reply.code(404).send({
            error: "Client not found",
            message: `Client ${clientId} is not active`,
          });
        }

        await webRTCServer.closePeerConnection(clientId);
        streamCapture.removeClient(clientId);

        fastify.log.info(`Manually closed connection for client ${clientId}`);

        return reply.code(200).send({
          message: `Connection closed for client ${clientId}`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        fastify.log.error(
          `Error closing connection for client ${request.params.clientId}:`,
          error as undefined,
        );
        return reply.code(500).send({
          error: "Failed to close client connection",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Start health monitoring
  fastify.post(
    "/webrtc/start-monitoring",
    async (request: FastifyRequest<{ Body: { intervalMs?: number } }>, reply: FastifyReply) => {
      try {
        const body = (request.body as { intervalMs?: number }) || {};
        const intervalMs = body.intervalMs || 15000;

        if (intervalMs < 5000 || intervalMs > 300000) {
          return reply.code(400).send({
            error: "Invalid interval",
            message: "Interval must be between 5000ms and 300000ms",
          });
        }

        webRTCDebugUtils.startHealthMonitoring(intervalMs);

        return reply.code(200).send({
          message: "Health monitoring started",
          intervalMs,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        fastify.log.error("Error starting health monitoring:", error as undefined);
        return reply.code(500).send({
          error: "Failed to start health monitoring",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Stop health monitoring
  fastify.post("/webrtc/stop-monitoring", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      webRTCDebugUtils.stopHealthMonitoring();

      return reply.code(200).send({
        message: "Health monitoring stopped",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error("Error stopping health monitoring:", error as undefined);
      return reply.code(500).send({
        error: "Failed to stop health monitoring",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Log current system status
  fastify.post("/webrtc/log-status", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await webRTCDebugUtils.logSystemStatus();

      return reply.code(200).send({
        message: "System status logged",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error("Error logging system status:", error as undefined);
      return reply.code(500).send({
        error: "Failed to log system status",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  fastify.register(fastifyStatic, {
    root: path.resolve(process.cwd(), "recordings"),
    prefix: "/recordings/",
    decorateReply: false,
  });

  fastify.get("/webrtc/recordings", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const recordingsDir = path.resolve(process.cwd(), "recordings");
      const files = await fs.readdir(recordingsDir);
      const mp4Files = files
        .filter((file) => file.endsWith(".mp4"))
        .map((file) => {
          const url = `/recordings/${file}`;
          return {
            filename: file,
            url: url,
          };
        });

      return reply.code(200).send({
        timestamp: new Date().toISOString(),
        recordings: mp4Files,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        fastify.log.warn("Recordings directory does not exist yet.");
        return reply.code(200).send({
          timestamp: new Date().toISOString(),
          recordings: [],
        });
      }
      fastify.log.error("Error listing recordings:", error as undefined);
      return reply.code(500).send({
        error: "Failed to list recordings",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
};

export default webRTCRoutes;
