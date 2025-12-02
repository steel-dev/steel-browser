import { z } from "zod";
import { config } from "dotenv";

config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["test", "development", "staging", "production", "preview"])
    .default("development"),
  HOST: z.string().optional().default("0.0.0.0"),
  DOMAIN: z.string().optional(),
  PORT: z.string().optional().default("3000"),
  USE_SSL: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  CDP_REDIRECT_PORT: z.string().optional().default("9222"),
  CDP_DOMAIN: z.string().optional(),
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
  DISPLAY: z.string().optional().default(":10"),
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
  TIMEZONE_SERVICE_URL: z.string().optional(),
  SKIP_FINGERPRINT_INJECTION: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  CHROME_ARGS: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(" ").map((arg) => arg.trim()) : []))
    .default(""),
  FILTER_CHROME_ARGS: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(" ").map((arg) => arg.trim()) : []))
    .default(""),
  DEBUG_CHROME_PROCESS: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  PROXY_INTERNAL_BYPASS: z.string().optional(),
  CHROME_USER_DATA_DIR: z.string().optional(),
  LOG_STORAGE_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  LOG_STORAGE_PATH: z.string().optional(),
});

export const env = envSchema.parse(process.env);
