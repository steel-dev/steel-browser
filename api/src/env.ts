import { z } from "zod";
import { config } from "dotenv";

config();

const envSchema = z.object({
  HOST: z.string().optional().default("0.0.0.0"),
  DOMAIN: z.string().optional(),
  PORT: z.string().optional().default("3000"),
  CDP_REDIRECT_PORT: z.string().optional().default("9222"),
  PROXY_URL: z.string().optional(),
  DEFAULT_HEADERS: z
    .string()
    .optional()
    .transform((val) => (val ? JSON.parse(val) : {}))
    .pipe(z.record(z.string()).optional().default({})),
  KILL_TIMEOUT: z.string().optional().default("0"),
  CHROME_EXECUTABLE_PATH: z.string().optional(),
  CHROME_HEADLESS: z
    .string()
    .optional()
    .transform((val) => val !== "false")
    .default("true"),
  ENABLE_CDP_LOGGING: z
    .string()
    .optional()
    .transform((val) => val !== "false")
    .default("false"),
  LOG_CUSTOM_EMIT_EVENTS: z
    .string()
    .optional()
    .transform((val) => val !== "false")
    .default("false"),
  ENABLE_VERBOSE_LOGGING: z
    .string()
    .optional()
    .transform((val) => val !== "false")
    .default("false"),
  DEFAULT_TIMEZONE: z.string().optional(),
  SKIP_FINGERPRINT_INJECTION: z
    .string()
    .optional()
    .transform((val) => val !== "false" && val !== "")
    .default("false"),
});

export const env = envSchema.parse(process.env);
