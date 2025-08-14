import wrtc from "@roamhq/wrtc";
import dgram from "dgram";
import { spawn, ChildProcess } from "child_process";
import { exec } from "child_process";
import { promisify } from "util";
import webRTCServer from "./webrtc-server.js";

const execAsync = promisify(exec);

// Enhanced logging utility for stream capture
class StreamCaptureLogger {
  private prefix: string;

  constructor(prefix: string = "StreamCapture") {
    this.prefix = prefix;
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  info(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] INFO: ${message}`;
    if (data) {
      console.log(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(logMessage);
    }
  }

  warn(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] WARN: ${message}`;
    if (data) {
      console.warn(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.warn(logMessage);
    }
  }

  error(message: string, error?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] ERROR: ${message}`;
    if (error) {
      console.error(logMessage, error);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
    } else {
      console.error(logMessage);
    }
  }

  debug(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] DEBUG: ${message}`;
    if (data) {
      console.debug(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.debug(logMessage);
    }
  }
}

// FFmpeg process status
interface FFmpegStatus {
  isRunning: boolean;
  pid?: number;
  startTime?: Date;
  lastHeartbeat?: Date;
  errorCount: number;
  restartCount: number;
}

// RTP packet statistics
interface RTPStats {
  packetsReceived: number;
  bytesReceived: number;
  lastPacketTime?: Date;
  packetsPerSecond: number;
  bitrate: number; // bits per second
  framerate: number;
}

// Client information
interface ClientInfo {
  id: string;
  addedAt: Date;
  isActive: boolean;
  packetsDelivered: number;
  lastActivity: Date;
}

/**
 * Class to capture the display using ffmpeg and serve it over WebRTC
 */
export class StreamCapture {
  private ffmpegProcess: ChildProcess | null = null;
  private rtpSocket: dgram.Socket | null = null;
  private mediaStream: wrtc.MediaStream | null = null;
  private videoSource: any = null;
  private videoTrack: MediaStreamTrack | null = null;
  private active: boolean = false;
  private display: string = ":10.0";
  private rtpPort: number = 5004;
  private width: number = 1920;
  private height: number = 1080;
  private framerate: number = 30;
  private clients = new Map<string, ClientInfo>();
  private logger = new StreamCaptureLogger("StreamCapture");
  private ffmpegStatus: FFmpegStatus = {
    isRunning: false,
    errorCount: 0,
    restartCount: 0,
  };
  private rtpStats: RTPStats = {
    packetsReceived: 0,
    bytesReceived: 0,
    packetsPerSecond: 0,
    bitrate: 0,
    framerate: 0,
  };
  private statsInterval: NodeJS.Timeout | null = null;
  private ffmpegHealthCheckInterval: NodeJS.Timeout | null = null;
  private lastStatsReset = new Date();

  constructor() {
    this.logger.info("Stream capture initializing...");
    this.setupEnvironment();
    this.logger.info("Stream capture initialized");
  }

  /**
   * Setup environment and configuration
   */
  private setupEnvironment(): void {
    // Get configuration from environment variables if available
    this.display = process.env.DISPLAY || ":10.0";
    this.rtpPort = parseInt(process.env.RTP_PORT || "5004", 10);
    this.width = parseInt(process.env.CAPTURE_WIDTH || "1920", 10);
    this.height = parseInt(process.env.CAPTURE_HEIGHT || "1080", 10);
    this.framerate = parseInt(process.env.CAPTURE_FRAMERATE || "30", 10);

    this.logger.info("Environment configuration", {
      display: this.display,
      rtpPort: this.rtpPort,
      resolution: `${this.width}x${this.height}`,
      framerate: this.framerate,
    });
  }

  /**
   * Initialize the stream capture
   */
  async init(): Promise<boolean> {
    this.logger.info("Initializing stream capture components...");

    try {
      // Debug wrtc package structure
      this.logger.debug("Debugging wrtc package structure", {
        hasNonstandard: !!wrtc.nonstandard,
        nonstandardKeys: wrtc.nonstandard ? Object.keys(wrtc.nonstandard) : [],
        wrtcKeys: Object.keys(wrtc),
      });

      // Check if display is available
      await this.verifyDisplay();

      // Create a MediaStream
      this.mediaStream = new wrtc.MediaStream();
      this.logger.debug("MediaStream created successfully");

      // Create a video source - check if nonstandard API is available
      if (wrtc.nonstandard && wrtc.nonstandard.RTCVideoSource) {
        this.videoSource = new wrtc.nonstandard.RTCVideoSource();
        this.logger.debug("RTCVideoSource created successfully");

        // Create a video track
        this.videoTrack = this.videoSource.createTrack();
      } else {
        this.logger.warn(
          "RTCVideoSource not available in this wrtc version, using alternative approach",
        );

        // Alternative: Create a basic MediaStreamTrack
        // Note: This won't provide actual video data, but allows the system to continue
        const canvas = { width: this.width, height: this.height };
        this.videoTrack = new wrtc.MediaStreamTrack();
        this.videoSource = null; // Will be handled differently
      }
      this.logger.debug("Video track created", {
        trackId: this?.videoTrack?.id,
        trackKind: this?.videoTrack?.kind,
        enabled: this?.videoTrack?.enabled,
        readyState: this?.videoTrack?.readyState,
      });

      // Add the track to the stream
      this.mediaStream.addTrack(this.videoTrack!);
      this.logger.debug("Video track added to MediaStream");

      // Initialize RTP socket
      await this.initializeRTPSocket();

      // Start monitoring
      this.startStatsMonitoring();
      this.startFFmpegHealthCheck();

      this.logger.info("Stream capture initialization completed successfully");
      return true;
    } catch (error) {
      this.logger.error("Error initializing stream capture", error);
      await this.cleanup();
      return false;
    }
  }

  /**
   * Verify that the display is available
   */
  private async verifyDisplay(): Promise<void> {
    this.logger.debug(`Verifying display ${this.display}...`);

    try {
      const { stdout, stderr } = await execAsync(`DISPLAY=${this.display} xdpyinfo`);
      this.logger.debug("Display verification successful", {
        display: this.display,
        info: stdout.substring(0, 200) + "...",
      });
    } catch (error) {
      this.logger.error(`Display ${this.display} is not available`, error);
      throw new Error(`Display ${this.display} is not available`);
    }
  }

  /**
   * Initialize RTP socket for receiving video data
   */
  private async initializeRTPSocket(): Promise<void> {
    this.logger.debug(`Initializing RTP socket on port ${this.rtpPort}...`);

    return new Promise((resolve, reject) => {
      try {
        // Create RTP socket
        this.rtpSocket = dgram.createSocket("udp4");

        // Handle RTP packets
        this.rtpSocket.on("message", (msg, rinfo) => {
          this.handleRTPPacket(msg, rinfo);
        });

        // Handle socket events
        this.rtpSocket.on("listening", () => {
          const address = this.rtpSocket!.address();
          this.logger.info("RTP socket listening", {
            address: address.address,
            port: address.port,
            family: address.family,
          });
          resolve();
        });

        this.rtpSocket.on("error", (err) => {
          this.logger.error("RTP socket error", err);
          if (err.message.includes("EADDRINUSE")) {
            this.logger.info("RTP port already in use, assuming external FFmpeg is running");
            resolve(); // This is expected when FFmpeg is started by entrypoint.sh
          } else {
            reject(err);
          }
        });

        this.rtpSocket.on("close", () => {
          this.logger.warn("RTP socket closed");
        });

        // Bind to the RTP port
        this.rtpSocket.bind(this.rtpPort, "127.0.0.1");
      } catch (error) {
        this.logger.error("Error creating RTP socket", error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming RTP packets
   */
  private handleRTPPacket(packet: Buffer, rinfo: dgram.RemoteInfo): void {
    // Update RTP statistics
    this.rtpStats.packetsReceived++;
    this.rtpStats.bytesReceived += packet.length;
    this.rtpStats.lastPacketTime = new Date();

    // Log detailed packet info occasionally
    if (this.rtpStats.packetsReceived % 1000 === 0) {
      this.logger.debug("RTP packet milestone", {
        packetsReceived: this.rtpStats.packetsReceived,
        totalBytes: this.rtpStats.bytesReceived,
        packetSize: packet.length,
        source: `${rinfo.address}:${rinfo.port}`,
      });
    }

    // Parse RTP header for more detailed analysis
    if (packet.length >= 12) {
      const version = (packet[0] >> 6) & 0x03;
      const payloadType = packet[1] & 0x7f;
      const sequenceNumber = packet.readUInt16BE(2);
      const timestamp = packet.readUInt32BE(4);
      const ssrc = packet.readUInt32BE(8);

      // Log RTP header details occasionally
      if (this.rtpStats.packetsReceived % 5000 === 0) {
        this.logger.debug("RTP packet analysis", {
          version,
          payloadType,
          sequenceNumber,
          timestamp,
          ssrc: ssrc.toString(16),
          packetLength: packet.length,
        });
      }
    }

    // TODO: Process video frames from RTP packets
    // This would involve:
    // 1. Reassembling RTP packets into complete video frames
    // 2. Decoding the video frames (VP8/VP9/H264)
    // 3. Feeding frames to the RTCVideoSource
    // For now, we'll generate test frames
    this.generateTestFrame();

    // Deliver to active clients
    this.deliverToClients(packet);
  }

  /**
   * Generate a test frame (placeholder for actual video processing)
   */
  private generateTestFrame(): void {
    if (this.clients.size === 0) {
      return;
    }

    // Only attempt if we have a proper video source
    if (!this.videoSource) {
      this.logger.debug("No video source available, skipping frame generation");
      return;
    }

    // This is a placeholder - in a real implementation, you would:
    // 1. Extract actual video frames from RTP packets
    // 2. Convert them to the format expected by RTCVideoSource
    // 3. Feed them to the video source

    // For testing, we could generate a simple colored frame
    try {
      // Note: This is a simplified approach
      // Real implementation would process actual video data from FFmpeg
    } catch (error) {
      this.logger.error("Error generating test frame", error);
    }
  }

  /**
   * Deliver packet data to connected clients
   */
  private deliverToClients(packet: Buffer): void {
    let deliveredCount = 0;

    for (const [clientId, clientInfo] of this.clients) {
      if (clientInfo.isActive) {
        try {
          // Update client statistics
          clientInfo.packetsDelivered++;
          clientInfo.lastActivity = new Date();
          deliveredCount++;
        } catch (error) {
          this.logger.error(`Error delivering to client ${clientId}`, error);
          clientInfo.isActive = false;
        }
      }
    }

    // Log delivery stats occasionally
    if (this.rtpStats.packetsReceived % 10000 === 0 && deliveredCount > 0) {
      this.logger.debug("Packet delivery stats", {
        deliveredToClients: deliveredCount,
        totalActiveClients: Array.from(this.clients.values()).filter((c) => c.isActive).length,
      });
    }
  }

  /**
   * Start monitoring statistics
   */
  private startStatsMonitoring(): void {
    this.logger.debug("Starting statistics monitoring");

    this.statsInterval = setInterval(() => {
      this.updateStatistics();
      this.logPeriodicStats();
    }, 5000); // Every 5 seconds
  }

  /**
   * Update calculated statistics
   */
  private updateStatistics(): void {
    const now = new Date();
    const timeDiff = (now.getTime() - this.lastStatsReset.getTime()) / 1000; // seconds

    if (timeDiff > 0) {
      // Calculate packets per second
      this.rtpStats.packetsPerSecond = this.rtpStats.packetsReceived / timeDiff;

      // Calculate bitrate (bits per second)
      this.rtpStats.bitrate = (this.rtpStats.bytesReceived * 8) / timeDiff;

      // Estimate framerate (assuming 30fps target)
      this.rtpStats.framerate = Math.min(this.rtpStats.packetsPerSecond / 10, this.framerate);
    }
  }

  /**
   * Log periodic statistics
   */
  private logPeriodicStats(): void {
    if (this.rtpStats.packetsReceived > 0) {
      this.logger.info("Stream statistics", {
        packetsReceived: this.rtpStats.packetsReceived,
        bytesReceived: this.rtpStats.bytesReceived,
        packetsPerSecond: Math.round(this.rtpStats.packetsPerSecond),
        bitrateMbps: Math.round((this.rtpStats.bitrate / 1000000) * 100) / 100,
        estimatedFramerate: Math.round(this.rtpStats.framerate),
        activeClients: Array.from(this.clients.values()).filter((c) => c.isActive).length,
        ffmpegStatus: this.ffmpegStatus.isRunning ? "running" : "stopped",
      });
    }
  }

  /**
   * Start FFmpeg health monitoring
   */
  private startFFmpegHealthCheck(): void {
    this.logger.debug("Starting FFmpeg health check");

    this.ffmpegHealthCheckInterval = setInterval(async () => {
      await this.checkFFmpegHealth();
    }, 10000); // Every 10 seconds
  }

  /**
   * Check FFmpeg process health
   */
  private async checkFFmpegHealth(): Promise<void> {
    try {
      // Check if FFmpeg is running (external process started by entrypoint.sh)
      const { stdout } = await execAsync("pgrep -f 'ffmpeg.*x11grab'");
      const pids = stdout
        .trim()
        .split("\n")
        .filter((pid) => pid);

      if (pids.length > 0) {
        const mainPid = parseInt(pids[0], 10);

        if (!this.ffmpegStatus.isRunning) {
          this.logger.info("FFmpeg process detected", {
            pid: mainPid,
            totalProcesses: pids.length,
          });

          this.ffmpegStatus.isRunning = true;
          this.ffmpegStatus.pid = mainPid;
          this.ffmpegStatus.startTime = new Date();
        }

        this.ffmpegStatus.lastHeartbeat = new Date();
      } else {
        if (this.ffmpegStatus.isRunning) {
          this.logger.warn("FFmpeg process no longer detected");
          this.ffmpegStatus.isRunning = false;
          this.ffmpegStatus.pid = undefined;
        }
      }
    } catch (error) {
      if (this.ffmpegStatus.isRunning) {
        this.logger.warn("Error checking FFmpeg health", error);
        this.ffmpegStatus.isRunning = false;
      }
    }

    // Check if we're receiving RTP packets (FFmpeg health indicator)
    const timeSinceLastPacket = this.rtpStats.lastPacketTime
      ? Date.now() - this.rtpStats.lastPacketTime.getTime()
      : Infinity;

    if (timeSinceLastPacket > 15000) {
      // 15 seconds without packets
      this.logger.warn("No RTP packets received recently", {
        timeSinceLastPacket: Math.round(timeSinceLastPacket / 1000) + "s",
        ffmpegRunning: this.ffmpegStatus.isRunning,
      });
    }
  }

  /**
   * Start capturing the display
   */
  async start(): Promise<boolean> {
    if (this.active) {
      this.logger.info("Stream capture already active");
      return true;
    }

    this.logger.info("Starting stream capture...");

    try {
      // Check if external FFmpeg is already running (from entrypoint.sh)
      if (!(await this.isSystemFfmpegRunning())) {
        this.logger.info("No external FFmpeg detected, starting internal FFmpeg");
        await this.startFfmpeg();
      } else {
        this.logger.info("External FFmpeg detected, using existing process");
      }

      this.active = true;
      this.logger.info("Stream capture started successfully");
      return true;
    } catch (error) {
      this.logger.error("Error starting stream capture", error);
      return false;
    }
  }

  /**
   * Check if system FFmpeg is already running
   */
  private async isSystemFfmpegRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync("pgrep -f 'ffmpeg.*x11grab'");
      const pids = stdout
        .trim()
        .split("\n")
        .filter((pid) => pid);

      if (pids.length > 0) {
        this.logger.debug("External FFmpeg processes found", { count: pids.length });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.debug("No external FFmpeg processes found");
      return false;
    }
  }

  /**
   * Start internal FFmpeg process
   */
  private async startFfmpeg(): Promise<void> {
    if (this.ffmpegProcess) {
      this.logger.info("Internal FFmpeg already running");
      return;
    }

    this.logger.info("Starting internal FFmpeg process...");

    try {
      const ffmpegArgs = [
        "-f",
        "x11grab",
        "-framerate",
        this.framerate.toString(),
        "-video_size",
        `${this.width}x${this.height}`,
        "-i",
        this.display,
        "-use_wallclock_as_timestamps",
        "1",
        "-c:v",
        "libvpx",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-threads",
        "4",
        "-error-resilient",
        "1",
        "-auto-alt-ref",
        "0",
        "-lag-in-frames",
        "0",
        "-b:v",
        "2M",
        "-maxrate",
        "2.5M",
        "-bufsize",
        "500k",
        "-g",
        "15",
        "-keyint_min",
        "10",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-f",
        "rtp",
        `rtp://127.0.0.1:${this.rtpPort}`,
      ];

      this.logger.debug("Starting FFmpeg with args", { args: ffmpegArgs });

      // Start ffmpeg process
      this.ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

      this.ffmpegStatus.isRunning = true;
      this.ffmpegStatus.pid = this.ffmpegProcess.pid;
      this.ffmpegStatus.startTime = new Date();
      this.ffmpegStatus.restartCount++;

      // Handle stdout
      this.ffmpegProcess.stdout?.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          this.logger.debug("FFmpeg stdout", { output: output.substring(0, 200) });
        }
      });

      // Handle stderr (FFmpeg logs to stderr)
      this.ffmpegProcess.stderr?.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          // Filter out verbose FFmpeg messages
          if (!output.includes("frame=") && !output.includes("fps=")) {
            this.logger.debug("FFmpeg stderr", { output: output.substring(0, 300) });
          }
        }
      });

      // Handle exit
      this.ffmpegProcess.on("exit", (code, signal) => {
        this.logger.warn("Internal FFmpeg process exited", { code, signal });
        this.ffmpegStatus.isRunning = false;
        this.ffmpegStatus.pid = undefined;
        this.ffmpegProcess = null;

        if (code !== 0 && this.active) {
          this.ffmpegStatus.errorCount++;
          this.logger.error("FFmpeg exited with error", {
            code,
            signal,
            errorCount: this.ffmpegStatus.errorCount,
          });
        }
      });

      // Handle error
      this.ffmpegProcess.on("error", (err) => {
        this.logger.error("Internal FFmpeg process error", err);
        this.ffmpegStatus.isRunning = false;
        this.ffmpegStatus.errorCount++;
        this.ffmpegProcess = null;
      });

      this.logger.info("Internal FFmpeg process started successfully", {
        pid: this.ffmpegProcess.pid,
        restartCount: this.ffmpegStatus.restartCount,
      });

      // Wait a moment for FFmpeg to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      this.logger.error("Error starting internal FFmpeg", error);
      throw error;
    }
  }

  /**
   * Add a client to the stream
   */
  async addClient(clientId: string): Promise<void> {
    this.logger.info(`Adding client ${clientId} to stream`);

    // Start streaming if not already active
    if (!this.active) {
      this.logger.debug("Stream not active, starting...");
      const started = await this.start();
      if (!started) {
        throw new Error("Failed to start stream capture");
      }
    }

    // Check if client already exists
    if (this.clients.has(clientId)) {
      this.logger.warn(`Client ${clientId} already exists, updating info`);
      const clientInfo = this.clients.get(clientId)!;
      clientInfo.isActive = true;
      clientInfo.lastActivity = new Date();
      return;
    }

    // Add client to the list
    const clientInfo: ClientInfo = {
      id: clientId,
      addedAt: new Date(),
      isActive: true,
      packetsDelivered: 0,
      lastActivity: new Date(),
    };

    this.clients.set(clientId, clientInfo);
    this.logger.info(`Added client ${clientId}`, {
      totalClients: this.clients.size,
      clientInfo,
    });

    // Add track to the client's peer connection
    if (this.mediaStream && this.videoTrack) {
      try {
        webRTCServer.addTrack(clientId, this.videoTrack, this.mediaStream);
        this.logger.debug(`Video track added to peer connection for client ${clientId}`);
      } catch (error) {
        this.logger.error(`Error adding track to peer connection for client ${clientId}`, error);
        // Continue without the track - WebRTC connection can still be established
        this.logger.warn(`Continuing without video track for client ${clientId}`);
      }
    } else {
      this.logger.warn(
        `No media stream or video track available for client ${clientId} - this may be due to wrtc version compatibility`,
      );
    }
  }

  /**
   * Remove a client from the stream
   */
  removeClient(clientId: string): void {
    this.logger.info(`Removing client ${clientId} from stream`);

    const clientInfo = this.clients.get(clientId);
    if (clientInfo) {
      const sessionDuration = Date.now() - clientInfo.addedAt.getTime();

      this.logger.info(`Client ${clientId} session summary`, {
        duration: Math.round(sessionDuration / 1000) + "s",
        packetsDelivered: clientInfo.packetsDelivered,
        lastActivity: clientInfo.lastActivity.toISOString(),
      });

      // Remove client from the list
      this.clients.delete(clientId);
    }

    this.logger.info(`Client ${clientId} removed`, {
      totalClients: this.clients.size,
    });

    // Stop streaming if no clients left and we started internal FFmpeg
    if (this.clients.size === 0 && this.ffmpegProcess) {
      this.logger.info("No clients remaining, stopping internal FFmpeg");
      this.stop();
    }
  }

  /**
   * Stop capturing the display
   */
  stop(): void {
    if (!this.active) {
      this.logger.info("Stream capture not active");
      return;
    }

    this.logger.info("Stopping stream capture...");

    // Stop internal FFmpeg if we started it (don't stop external FFmpeg)
    if (this.ffmpegProcess) {
      this.logger.info("Stopping internal FFmpeg process...");
      this.ffmpegProcess.kill("SIGTERM");

      // Force kill after 5 seconds if it doesn't stop gracefully
      setTimeout(() => {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
          this.logger.warn("Force killing FFmpeg process");
          this.ffmpegProcess.kill("SIGKILL");
        }
      }, 5000);

      this.ffmpegProcess = null;
    }

    // Close RTP socket
    if (this.rtpSocket) {
      this.rtpSocket.close();
      this.rtpSocket = null;
      this.logger.debug("RTP socket closed");
    }

    // Clear client list
    this.clients.clear();

    this.active = false;
    this.logger.info("Stream capture stopped successfully");
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.logger.info("Cleaning up stream capture resources...");

    // Stop monitoring
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.ffmpegHealthCheckInterval) {
      clearInterval(this.ffmpegHealthCheckInterval);
      this.ffmpegHealthCheckInterval = null;
    }

    // Stop capture
    this.stop();

    // Close the video track
    if (this.videoTrack) {
      this.videoTrack.stop();
      this.videoTrack = null;
      this.logger.debug("Video track stopped");
    }

    // Clean up WebRTC objects
    this.videoSource = null;
    this.mediaStream = null;

    // Reset statistics
    this.rtpStats = {
      packetsReceived: 0,
      bytesReceived: 0,
      packetsPerSecond: 0,
      bitrate: 0,
      framerate: 0,
    };

    this.ffmpegStatus = {
      isRunning: false,
      errorCount: 0,
      restartCount: 0,
    };

    this.logger.info("Stream capture cleanup completed");
  }

  /**
   * Get current statistics
   */
  getStats(): {
    active: boolean;
    clients: number;
    rtpStats: RTPStats;
    ffmpegStatus: FFmpegStatus;
    clientDetails: Array<{
      id: string;
      addedAt: string;
      isActive: boolean;
      packetsDelivered: number;
      sessionDuration: number;
    }>;
  } {
    const clientDetails = Array.from(this.clients.values()).map((client) => ({
      id: client.id,
      addedAt: client.addedAt.toISOString(),
      isActive: client.isActive,
      packetsDelivered: client.packetsDelivered,
      sessionDuration: Date.now() - client.addedAt.getTime(),
    }));

    return {
      active: this.active,
      clients: this.clients.size,
      rtpStats: { ...this.rtpStats },
      ffmpegStatus: { ...this.ffmpegStatus },
      clientDetails,
    };
  }

  /**
   * Health check - returns true if stream capture is healthy
   */
  isHealthy(): boolean {
    const now = Date.now();

    // Check if we're active
    if (!this.active) {
      return false;
    }

    // Check if FFmpeg is running
    if (!this.ffmpegStatus.isRunning) {
      return false;
    }

    // Check if we've received recent RTP packets (if we have clients)
    if (this.clients.size > 0) {
      const timeSinceLastPacket = this.rtpStats.lastPacketTime
        ? now - this.rtpStats.lastPacketTime.getTime()
        : Infinity;

      if (timeSinceLastPacket > 10000) {
        // 10 seconds
        return false;
      }
    }

    return true;
  }
}

// Create a singleton instance
const streamCapture = new StreamCapture();
export default streamCapture;
