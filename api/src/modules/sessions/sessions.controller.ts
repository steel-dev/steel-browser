import { BrowserRuntime } from "../../types/browser-runtime.interface.js";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors.js";
import { CreateSessionRequest, SessionDetails, SessionStreamRequest } from "./sessions.schema.js";
import { CookieData } from "../../services/context/types.js";
import { getUrl, getBaseUrl } from "../../utils/url.js";

export const handleLaunchBrowserSession = async (
  server: FastifyInstance,
  request: CreateSessionRequest,
  reply: FastifyReply,
) => {
  try {
    const {
      sessionId,
      proxyUrl,
      userDataDir,
      persist,
      userAgent,
      sessionContext,
      extensions,
      logSinkUrl,
      timezone,
      dimensions,
      isSelenium,
      blockAds,
      optimizeBandwidth,
      extra,
      credentials,
      skipFingerprintInjection,
      userPreferences,
      deviceConfig,
      headless,
    } = request.body;

    return await server.sessionService.startSession({
      sessionId,
      proxyUrl,
      userDataDir,
      persist,
      userAgent,
      sessionContext: sessionContext as {
        cookies?: CookieData[] | undefined;
        localStorage?: Record<string, Record<string, any>> | undefined;
      },
      extensions,
      logSinkUrl,
      timezone,
      dimensions,
      isSelenium,
      blockAds,
      optimizeBandwidth,
      extra,
      credentials,
      skipFingerprintInjection,
      userPreferences,
      deviceConfig,
      headless,
    });
  } catch (e: unknown) {
    server.log.error({ err: e }, "Failed lauching browser session");
    const error = getErrors(e);
    const statusCode =
      typeof (e as { statusCode?: unknown } | null)?.statusCode === "number"
        ? ((e as { statusCode: number }).statusCode as number)
        : 500;
    return reply.code(statusCode).send({ success: false, message: error });
  }
};

export const handleExitBrowserSession = async (
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const sessionDetails = await server.sessionService.endSession();

    reply.send({ success: true, ...sessionDetails });
  } catch (e: any) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleGetBrowserContext = async (
  browserService: BrowserRuntime,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const context = await browserService.getBrowserState();
  return reply.send(context);
};

export const handleGetSessionDetails = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  const sessionId = request.params.sessionId;
  if (sessionId !== server.sessionService.activeSession.id) {
    return reply.send({
      id: sessionId,
      createdAt: new Date().toISOString(),
      status: "released",
      duration: 0,
      eventCount: 0,
      timeout: 0,
      creditsUsed: 0,
      websocketUrl: getBaseUrl("ws"),
      debugUrl: getUrl("v1/sessions/debug"),
      debuggerUrl: getUrl("v1/devtools/inspector.html"),
      sessionViewerUrl: getBaseUrl(),
      userAgent: "",
      isSelenium: false,
      proxy: "",
      proxyTxBytes: 0,
      proxyRxBytes: 0,
      solveCaptcha: false,
    } as SessionDetails);
  }

  const session = server.sessionService.activeSession;
  const duration = new Date().getTime() - new Date(session.createdAt).getTime();
  console.log("duration", duration);
  return reply.send({
    ...session,
    duration,
  });
};

export const handleGetSessions = async (
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const currentSession = {
    ...server.sessionService.activeSession,
    duration:
      new Date().getTime() - new Date(server.sessionService.activeSession.createdAt).getTime(),
  };
  const pastSessions = server.sessionService.pastSessions;
  return reply.send({ sessions: [currentSession, ...pastSessions] });
};

export const handleGetSessionStream = async (
  server: FastifyInstance,
  request: SessionStreamRequest,
  reply: FastifyReply,
) => {
  const { showControls, theme, interactive, pageId, pageIndex } = request.query;

  const singlePageMode = !!(pageId || pageIndex);

  // Construct WebSocket URL with page parameters if present
  let wsUrl = getUrl("v1/sessions/cast", "ws");
  if (pageId) {
    wsUrl += `?pageId=${encodeURIComponent(pageId)}`;
  } else if (pageIndex) {
    wsUrl += `?pageIndex=${encodeURIComponent(pageIndex)}`;
  }

  return reply.view("live-session-streamer.ejs", {
    wsUrl,
    showControls,
    theme,
    interactive,
    dimensions: server.sessionService.activeSession.dimensions,
    singlePageMode,
  });
};

export const handleGetSessionLiveDetails = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  try {
    const pages = await server.cdpService.getAllPages();

    const pagesInfo = await Promise.all(
      pages.map(async (page) => {
        try {
          const pageId = server.cdpService.getTargetId(page);

          const title = await page.title();

          let favicon: string | null = null;
          try {
            favicon = await page.evaluate(() => {
              const iconLink = document.querySelector(
                'link[rel="icon"], link[rel="shortcut icon"]',
              );
              if (iconLink) {
                const href = iconLink.getAttribute("href");
                if (href?.startsWith("http")) return href;
                if (href?.startsWith("//")) return window.location.protocol + href;
                if (href?.startsWith("/")) return window.location.origin + href;
                return window.location.origin + "/" + href;
              }
              return null;
            });
          } catch (error) {}

          return {
            id: pageId,
            url: page.url(),
            title,
            favicon,
          };
        } catch (error) {
          console.error("Error collecting page info:", error);
          return null;
        }
      }),
    );

    const validPagesInfo = pagesInfo.filter((page) => page !== null);

    const browserVersion = await server.cdpService.getBrowserState();

    const browserState = {
      status: server.sessionService.activeSession.status,
      userAgent: server.sessionService.activeSession.userAgent,
      browserVersion,
      initialDimensions: server.sessionService.activeSession.dimensions || {
        width: 1920,
        height: 1080,
      },
      pageCount: validPagesInfo.length,
    };

    return reply.send({
      pages: validPagesInfo,
      browserState,
      websocketUrl: server.sessionService.activeSession.websocketUrl,
      sessionViewerUrl: server.sessionService.activeSession.sessionViewerUrl,
      sessionViewerFullscreenUrl: `${server.sessionService.activeSession.sessionViewerUrl}?showControls=false`,
    });
  } catch (error) {
    console.error("Error getting session state:", error);
    return reply.code(500).send({
      message: "Failed to get session state",
      error: getErrors(error),
    });
  }
};
