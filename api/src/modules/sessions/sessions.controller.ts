import { CDPService } from "../../services/cdp/cdp.service.js";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors.js";
import { CreateSessionRequest, SessionDetails, SessionStreamRequest } from "./sessions.schema.js";
import { CookieData } from "../../services/context/types.js";
import { getUrl, getBaseUrl, getSessionUrl } from "../../utils/url.js";
import { env } from "../../env.js";

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

    if (typeof error === "string" && error.includes("Session pool is full")) {
      return reply.status(503).send({
        statusCode: 503,
        error: "Service Unavailable",
        message: error,
      });
    }

    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleExitBrowserSession = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId?: string } }>,
  reply: FastifyReply,
) => {
  try {
    const sessionId = request.params.sessionId;

    if (!sessionId) {
      const sessions = server.sessionService.listSessions();
      if (sessions.length === 0) {
        return reply.code(404).send({ success: false, message: "No active sessions to release" });
      }
      const sessionDetails = await server.sessionService.endSession(sessions[0].id);
      return reply.send({ success: true, ...sessionDetails });
    }

    const session = server.sessionService.getSession(sessionId);
    if (!session) {
      return reply.code(404).send({ success: false, message: `Session ${sessionId} not found` });
    }

    const sessionDetails = await server.sessionService.endSession(sessionId);
    reply.send({ success: true, ...sessionDetails });
  } catch (e: any) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleGetBrowserContext = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  const session = server.sessionService.getSession(request.params.sessionId);
  if (!session) {
    return reply.code(404).send({ message: `Session ${request.params.sessionId} not found` });
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
  const session = server.sessionService.getSession(sessionId);

  if (!session) {
    return reply.code(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Session ${sessionId} not found`,
    });
  }

  const duration = Date.now() - new Date(session.createdAt).getTime();
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
  const sessions = server.sessionService.listSessions().map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    status: s.status,
    duration: Date.now() - new Date(s.createdAt).getTime(),
    eventCount: s.eventCount,
    timeout: s.timeout,
    creditsUsed: s.creditsUsed,
    websocketUrl: s.websocketUrl,
    debugUrl: s.debugUrl,
    debuggerUrl: s.debuggerUrl,
    sessionViewerUrl: s.sessionViewerUrl,
    userAgent: s.userAgent,
    dimensions: s.dimensions,
    proxy: s.proxy,
    proxyTxBytes: s.proxyTxBytes,
    proxyRxBytes: s.proxyRxBytes,
    solveCaptcha: s.solveCaptcha,
    isSelenium: s.isSelenium,
  }));
  return reply.send({ sessions });
};

export const handleGetSessionStream = async (
  server: FastifyInstance,
  request: SessionStreamRequest & FastifyRequest<{ Params: { sessionId?: string } }>,
  reply: FastifyReply,
) => {
  const { showControls, theme, interactive, pageId, pageIndex } = request.query;
  const sessionId = request.params.sessionId;

  const singlePageMode = !!(pageId || pageIndex);

  let wsUrl: string;
  if (sessionId) {
    wsUrl = getSessionUrl(sessionId, "cast", "ws");
  } else {
    wsUrl = getUrl("v1/sessions/cast", "ws");
  }

  if (pageId) {
    wsUrl += `?pageId=${encodeURIComponent(pageId)}`;
  } else if (pageIndex) {
    wsUrl += `?pageIndex=${encodeURIComponent(pageIndex)}`;
  }

  const session = sessionId ? server.sessionService.getSession(sessionId) : null;

  return reply.view("live-session-streamer.ejs", {
    wsUrl,
    showControls,
    theme,
    interactive,
    dimensions: session?.dimensions || { width: 1920, height: 1080 },
    singlePageMode,
  });
};

export const handleGetSessionLiveDetails = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) => {
  try {
    const session = server.sessionService.getSession(request.params.id);
    if (!session) {
      return reply.code(404).send({
        statusCode: 404,
        error: "Not Found",
        message: `Session ${request.params.id} not found`,
      });
    }

    const cdpService = session.cdpService;
    const pages = await cdpService.getAllPages();

    const pagesInfo = await Promise.all(
      pages.map(async (page) => {
        try {
          const pageId = (page.target() as any)._targetId;

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
          server.log.error({ err: error }, "Error collecting page info");
          return null;
        }
      }),
    );

    const validPagesInfo = pagesInfo.filter((page) => page !== null);

    const browserState = {
      status: session.status,
      userAgent: session.userAgent,
      browserVersion: await cdpService.getBrowserState(),
      initialDimensions: session.dimensions || { width: 1920, height: 1080 },
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
    server.log.error({ err: error }, "Error getting session state");
    return reply.code(500).send({
      message: "Failed to get session state",
      error: getErrors(error),
    });
  }
};
