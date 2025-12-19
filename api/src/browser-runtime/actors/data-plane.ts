import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { BrowserRef, ResolvedConfig, SupervisorEvent, BrowserLauncher } from "../types.js";

export interface DataPlaneInput {
  browser: BrowserRef;
  config: ResolvedConfig;
  launcher: BrowserLauncher;
}

export function startDataPlane(
  input: DataPlaneInput,
  sendBack: (event: SupervisorEvent) => void,
): () => void {
  const { browser, config, launcher } = input;

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url || "";

    // For now, only handle CDP proxy. Future: handle recording/logs
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleCdpProxy(ws, browser, sendBack);
    });
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[DataPlane] Listening on port ${config.port}`);
  });

  const disconnectHandler = () => {
    sendBack({
      type: "BROWSER_CRASHED",
      error: new Error("Browser disconnected unexpectedly"),
    });
  };

  const removeDisconnectListener = launcher.onDisconnected(browser, disconnectHandler);

  return () => {
    console.log("[DataPlane] Shutting down");
    removeDisconnectListener();
    wss.close();
    server.close();
  };
}

function handleCdpProxy(
  ws: WebSocket,
  browser: BrowserRef,
  sendBack: (event: SupervisorEvent) => void,
) {
  const cdpWs = new WebSocket(browser.wsEndpoint);

  cdpWs.on("open", () => {
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Spy pattern: Intercept critical commands
        if (message.method === "Browser.close") {
          console.log("[DataPlane] Intercepted Browser.close, notifying machine");
          sendBack({ type: "USER_DISCONNECTED" });
        }
      } catch (e) {}

      if (cdpWs.readyState === WebSocket.OPEN) {
        cdpWs.send(data);
      }
    });

    cdpWs.on("message", (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  });

  cdpWs.on("error", (err) => {
    console.error("[DataPlane] CDP WS error:", err);
    ws.close();
  });

  ws.on("error", (err) => {
    console.error("[DataPlane] Client WS error:", err);
    cdpWs.close();
  });

  cdpWs.on("close", () => ws.close());
  ws.on("close", () => cdpWs.close());
}
