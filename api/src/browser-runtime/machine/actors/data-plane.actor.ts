import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { BrowserRef, ResolvedConfig, SupervisorEvent, BrowserLauncher } from "../../types.js";

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

  const listenPort = typeof config.dataPlanePort === "number" ? config.dataPlanePort : config.port;

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

  server.on("error", (err: any) => {
    console.error("[DataPlane] Server error:", err);
    if (err.code === "EADDRINUSE") {
      sendBack({
        type: "FATAL_ERROR",
        error: new Error(`Port ${listenPort} is already in use`),
      });
    }
  });

  server.listen(listenPort, "0.0.0.0", () => {
    const address = server.address();
    const actualPort =
      address && typeof address === "object" && "port" in address
        ? (address.port as number)
        : listenPort;
    console.log(`[DataPlane] Listening on port ${actualPort}`);
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

  const cleanup = () => {
    if (cdpWs.readyState === WebSocket.OPEN || cdpWs.readyState === WebSocket.CONNECTING) {
      cdpWs.close();
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  cdpWs.on("open", () => {
    if (ws.readyState !== WebSocket.OPEN) {
      cleanup();
      return;
    }

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
    cleanup();
  });

  ws.on("error", (err) => {
    console.error("[DataPlane] Client WS error:", err);
    cleanup();
  });

  cdpWs.on("close", () => cleanup());
  ws.on("close", () => cleanup());
}
