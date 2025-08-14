import * as wrtc from "@roamhq/wrtc";
import { WebSocket } from "ws";
import { exec } from "child_process";
import { promisify } from "util";
import webRTCServer from "./webrtc-server.js";
import streamCapture from "./stream-capture.js";

const execAsync = promisify(exec);

// Debug logging utility
class DebugLogger {
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.WEBRTC_DEBUG === "true" || process.env.NODE_ENV === "development";
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  debug(message: string, data?: any): void {
    if (!this.enabled) return;

    const logMessage = `[${this.timestamp()}] [WebRTC-DEBUG] ${message}`;
    if (data) {
      console.log(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(logMessage);
    }
  }

  info(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [WebRTC-DEBUG] INFO: ${message}`;
    if (data) {
      console.log(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(logMessage);
    }
  }

  warn(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [WebRTC-DEBUG] WARN: ${message}`;
    if (data) {
      console.warn(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.warn(logMessage);
    }
  }

  error(message: string, error?: any): void {
    const logMessage = `[${this.timestamp()}] [WebRTC-DEBUG] ERROR: ${message}`;
    if (error) {
      console.error(logMessage, error);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
    } else {
      console.error(logMessage);
    }
  }
}

// System health check interface
interface SystemHealth {
  timestamp: string;
  display: {
    available: boolean;
    resolution?: string;
    error?: string;
  };
  ffmpeg: {
    running: boolean;
    processes: number;
    pids: number[];
    error?: string;
  };
  network: {
    rtpPortOpen: boolean;
    webSocketConnections: number;
    error?: string;
  };
  memory: {
    usage: NodeJS.MemoryUsage;
    heapUsedMB: number;
    heapTotalMB: number;
  };
  webrtc: {
    activeConnections: number;
    totalBytesTransferred: number;
    connectionStates: Array<{
      clientId: string;
      state: string;
      duration?: number;
    }>;
  };
  streamCapture: {
    active: boolean;
    healthy: boolean;
    clients: number;
    packetsReceived: number;
    bitrateMbps: number;
  };
}

// Connection diagnostics interface
interface ConnectionDiagnostics {
  clientId: string;
  timestamp: string;
  webSocket: {
    state: number;
    url?: string;
    protocol?: string;
    readyState: string;
  };
  webRTC: {
    connectionState?: string;
    iceConnectionState?: string;
    iceGatheringState?: string;
    signalingState?: string;
    localDescription?: {
      type?: string;
      sdpLength?: number;
    };
    remoteDescription?: {
      type?: string;
      sdpLength?: number;
    };
    iceCandidates?: number;
    stats?: any;
  };
  performance: {
    bytesReceived: number;
    bytesSent: number;
    packetsLost: number;
    rtt: number;
    jitter: number;
  };
  errors: string[];
}

export class WebRTCDebugUtils {
  private logger = new DebugLogger();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  constructor() {
    this.logger.info("WebRTC Debug Utils initialized");
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitoring(intervalMs: number = 15000): void {
    if (this.isMonitoring) {
      this.logger.warn("Health monitoring already running");
      return;
    }

    this.logger.info("Starting health monitoring", { intervalMs });
    this.isMonitoring = true;

    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        this.analyzeHealth(health);
      } catch (error) {
        this.logger.error("Error during health check", error);
      }
    }, intervalMs);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.isMonitoring = false;
      this.logger.info("Health monitoring stopped");
    }
  }

  /**
   * Get comprehensive system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const health: SystemHealth = {
      timestamp: new Date().toISOString(),
      display: { available: false },
      ffmpeg: { running: false, processes: 0, pids: [] },
      network: { rtpPortOpen: false, webSocketConnections: 0 },
      memory: {
        usage: process.memoryUsage(),
        heapUsedMB: 0,
        heapTotalMB: 0,
      },
      webrtc: {
        activeConnections: 0,
        totalBytesTransferred: 0,
        connectionStates: [],
      },
      streamCapture: {
        active: false,
        healthy: false,
        clients: 0,
        packetsReceived: 0,
        bitrateMbps: 0,
      },
    };

    // Check memory usage
    health.memory.heapUsedMB = Math.round(health.memory.usage.heapUsed / 1024 / 1024);
    health.memory.heapTotalMB = Math.round(health.memory.usage.heapTotal / 1024 / 1024);

    // Check display availability
    try {
      const display = process.env.DISPLAY || ":10.0";
      const { stdout } = await execAsync(`DISPLAY=${display} xdpyinfo`);

      // Extract resolution information
      const resolutionMatch = stdout.match(/dimensions:\s+(\d+x\d+)/);
      health.display.available = true;
      health.display.resolution = resolutionMatch ? resolutionMatch[1] : "unknown";
    } catch (error) {
      health.display.available = false;
      health.display.error = error instanceof Error ? error.message : "Unknown error";
    }

    // Check FFmpeg processes
    try {
      const { stdout } = await execAsync("pgrep -f 'ffmpeg.*x11grab'");
      const pids = stdout
        .trim()
        .split("\n")
        .filter((pid) => pid)
        .map((pid) => parseInt(pid, 10));

      health.ffmpeg.running = pids.length > 0;
      health.ffmpeg.processes = pids.length;
      health.ffmpeg.pids = pids;
    } catch (error) {
      health.ffmpeg.running = false;
      health.ffmpeg.error = error instanceof Error ? error.message : "Unknown error";
    }

    // Check network ports
    try {
      const rtpPort = process.env.RTP_PORT || "5004";
      const { stdout } = await execAsync(`netstat -ln | grep :${rtpPort}`);
      health.network.rtpPortOpen = stdout.includes(`:${rtpPort}`);
    } catch (error) {
      health.network.rtpPortOpen = false;
      health.network.error = error instanceof Error ? error.message : "Unknown error";
    }

    // Get WebRTC server stats
    try {
      const serverStats = webRTCServer.getServerStats();
      health.webrtc.activeConnections = serverStats.activeConnections;
      health.webrtc.totalBytesTransferred =
        serverStats.totalBytesReceived + serverStats.totalBytesSent;
      health.webrtc.connectionStates = serverStats.connections.map((conn) => ({
        clientId: conn.clientId,
        state: conn.state,
        duration: conn.connectedDuration,
      }));
    } catch (error) {
      this.logger.error("Error getting WebRTC server stats", error);
    }

    // Get stream capture stats
    try {
      const streamStats = streamCapture.getStats();
      health.streamCapture.active = streamStats.active;
      health.streamCapture.healthy = streamCapture.isHealthy();
      health.streamCapture.clients = streamStats.clients;
      health.streamCapture.packetsReceived = streamStats.rtpStats.packetsReceived;
      health.streamCapture.bitrateMbps =
        Math.round((streamStats.rtpStats.bitrate / 1000000) * 100) / 100;
    } catch (error) {
      this.logger.error("Error getting stream capture stats", error);
    }

    return health;
  }

  /**
   * Analyze health status and log warnings
   */
  private analyzeHealth(health: SystemHealth): void {
    const issues: string[] = [];

    // Check for critical issues
    if (!health.display.available) {
      issues.push("Display not available");
    }

    if (!health.ffmpeg.running) {
      issues.push("FFmpeg not running");
    }

    if (!health.network.rtpPortOpen) {
      issues.push("RTP port not open");
    }

    if (health.memory.heapUsedMB > 500) {
      issues.push(`High memory usage: ${health.memory.heapUsedMB}MB`);
    }

    if (health.streamCapture.active && !health.streamCapture.healthy) {
      issues.push("Stream capture unhealthy");
    }

    if (health.webrtc.activeConnections > 0 && health.streamCapture.packetsReceived === 0) {
      issues.push("No RTP packets received despite active connections");
    }

    // Log summary
    if (issues.length > 0) {
      this.logger.warn("Health check found issues", {
        issues,
        summary: {
          display: health.display.available,
          ffmpeg: health.ffmpeg.running,
          activeConnections: health.webrtc.activeConnections,
          memoryMB: health.memory.heapUsedMB,
        },
      });
    } else {
      this.logger.debug("Health check passed", {
        summary: {
          display: health.display.available,
          ffmpeg: health.ffmpeg.running,
          activeConnections: health.webrtc.activeConnections,
          packetsReceived: health.streamCapture.packetsReceived,
          bitrateMbps: health.streamCapture.bitrateMbps,
        },
      });
    }
  }

  /**
   * Get detailed connection diagnostics
   */
  async getConnectionDiagnostics(clientId: string): Promise<ConnectionDiagnostics | null> {
    this.logger.debug(`Getting diagnostics for client ${clientId}`);

    try {
      const webrtcState = webRTCServer.getConnectionState(clientId);
      const webrtcStats = webRTCServer.getConnectionStats(clientId);

      if (!webrtcState) {
        this.logger.warn(`No WebRTC state found for client ${clientId}`);
        return null;
      }

      const diagnostics: ConnectionDiagnostics = {
        clientId,
        timestamp: new Date().toISOString(),
        webSocket: {
          state: 0, // Will be populated if WebSocket is available
          readyState: "unknown",
        },
        webRTC: {
          connectionState: webrtcState.connectionState,
          iceConnectionState: webrtcState.iceConnectionState,
          iceGatheringState: webrtcState.iceGatheringState,
          signalingState: webrtcState.signalingState,
        },
        performance: {
          bytesReceived: webrtcStats?.bytesReceived || 0,
          bytesSent: webrtcStats?.bytesSent || 0,
          packetsLost: webrtcStats?.packetsLost || 0,
          rtt: webrtcStats?.rtt || 0,
          jitter: webrtcStats?.jitter || 0,
        },
        errors: [],
      };

      return diagnostics;
    } catch (error) {
      this.logger.error(`Error getting diagnostics for client ${clientId}`, error);
      return null;
    }
  }

  /**
   * Test WebRTC connectivity with a dummy peer connection
   */
  async testWebRTCConnectivity(): Promise<{
    success: boolean;
    timeToConnect?: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      timeToConnect: undefined as number | undefined,
      errors: [] as string[],
    };

    const startTime = Date.now();
    this.logger.info("Testing WebRTC connectivity...");

    try {
      // Create a test peer connection
      const pc = new wrtc.RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      let iceCandidatesReceived = 0;
      let connectivityCheckPassed = false;

      // Set up event listeners
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          iceCandidatesReceived++;
          this.logger.debug("Test ICE candidate received", {
            candidate: event.candidate.candidate,
            component: event.candidate.component,
            protocol: event.candidate.protocol,
          });
        } else {
          this.logger.debug("ICE gathering completed for test connection");
        }
      };

      pc.onconnectionstatechange = () => {
        this.logger.debug("Test connection state changed", {
          state: pc.connectionState,
        });

        if (pc.connectionState === "connected") {
          connectivityCheckPassed = true;
          result.success = true;
          result.timeToConnect = Date.now() - startTime;
        }
      };

      // Create a data channel to trigger ICE gathering
      const dataChannel = pc.createDataChannel("test");

      dataChannel.onopen = () => {
        this.logger.debug("Test data channel opened");
      };

      dataChannel.onerror = (error) => {
        this.logger.error("Test data channel error", error);
        result.errors.push("Data channel error");
      };

      // Create offer to start the connection process
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.logger.debug("Test offer created and local description set");

      // Wait for ICE candidates
      await new Promise((resolve) => {
        setTimeout(resolve, 5000); // Wait 5 seconds for ICE gathering
      });

      if (iceCandidatesReceived === 0) {
        result.errors.push("No ICE candidates received");
      } else {
        this.logger.info(`Test completed: ${iceCandidatesReceived} ICE candidates received`);
        result.success = true; // Consider success if we can generate ICE candidates
      }

      // Clean up
      pc.close();
    } catch (error) {
      this.logger.error("WebRTC connectivity test failed", error);
      result.errors.push(error instanceof Error ? error.message : "Unknown error");
    }

    this.logger.info("WebRTC connectivity test completed", result);
    return result;
  }

  /**
   * Generate a comprehensive debug report
   */
  async generateDebugReport(): Promise<string> {
    this.logger.info("Generating comprehensive debug report...");

    const report = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        display: process.env.DISPLAY,
        rtpPort: process.env.RTP_PORT || "5004",
      },
      systemHealth: await this.getSystemHealth(),
      connectivityTest: await this.testWebRTCConnectivity(),
      activeConnections: webRTCServer.getActiveClients().map(async (clientId) => ({
        clientId,
        diagnostics: await this.getConnectionDiagnostics(clientId),
      })),
    };

    const reportJson = JSON.stringify(report, null, 2);
    this.logger.info("Debug report generated", {
      reportSize: reportJson.length,
      activeConnections: report.activeConnections.length,
      systemHealthy: report.systemHealth.display.available && report.systemHealth.ffmpeg.running,
    });

    return reportJson;
  }

  /**
   * Log current system status (one-time check)
   */
  async logSystemStatus(): Promise<void> {
    const health = await this.getSystemHealth();
    this.analyzeHealth(health);
  }

  /**
   * Test RTP packet reception
   */
  async testRTPReception(durationMs: number = 10000): Promise<{
    packetsReceived: number;
    bytesReceived: number;
    avgPacketSize: number;
    packetsPerSecond: number;
  }> {
    this.logger.info(`Testing RTP packet reception for ${durationMs}ms...`);

    const initialStats = streamCapture.getStats();
    const startPackets = initialStats.rtpStats.packetsReceived;
    const startBytes = initialStats.rtpStats.bytesReceived;

    await new Promise((resolve) => setTimeout(resolve, durationMs));

    const finalStats = streamCapture.getStats();
    const endPackets = finalStats.rtpStats.packetsReceived;
    const endBytes = finalStats.rtpStats.bytesReceived;

    const packetsReceived = endPackets - startPackets;
    const bytesReceived = endBytes - startBytes;
    const avgPacketSize = packetsReceived > 0 ? Math.round(bytesReceived / packetsReceived) : 0;
    const packetsPerSecond = Math.round((packetsReceived / durationMs) * 1000);

    const result = {
      packetsReceived,
      bytesReceived,
      avgPacketSize,
      packetsPerSecond,
    };

    this.logger.info("RTP reception test completed", result);
    return result;
  }

  /**
   * Validate WebRTC configuration
   */
  validateConfiguration(): {
    valid: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check environment variables
    if (!process.env.DISPLAY) {
      issues.push("DISPLAY environment variable not set");
      recommendations.push("Set DISPLAY environment variable (e.g., :10.0)");
    }

    // Check if debug mode is enabled
    if (process.env.WEBRTC_DEBUG !== "true") {
      recommendations.push("Enable WEBRTC_DEBUG=true for detailed logging");
    }

    // Check RTP port
    const rtpPort = parseInt(process.env.RTP_PORT || "5004", 10);
    if (rtpPort < 1024 || rtpPort > 65535) {
      issues.push("Invalid RTP port configuration");
    }

    return {
      valid: issues.length === 0,
      issues,
      recommendations,
    };
  }
}

// Export singleton instance
export const webRTCDebugUtils = new WebRTCDebugUtils();
export default webRTCDebugUtils;
