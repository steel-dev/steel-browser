import { FastifyRequest } from "fastify";
import { z } from "zod";

const CreateSession = z.object({
  sessionId: z.string().uuid().optional().describe("Unique identifier for the session"),
  proxyUrl: z.string().optional().describe("Proxy URL to use for the session"),
  userAgent: z.string().optional().describe("User agent string to use for the session"),
  sessionContext: z
    .object({
      cookies: z
        .array(
          z.object({
            name: z.string().describe("Name of the cookie"),
            value: z.string().describe("Value of the cookie"),
            domain: z.string().describe("Domain the cookie belongs to"),
            path: z.string().default("/").describe("Path the cookie is valid for"),
            expires: z.number().optional().describe("Unix timestamp when the cookie expires"),
            httpOnly: z.boolean().optional().describe("Whether the cookie is HTTP only"),
            secure: z.boolean().optional().describe("Whether the cookie requires HTTPS"),
            sameSite: z.enum(["Strict", "Lax", "None"]).optional().describe("SameSite attribute of the cookie"),
          }),
        )
        .optional()
        .describe("Cookies to initialize in the session"),
      localStorage: z
        .record(z.string(), z.record(z.string(), z.any()))
        .optional()
        .describe("Domain-specific localStorage items to initialize in the session"),
    })
    .optional()
    .describe(
      "Session context data to be used in the created session. Sessions will start with an empty context by default.",
    ),
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
  status: z.enum(["idle", "live", "released", "failed"]).describe("Status of the session"),
  duration: z.number().int().describe("Duration of the session in milliseconds"),
  eventCount: z.number().int().describe("Number of events processed in the session"),
  dimensions: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe("Dimensions used for the session"),
  timeout: z.number().int().describe("Session timeout duration in milliseconds"),
  creditsUsed: z.number().int().describe("Amount of credits consumed by the session"),
  websocketUrl: z.string().describe("URL for the session's WebSocket connection"),
  debugUrl: z.string().describe("URL for a viewing the live browser instance for the session"),
  debuggerUrl: z.string().describe("URL for debugging the session"),
  sessionViewerUrl: z.string().describe("URL to view session details"),
  userAgent: z.string().optional().describe("User agent string used in the session"),
  proxy: z.string().optional().describe("Proxy server used for the session"),
  proxyTxBytes: z.number().int().nonnegative().describe("Amount of data transmitted through the proxy"),
  proxyRxBytes: z.number().int().nonnegative().describe("Amount of data received through the proxy"),
  solveCaptcha: z.boolean().optional().describe("Indicates if captcha solving is enabled"),
  isSelenium: z.boolean().optional().describe("Indicates if Selenium is used in the session"),
});

const ReleaseSession = SessionDetails.merge(
  z.object({ success: z.boolean().describe("Indicates if the session was successfully released") }),
);

const RecordedEvents = z.object({
  events: z.array(z.any()).describe("Events to emit"),
});

const SessionStreamQuery = z.object({
  showControls: z.boolean().optional().default(true).describe("Show controls in the browser iframe"),
  theme: z.enum(["dark", "light"]).optional().default("dark").describe("Theme of the browser iframe"),
  interactive: z.boolean().optional().default(true).describe("Make the browser iframe interactive"),
});

const SessionStreamResponse = z.string().describe("HTML content for the session streamer view");

const MultipleSessions = z.array(SessionDetails);

export type RecordedEvents = z.infer<typeof RecordedEvents>;
export type CreateSessionBody = z.infer<typeof CreateSession>;
export type CreateSessionRequest = FastifyRequest<{ Body: CreateSessionBody }>;
export type SessionDetails = z.infer<typeof SessionDetails>;
export type MultipleSessions = z.infer<typeof MultipleSessions>;

export type SessionStreamQuery = z.infer<typeof SessionStreamQuery>;
export type SessionStreamRequest = FastifyRequest<{ Querystring: SessionStreamQuery }>;

export const browserSchemas = {
  CreateSession,
  SessionDetails,
  MultipleSessions,
  RecordedEvents,
  ReleaseSession,
  SessionStreamQuery,
  SessionStreamResponse,
};

export default browserSchemas;
