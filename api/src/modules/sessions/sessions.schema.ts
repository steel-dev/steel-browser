import { FastifyRequest } from "fastify";
import { z } from "zod";

const CreateSession = z.object({
  sessionId: z.string().uuid().optional().describe("Unique identifier for the session"),
  proxyUrl: z.string().optional().describe("Proxy URL to use for the session"),
  userAgent: z.string().optional().describe("User agent string to use for the session"),
  sessionContext: z.record(z.any()).optional().describe("Session context to use for the session"),
  isSelenium: z.boolean().optional().describe("Indicates if Selenium is used in the session"),
  blockAds: z.boolean().optional().describe("Flag to indicate if ads should be blocked in the session"),
  // Specific to hosted steel
  logSinkUrl: z.string().optional().describe("Log sink URL to use for the session"),
  extensions: z.array(z.string()).optional().describe("Extensions to use for the session"),
  timezone: z.string().optional().describe("Timezone to use for the session"),
  dimensions: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe("Dimensions to use for the session"),
});

const SessionDetails = z.object({
  id: z.string().uuid().describe("Unique identifier for the session"),
  createdAt: z.string().datetime().describe("Timestamp when the session started"),
  status: z.enum(["pending", "live", "released", "failed"]).describe("Status of the session"),
  duration: z.number().int().describe("Duration of the session in milliseconds"),
  eventCount: z.number().int().describe("Number of events processed in the session"),
  timeout: z.number().int().describe("Session timeout duration in milliseconds"),
  creditsUsed: z.number().int().describe("Amount of credits consumed by the session"),
  websocketUrl: z.string().describe("URL for the session's WebSocket connection"),
  debugUrl: z.string().describe("URL for debugging the session"),
  sessionViewerUrl: z.string().describe("URL to view session details"),
  userAgent: z.string().optional().describe("User agent string used in the session"),
  proxy: z.string().optional().describe("Proxy server used for the session"),
  proxyTxBytes: z.number().int().nonnegative().describe("Amount of data transmitted through the proxy"),
  proxyRxBytes: z.number().int().nonnegative().describe("Amount of data received through the proxy"),
  solveCaptcha: z.boolean().optional().describe("Indicates if captcha solving is enabled"),
  isSelenium: z.boolean().optional().describe("Indicates if Selenium is used in the session"),
});

const ReleaseSession = SessionDetails.merge(z.object({ success: z.boolean().describe("Indicates if the session was successfully released") }));

const RecordedEvents = z.object({
  events: z.array(z.any()).describe("Events to emit"),
});

export type RecordedEvents = z.infer<typeof RecordedEvents>;

const MultipleSessions = z.array(SessionDetails);

export type CreateSessionBody = z.infer<typeof CreateSession>;
export type CreateSessionRequest = FastifyRequest<{ Body: CreateSessionBody }>;

export type SessionDetails = z.infer<typeof SessionDetails>;
export type MultipleSessions = z.infer<typeof MultipleSessions>;
export const browserSchemas = {
  CreateSession,
  SessionDetails,
  MultipleSessions,
  RecordedEvents,
  ReleaseSession,
};

export default browserSchemas;
