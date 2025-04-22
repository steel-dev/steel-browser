import { z } from "zod";
import { config } from "dotenv";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  HOST: z.string().optional().default("0.0.0.0"),
  DOMAIN: z.string().optional(),
  PORT: z.string().optional().default("3000"),
  USE_SSL: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
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
    .transform((val) => val === "true" || val === "1")
    .default("true"),
  ENABLE_CDP_LOGGING: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  LOG_CUSTOM_EMIT_EVENTS: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  ENABLE_VERBOSE_LOGGING: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  DEFAULT_TIMEZONE: z.string().optional(),
  SKIP_FINGERPRINT_INJECTION: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  CHROME_ARGS: z.string().optional().default(""),
});

export const env = envSchema.parse(process.env);
