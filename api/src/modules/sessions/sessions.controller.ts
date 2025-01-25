import { CDPService } from "../../services/cdp.service";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors";
import { CreateSessionRequest } from "./sessions.schema";
import { env } from "../../env";

export const handleLaunchBrowserSession = async (
  server: FastifyInstance,
  request: CreateSessionRequest,
  reply: FastifyReply,
) => {
  try {
    const {
      sessionId,
      proxyUrl,
      userAgent,
      sessionContext,
      extensions,
      logSinkUrl,
      timezone,
      dimensions,
      isSelenium,
      blockAds,
    } = request.body;

    // If there's an active session, close it first
    await server.sessionService.endSession();

    return await server.sessionService.startSession({
      sessionId,
      proxyUrl,
      userAgent,
      sessionContext,
      extensions,
      logSinkUrl,
      timezone,
      dimensions,
      isSelenium,
      blockAds,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
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
      websocketUrl: `ws://${env.DOMAIN ?? env.HOST}/`,
      debugUrl: `http://${env.DOMAIN ?? env.HOST}:${env.PORT}/v1/devtools/inspector.html`,
      sessionViewerUrl: `http://${env.DOMAIN ?? env.HOST}`,
      userAgent: "",
      isSelenium: false,
      proxy: "",
      solveCaptcha: false,
    });
  }
  return reply.send(server.sessionService.activeSession);
};

export const handleGetSessions = async (server: FastifyInstance, request: FastifyRequest, reply: FastifyReply) => {
  return reply.send([server.sessionService.activeSession]);
};
