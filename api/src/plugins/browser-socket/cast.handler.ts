import { IncomingMessage } from "http";
import { Duplex } from "stream";
import WebSocket from "ws";
import puppeteer, { CDPSession, Page } from "puppeteer-core";
import { env } from "../../env";
import { SessionService } from "../../services/session.service";

// Type definitions
type MouseEvent = {
  type: "mouseEvent";
  pageId: string;
  event: {
    type: "mousePressed" | "mouseReleased" | "mouseWheel" | "mouseMoved";
    x: number;
    y: number;
    button: "none" | "left" | "middle" | "right";
    modifiers: number;
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
  };
};

type KeyEvent = {
  type: "keyEvent";
  pageId: string;
  event: {
    type: "keyDown" | "keyUp" | "char";
    text?: string;
    code: string;
    key: string;
    keyCode: number;
  };
};

type NavigationEvent = {
  type: "navigation";
  pageId: string;
  event: {
    url?: string;
    action?: "back" | "forward";
  };
};

// Helper functions
async function removeTargetBlank(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      link.removeAttribute("target");
    });
  });
}

async function getFavicon(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const iconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      if (iconLink) {
        const href = iconLink.getAttribute("href");
        if (href?.startsWith("http")) return href;
        if (href?.startsWith("//")) return window.location.protocol + href;
        if (href?.startsWith("/")) return window.location.origin + href;
        return window.location.origin + "/" + href;
      }
      return null;
    });
  } catch (err) {
    // Log error but don't break the connection
    console.warn("Error getting favicon:", err);
    return null;
  }
}

export async function handleCastSession(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocket.Server,
  sessionService: SessionService,
): Promise<void> {
  const id = request.url?.split("/sessions/")[1].split("/cast")[0];

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

  const { height, width } = (session.dimensions as { width: number; height: number }) ?? { width: 1920, height: 1080 };

  wss.handleUpgrade(request, socket, head, async (ws) => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://${env.HOST}:${env.PORT}`,
    });
    const pages = await browser.pages();
    const activeScreencasts = new Set<{ pageId: string; client: CDPSession; cleanup: () => void }>();

    // Start screencast for each page
    pages.forEach(async (page) => {
      const client = await page.target().createCDPSession();
      //@ts-expect-error
      const pageId = page.target()._targetId;

      page.on("framenavigated", async (frame) => {
        if (frame === page.mainFrame()) {
          await removeTargetBlank(page);
        }
      });

      // Track active screencasts to stop them later
      activeScreencasts.add({
        pageId,
        client,
        cleanup: () => {
          client.send("Page.stopScreencast").catch((err) => {
            if (!err.message?.includes("Target closed")) {
              console.error("Error stopping screencast:", err);
            }
          });
          client.detach().catch((err) => {
            if (!err.message?.includes("Target closed")) {
              console.error("Error detaching client:", err);
            }
          });
        },
      });

      await client.send("Page.setDeviceMetricsOverride", {
        screenHeight: height,
        screenWidth: width,
        width,
        height,
        mobile: false,
        screenOrientation: { angle: 90, type: "landscapePrimary" },
        deviceScaleFactor: 1,
      });

      await client.send("Page.startScreencast", {
        format: "jpeg",
        quality: 100,
        maxWidth: width,
        maxHeight: height,
      });

      client.on("Page.screencastFrame", async ({ data, sessionId }) => {
        await client.send("Page.screencastFrameAck", { sessionId });
        if (ws.readyState === WebSocket.OPEN) {
          const favicon = await getFavicon(page);
          ws.send(
            JSON.stringify({
              pageId,
              url: page.url(),
              favicon,
              data,
            }),
          );
        }
      });
    });

    // Handle new browser targets
    browser.on("targetcreated", async (target) => {
      if (target.type() === "page") {
        //@ts-expect-error
        const pageId = target._targetId;
        const client = await target.createCDPSession();
        const page = await target.asPage();

        page.on("framenavigated", async (frame) => {
          if (frame === page.mainFrame()) {
            await removeTargetBlank(page);
          }
        });

        activeScreencasts.add({
          pageId,
          client,
          cleanup: () => {
            client.send("Page.stopScreencast").catch((err) => {
              if (!err.message?.includes("Target closed")) {
                console.error("Error stopping screencast:", err);
              }
            });
            client.detach().catch((err) => {
              if (!err.message?.includes("Target closed")) {
                console.error("Error detaching client:", err);
              }
            });
          },
        });

        await client.send("Page.startScreencast", {
          format: "jpeg",
          quality: 100,
          maxWidth: width,
          maxHeight: height,
        });

        client.on("Page.screencastFrame", async ({ data, sessionId }) => {
          await client.send("Page.screencastFrameAck", { sessionId });
          if (ws.readyState === WebSocket.OPEN) {
            const favicon = await getFavicon(page);
            ws.send(
              JSON.stringify({
                pageId,
                url: page.url(),
                favicon,
                data,
              }),
            );
          }
        });
      }
    });

    // Handle WebSocket messages from client
    ws.on("message", async (message) => {
      try {
        const data: MouseEvent | KeyEvent | NavigationEvent = JSON.parse(message.toString());
        const { type, pageId, event } = data;

        const connection = Array.from(activeScreencasts).find((c) => c.pageId === pageId);
        if (!connection) {
          console.error(`Connection for page ${pageId} not found`);
          return;
        }

        const client = connection.client;

        switch (type) {
          case "mouseEvent": {
            await client.send("Input.dispatchMouseEvent", {
              type: event.type,
              x: event.x,
              y: event.y,
              button: event.button,
              buttons: event.button === "none" ? 0 : 1,
              clickCount: event.clickCount || 1,
              modifiers: event.modifiers || 0,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
            });
            break;
          }
          case "keyEvent": {
            await client.send("Input.dispatchKeyEvent", {
              type: event.type,
              text: event.text,
              unmodifiedText: event.text ? event.text.toLowerCase() : undefined,
              code: event.code,
              key: event.key,
              windowsVirtualKeyCode: event.keyCode,
              nativeVirtualKeyCode: event.keyCode,
              autoRepeat: false,
              isKeypad: false,
              isSystemKey: false,
            });
            break;
          }
          case "navigation": {
            const pages = await browser.pages();
            //@ts-expect-error
            const page = pages.find((p) => p.target()._targetId === pageId);
            if (!page) {
              console.error(`Page ${pageId} not found`);
              return;
            }

            if (event.action === "back") {
              await page.goBack();
            } else if (event.action === "forward") {
              await page.goForward();
            } else if (event.url) {
              await page.goto(event.url);
            }
            break;
          }
          default:
            console.warn("Unknown event type:", type);
        }
      } catch (err) {
        console.error("Error handling WebSocket message:", err);
      }
    });

    // Handle WebSocket closure
    ws.on("close", () => {
      console.log("Cast WebSocket connection closed");
      activeScreencasts.forEach((connection) => {
        try {
          connection.cleanup();
        } catch (err) {
          console.error("Error during cleanup:", err);
        }
      });
      activeScreencasts.clear();
      browser.disconnect().catch(console.error);
    });

    ws.on("error", (err) => {
      console.error("Cast WebSocket error:", err);
    });
  });
}
