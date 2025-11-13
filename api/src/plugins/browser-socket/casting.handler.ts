import { IncomingMessage } from "http";
import puppeteer, { Browser, CDPSession, Page } from "puppeteer-core";
import { Duplex } from "stream";
import WebSocket, { Server } from "ws";

import { env } from "../../env.js";
import { SessionService } from "../../services/session.service.js";
import {
  CloseTabEvent,
  GetSelectedTextEvent,
  KeyEvent,
  MouseEvent,
  NavigationEvent,
  PageInfo,
} from "../../types/casting.js";
import { getPageFavicon, getPageTitle, navigatePage } from "../../utils/casting.js";

export async function handleCastSession(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: Server,
  sessionService: SessionService,
  params: Record<string, string> | undefined,
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

  const queryParams = new URLSearchParams(request.url?.split("?")[1] || "");
  const requestedPageId = params?.pageId || queryParams.get("pageId") || null;
  const requestedPageIndex = params?.pageIndex || queryParams.get("pageIndex") || null;

  const tabDiscoveryMode =
    queryParams.get("tabInfo") === "true" || (!requestedPageId && !requestedPageIndex);

  const { height, width } = (session.dimensions as { width: number; height: number }) ?? {
    width: 1920,
    height: 1080,
  };
  const scaleFactor = (session.dimensions as any)?.scaleFactor ?? 1;

  wss.handleUpgrade(request, socket, head, async (ws) => {
    let browser: Browser | null = null;
    let targetPage: Page | null = null;
    let targetClient: CDPSession | null = null;
    let targetPageId: string | null = null;

    const activePages = new Map<string, Page>();

    let heartbeatInterval: NodeJS.Timeout | null = null;

    const handleSessionCleanup = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      if (targetPage) {
        targetPage.removeAllListeners("framenavigated");
      }

      // Clean up screencast
      if (targetClient) {
        try {
          targetClient.send("Page.stopScreencast").catch((err) => {
            // Ignore errors about closed targets
            if (!err.message?.includes("Target closed")) {
              console.error("Error stopping screencast:", err);
            }
          });

          targetClient.detach().catch((err) => {
            // Ignore errors about closed targets
            if (!err.message?.includes("Target closed")) {
              console.error("Error detaching client:", err);
            }
          });

          targetClient = null;
        } catch (err) {
          console.error("Error during screencast cleanup:", err);
        }
      }

      // Disconnect browser
      if (browser) {
        try {
          browser.disconnect().catch((err) => {
            console.error("Error disconnecting browser:", err);
          });
          browser = null;
        } catch (err) {
          console.error("Error during browser disconnect:", err);
        }
      }

      // Force garbage collection if available (Node.js with --expose-gc flag)
      if (global.gc) {
        try {
          global.gc();
        } catch (err) {
          console.error("Error during garbage collection:", err);
        }
      }
    };

    const sendTabList = async () => {
      try {
        if (ws.readyState !== WebSocket.OPEN || !tabDiscoveryMode) return;

        const tabList: PageInfo[] = [];

        for (const [pageId, page] of activePages.entries()) {
          tabList.push({
            id: pageId,
            url: page.url(),
            title: await getPageTitle(page),
            favicon: await getPageFavicon(page),
          });
        }

        ws.send(
          JSON.stringify({
            type: "tabList",
            tabs: tabList,
            firstTabId: tabList.length > 0 ? tabList[0].id : null,
          }),
        );
      } catch (error) {
        console.error("Error sending tab list:", error);
      }
    };

    const findTargetPage = async (
      pages: Page[],
    ): Promise<{ page: Page; pageId: string } | null> => {
      if (tabDiscoveryMode) return null; // No target page in tab discovery mode

      if (requestedPageId) {
        for (const page of pages) {
          try {
            //@ts-expect-error
            const pageId = page.target()._targetId;
            if (pageId === requestedPageId) {
              return { page, pageId };
            }
          } catch (err) {
            console.error("Error accessing page target ID:", err);
          }
        }
      } else if (requestedPageIndex) {
        const index = parseInt(requestedPageIndex, 10);
        if (index >= 0 && index < pages.length) {
          const page = pages[index];
          //@ts-expect-error
          const pageId = page.target()._targetId;
          return { page, pageId };
        }
      }

      return null;
    };

    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: `ws://${env.HOST}:${env.PORT}`,
      });

      if (!browser) {
        console.error("Failed to connect to browser");
        socket.destroy();
        return;
      }

      const pages = await browser.pages();

      if (tabDiscoveryMode) {
        for (const page of pages) {
          //@ts-expect-error
          const pageId = page.target()._targetId;
          activePages.set(pageId, page);
        }

        // Initial tab list
        await sendTabList();

        // Setup page creation/deletion tracking
        browser.on("targetcreated", async (target) => {
          if (target.type() === "page") {
            try {
              const page = await target.asPage();
              //@ts-expect-error
              const pageId = target._targetId;
              activePages.set(pageId, page);
              await sendTabList();
            } catch (err) {
              console.error("Error handling new target:", err);
            }
          }
        });

        browser.on("targetdestroyed", async (target) => {
          if (target.type() === "page") {
            try {
              //@ts-expect-error
              const pageId = target._targetId;
              if (activePages.has(pageId)) {
                activePages.delete(pageId);

                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "tabClosed",
                      pageId,
                    }),
                  );

                  await sendTabList();
                }
              }
            } catch (err) {
              console.error("Error handling destroyed target:", err);
            }
          }
        });

        // Setup heartbeat to detect dead connections
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.ping();
            } catch (err) {
              console.error("Error sending ping:", err);
              handleSessionCleanup();
            }
          } else {
            handleSessionCleanup();
          }
        }, 30000);

        ws.on("close", () => {
          handleSessionCleanup();
        });

        ws.on("error", (err) => {
          console.error("Tab discovery WebSocket error:", err);
          handleSessionCleanup();
        });

        return;
      } else {
        const targetResult = await findTargetPage(pages);

        if (!targetResult) {
          console.error(
            `Target page not found for ${
              requestedPageId ? `pageId=${requestedPageId}` : `pageIndex=${requestedPageIndex}`
            }`,
          );
          socket.destroy();
          return;
        }

        targetPage = targetResult.page;
        targetPageId = targetResult.pageId;

        await targetPage.bringToFront();

        // Setup screencast for the target page
        targetClient = await targetPage.target().createCDPSession();

        ws.on("message", async (message) => {
          try {
            const data:
              | MouseEvent
              | KeyEvent
              | NavigationEvent
              | CloseTabEvent
              | GetSelectedTextEvent = JSON.parse(message.toString());
            const { type } = data;

            if (!targetClient || !targetPage) {
              console.error("No target page or client available for input handling");
              return;
            }

            switch (type) {
              case "mouseEvent": {
                const { event } = data as MouseEvent;
                await targetClient.send("Input.dispatchMouseEvent", {
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
                const { event } = data as KeyEvent;
                await targetClient.send("Input.dispatchKeyEvent", {
                  type: event.type,
                  text: event.text,
                  unmodifiedText: event.text ? event.text.toLowerCase() : undefined,
                  code: event.code,
                  key: event.key,
                  windowsVirtualKeyCode: event.keyCode,
                  nativeVirtualKeyCode: event.keyCode,
                  modifiers: event.modifiers || 0,
                  autoRepeat: false,
                  isKeypad: false,
                  isSystemKey: false,
                });
                break;
              }
              case "navigation": {
                const { event } = data as NavigationEvent;
                await navigatePage(event, targetPage);
                break;
              }
              case "closeTab": {
                const { pageId } = data as CloseTabEvent;
                await targetPage?.close();
                if (activePages.has(pageId)) {
                  activePages.delete(pageId);
                }
                break;
              }
              case "getSelectedText": {
                try {
                  const selectedText = await targetPage.evaluate(() => {
                    const selection = window.getSelection();
                    return selection ? selection.toString() : "";
                  });

                  // Send the selected text back to the client
                  ws.send(
                    JSON.stringify({
                      type: "selectedTextResponse",
                      pageId: (data as GetSelectedTextEvent).pageId,
                      text: selectedText,
                    }),
                  );
                } catch (error) {
                  console.error("Failed to get selected text:", error);
                  ws.send(
                    JSON.stringify({
                      type: "selectedTextResponse",
                      pageId: (data as GetSelectedTextEvent).pageId,
                      text: "",
                      error: error instanceof Error ? error.message : "Unknown error",
                    }),
                  );
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

        // Setup device metrics and start screencast
        await targetClient.send("Emulation.setDeviceMetricsOverride", {
          screenHeight: height,
          screenWidth: width,
          width,
          height,
          mobile: false,
          screenOrientation: { angle: 90, type: "landscapePrimary" },
          deviceScaleFactor: scaleFactor,
        });

        await targetClient.send("Page.startScreencast", {
          format: "jpeg",
          quality: 75,
          maxWidth: Math.round(width * scaleFactor),
          maxHeight: Math.round(height * scaleFactor),
        });

        // Handle screencast frames
        targetClient.on("Page.screencastFrame", async ({ data, sessionId }) => {
          try {
            // Acknowledge the frame right away to free up memory
            await targetClient?.send("Page.screencastFrameAck", { sessionId });

            if (ws.readyState === WebSocket.OPEN) {
              // Get page metadata
              const title = await getPageTitle(targetPage!);
              const favicon = await getPageFavicon(targetPage!);

              // Send frame data
              ws.send(
                JSON.stringify({
                  pageId: targetPageId,
                  url: targetPage?.url(),
                  title,
                  favicon,
                  data,
                }),
              );
            }
          } catch (err) {
            console.error("Error in Page.screencastFrame handler:", err);
          }
        });

        // Cleanup when target is destroyed
        browser.on("targetdestroyed", async (target) => {
          if (target.type() === "page") {
            try {
              //@ts-expect-error
              const pageId = target._targetId;

              if (pageId === targetPageId) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "targetClosed",
                      pageId: targetPageId,
                    }),
                  );
                }

                // Cleanup and close connection
                handleSessionCleanup();
                ws.close();
              }
            } catch (err) {
              console.error("Error handling destroyed target:", err);
            }
          }
        });

        // Setup heartbeat to detect dead connections
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.ping();
            } catch (err) {
              console.error("Error sending ping:", err);
              handleSessionCleanup();
            }
          } else {
            handleSessionCleanup();
          }
        }, 30000);

        // Cleanup on WebSocket closure
        ws.on("close", () => {
          handleSessionCleanup();
        });

        // Handle errors
        ws.on("error", (err) => {
          console.error("Cast WebSocket error:", err);
          handleSessionCleanup();
        });
      }
    } catch (err) {
      console.error("Error in cast session:", err);
      handleSessionCleanup();
      socket.destroy();
    }
  });
}
