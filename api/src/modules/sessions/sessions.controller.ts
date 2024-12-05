import { CDPService } from "../../services/cdp.service";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors";
import { CreateSessionRequest, SessionDetails } from "./sessions.schema";
import { BrowserLauncherOptions } from "../../types";
import { SeleniumService } from "../../services/selenium.service";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../env";

let activeSession: SessionDetails = {
  id: uuidv4(),
  createdAt: new Date().toISOString(),
  status: "live",
  duration: 0,
  eventCount: 0,
  timeout: 0,
  creditsUsed: 0,
  websocketUrl: `ws://${env.DOMAIN ?? env.HOST}:${env.PORT}/`,
  debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
  sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}`,
  userAgent: "",
  isSelenium: false,
  proxy: "",
  solveCaptcha: false,
};

export const handleLaunchBrowserSession = async (
  server: FastifyInstance,
  request: CreateSessionRequest,
  reply: FastifyReply,
) => {
  try {
    const { sessionId, proxyUrl, userAgent, sessionContext, extensions, logSinkUrl, timezone, dimensions, isSelenium } =
      request.body;

    // If there's an active session, close it first
    if (activeSession) {
      if (activeSession.isSelenium) {
        server.seleniumService.close();
      } else {
        await server.cdpService.shutdown();
      }
    }

    const browserLauncherOptions: BrowserLauncherOptions = {
      options: {
        headless: true,
        args: [userAgent ? `--user-agent=${userAgent}` : undefined].filter(Boolean) as string[],
        proxyUrl,
      },
      cookies: sessionContext?.cookies || [],
      userAgent: sessionContext?.userAgent,
      extensions: extensions || [],
      logSinkUrl,
      timezone: timezone || "US/Pacific",
      dimensions,
    };

    if (isSelenium) {
      await server.cdpService.shutdown();
      await server.seleniumService.launch(browserLauncherOptions);
      const sessionDetails: SessionDetails = {
        id: sessionId || uuidv4(),
        createdAt: new Date().toISOString(),
        status: "live",
        duration: 0,
        eventCount: 0,
        timeout: 0,
        creditsUsed: 0,
        websocketUrl: "",
        debugUrl: "",
        sessionViewerUrl: "",
        userAgent:
          sessionContext?.userAgent ||
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        proxy: proxyUrl,
        solveCaptcha: false,
        isSelenium,
      };
      activeSession = sessionDetails;
      reply.send(sessionDetails);
    } else {
      await server.cdpService.startNewSession(browserLauncherOptions);
      const sessionDetails: SessionDetails = {
        id: sessionId || uuidv4(),
        createdAt: new Date().toISOString(),
        status: "live",
        duration: 0,
        eventCount: 0,
        timeout: 0,
        creditsUsed: 0,
        websocketUrl: `ws://${env.DOMAIN ?? env.HOST}:${env.PORT}/`,
        debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
        sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}`,
        userAgent: server.cdpService.getUserAgent(),
        proxy: proxyUrl,
        solveCaptcha: false,
        isSelenium,
      };
      activeSession = sessionDetails;
      return reply.send(sessionDetails);
    }
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleExitBrowserSession = async (
  browserService: CDPService,
  seleniumService: SeleniumService,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    seleniumService.close();
    await browserService.endSession();
    activeSession = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      status: "live",
      duration: 0,
      eventCount: 0,
      timeout: 0,
      creditsUsed: 0,
      websocketUrl: `ws://${env.DOMAIN ?? env.HOST}/`,
      debugUrl: `http://${env.DOMAIN ?? env.HOST}/debug`,
      sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}`,
      userAgent: "",
      isSelenium: false,
      proxy: "",
      solveCaptcha: false,
    };
    reply.send({ success: true });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleGetBrowserContext = async (
  browserService: CDPService,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const context = await browserService.getBrowserState();
  return reply.send(context);
};

export const handleGetSessionDetails = async (
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  const sessionId = request.params.sessionId;
  if (sessionId !== activeSession.id) {
    return reply.send({
      id: sessionId,
      createdAt: new Date().toISOString(),
      status: "released",
      duration: 0,
      eventCount: 0,
      timeout: 0,
      creditsUsed: 0,
      websocketUrl: `ws://${env.DOMAIN ?? env.HOST}/`,
      debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
      sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}`,
      userAgent: "",
      isSelenium: false,
      proxy: "",
      solveCaptcha: false,
    });
  }
  return reply.send(activeSession);
};

export const handleGetSessions = async (request: FastifyRequest, reply: FastifyReply) => {
  return reply.send([activeSession]);
};
