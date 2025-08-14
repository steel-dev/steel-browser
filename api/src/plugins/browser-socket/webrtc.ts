import { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { WebSocketServer } from "ws";
import { WebSocketRegistryService } from "../../services/websocket-registry.service.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../types/websocket.js";
import { RTCPeerConnection, RTCSessionDescription } from "@roamhq/wrtc";

export interface BrowserSocketOptions {
  customHandlers?: WebSocketHandler[];
}

// Initialize WebRTC service
const wss = new WebSocketServer({ noServer: true });

const webRTCSocket: FastifyPluginAsync<BrowserSocketOptions> = async (
  fastify: FastifyInstance,
  options: BrowserSocketOptions,
) => {
  if (!fastify.cdpService.isRunning()) {
    fastify.log.info("Launching browser...");
    await fastify.cdpService.launch();
    fastify.log.info("Browser launched successfully");
  }

  // Handle WebSocket connections
  wss.on("connection", (ws) => {
    console.log("New signaling connection");

    const pc = new RTCPeerConnection();

    // When Node receives a track (from Puppeteer page)
    pc.ontrack = (event) => {
      console.log("Received track:", event.streams[0]);
      // Process the MediaStreamTrack here
      // e.g., save to file or forward elsewhere
    };

    // Send ICE candidates to Puppeteer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
      }
    };

    ws.on("message", async (msg) => {
      const data = JSON.parse(msg.toString());

      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify(pc.localDescription));
      } else if (data.type === "ice") {
        await pc.addIceCandidate(data.candidate);
      }
    });
  });
};

export default fp(webRTCSocket, { name: "webrtc-socket" });
