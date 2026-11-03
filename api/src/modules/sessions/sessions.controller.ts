import { CDPService } from "../../services/cdp/cdp.service.js";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors.js";
import { CreateSessionRequest, SessionDetails, SessionStreamRequest } from "./sessions.schema.js";
import { CookieData } from "../../services/context/types.js";
import { getUrl, getBaseUrl, getSessionUrl } from "../../utils/url.js";
import { SessionServiceError } from "../../services/session.service.js";

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
    server.log.error({ err: e }, "Failed launching browser session");
    const error = getErrors(e);
    const statusCode = e instanceof SessionServiceError ? e.statusCode : 500;
    return reply.code(statusCode).send({ success: false, message: error });
  }
};

export const handleExitBrowserSession = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const sessionDetails = await server.sessionService.endSession(request.params.sessionId);

    reply.send({ success: true, ...sessionDetails });
  } catch (e: any) {
    const error = getErrors(e);
    const statusCode = e instanceof SessionServiceError ? e.statusCode : 500;
    return reply.code(statusCode).send({ success: false, message: error });
  }
};

export const handleGetBrowserContext = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  const session = server.sessionService.getLiveSession(request.params.sessionId);
  if (!session) {
    return reply.code(404).send({ message: `Session ${request.params.sessionId} not found` });
  }
  if (session.isSelenium) {
    return reply
      .code(409)
      .send({ message: "Browser context is unavailable for Selenium sessions." });
  }
  const context = await session.cdpService.getBrowserState();
  return reply.send(context);
};

export const handleGetSessionDetails = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  const sessionId = request.params.sessionId;
  const session = server.sessionService.getSessionDetails(sessionId);
  if (!session) {
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

  return reply.send(session);
};

export const handleGetSessions = async (
  server: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  return reply.send({ sessions: server.sessionService.listSessions() });
};

export const handleGetSessionStream = async (
  server: FastifyInstance,
  request: SessionStreamRequest & FastifyRequest<{ Params: { sessionId?: string } }>,
  reply: FastifyReply,
) => {
  const { showControls, theme, interactive, pageId, pageIndex } = request.query;
  const requestedId = request.params.sessionId;

  let session;
  try {
    session = requestedId
      ? server.sessionService.getLiveSession(requestedId)
      : server.sessionService.getOnlyActiveSession();
  } catch (error) {
    const statusCode = error instanceof SessionServiceError ? error.statusCode : 500;
    return reply.code(statusCode).send({ message: getErrors(error) });
  }
  if (requestedId && !session) {
    return reply.code(404).send({ message: `Session ${requestedId} not found` });
  }
  if (session?.isSelenium) {
    return reply.code(409).send({ message: "Live view is unavailable for Selenium sessions." });
  }

  const singlePageMode = !!(pageId || pageIndex);

  // Construct WebSocket URL with page parameters if present
  let wsUrl = session ? getSessionUrl(session.id, "cast", "ws") : getUrl("v1/sessions/cast", "ws");
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
    dimensions: session?.dimensions ?? { width: 1920, height: 1080 },
    singlePageMode,
  });
};

export const handleGetSessionLiveDetails = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  try {
    const session = server.sessionService.getLiveSession(request.params.id);
    if (!session) {
      return reply.code(404).send({ message: `Session ${request.params.id} not found` });
    }
    if (session.isSelenium) {
      return reply
        .code(409)
        .send({ message: "Live details are unavailable for Selenium sessions." });
    }
    const cdpService: CDPService = session.cdpService;
    const pages = await cdpService.getAllPages();

    const pagesInfo = await Promise.all(
      pages.map(async (page) => {
        try {
          const pageId = page.target()._targetId;

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

    const browserVersion = await cdpService.getBrowserState();

    const browserState = {
      status: session.status,
      userAgent: session.userAgent ?? "",
      browserVersion,
      initialDimensions: session.dimensions || {
        width: 1920,
        height: 1080,
      },
      pageCount: validPagesInfo.length,
    };

    return reply.send({
      pages: validPagesInfo,
      browserState,
      websocketUrl: session.websocketUrl,
      sessionViewerUrl: session.sessionViewerUrl,
      sessionViewerFullscreenUrl: `${session.sessionViewerUrl}?showControls=false`,
    });
  } catch (error) {
    console.error("Error getting session state:", error);
    return reply.code(500).send({
      message: "Failed to get session state",
      error: getErrors(error),
    });
  }
};
