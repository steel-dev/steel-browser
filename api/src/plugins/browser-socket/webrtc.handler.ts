import { IncomingMessage } from "http";
import { spawn } from "child_process";
import { Duplex } from "stream";
import path from "path";

import { SessionService } from "../../services/session.service.js";
export async function handleWebRTCCastSession(
  request: IncomingMessage,
  socket: Duplex,
  // head: Buffer,
  // wss: WebSocket.Server,
  sessionService: SessionService,
  params: Record<string, string> | undefined,
) {
  const id = request.url?.split("/sessions/")[1].split("/webrtc")[0];
  if (!id) {
    console.error("Cast Session ID not found");
    socket.destroy();
    return;
  }

  const session = await sessionService.activeSession;
  if (!session) {
    console.error(`Cast Session ${id} not found`);
    socket.destroy();
    return;
  }

  const queryParams = new URLSearchParams(request.url?.split("?")[1] || "");
  const requestedPageId = params?.pageId || queryParams.get("pageId") || null;
  const requestedPageIndex = params?.pageIndex || queryParams.get("pageIndex") || null;

  const tabDiscoveryMode =
    queryParams.get("tabInfo") === "true" || (!requestedPageId && !requestedPageIndex);

  const { height, width } = (session.dimensions as { width: number; height: number }) ?? {
    width: 1920,
    height: 1080,
  };

  // Ensure X authority is set
  if (process.env.XAUTHORITY === undefined) {
    process.env.XAUTHORITY = "/tmp/.Xauthority";
  }

  // Test X server
  const xdpyinfo = spawn("xdpyinfo", ["-display", ":10"]);
  xdpyinfo.on("close", (code) => {
    if (code !== 0) {
      console.log("Cannot connect to X server");
    }
  });

  // Find Chromium window via xdotool
  const xdotool = spawn("xdotool", ["search", "--name", "Chromium"]);

  let windowId: string | null = null;
  xdotool.stdout.on("data", (data) => {
    const ids = data.toString().trim().split("\n");
    // You could run `xwininfo` for each ID like in the script, omitted for brevity
    windowId = ids[0];
    console.log(`Found window ${windowId}`);
  });

  // Start ffmpeg capture
  const ffmpeg = spawn("ffmpeg", [
    "-fflags",
    "+nobuffer",
    "-nostats",
    "-hide_banner",
    "-f",
    "x11grab",
    "-framerate",
    "30",
    "-video_size",
    "1920x1080",
    "-i",
    ":10.0",
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
    "rtp://127.0.0.1:5004",
  ]);

  ffmpeg.stderr.on("data", (chunk) => {
    console.log(chunk.toString());
  });

  // Handle cleanup when Fastify shuts down
  // fastify.addHook("onClose", async (instance, done) => {
  //   ffmpeg.kill("SIGTERM");
  //   setTimeout(() => {
  //     if (!ffmpeg.killed) {
  //       ffmpeg.kill("SIGKILL");
  //     }
  //   }, 3000);
  //   done();
  // });

  // Start Pion WebRTC server
  const pion = spawn(path.join(__dirname, "..", "webrtc", "server"));

  pion.stdout.on("data", (chunk) => {
    console.log(`[pion] ${chunk}`);
  });

  return { message: "Capture started" };
}
