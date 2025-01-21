import { z } from "zod";
import { config } from "dotenv";

config();

const envSchema = z.object({
  STEEL_HOST: z.string().optional().default("0.0.0.0"),
  STEEL_DOMAIN: z.string().optional(),
  STEEL_PORT: z.string().optional().default("3000"),
  STEEL_CDP_REDIRECT_PORT: z.string().optional().default("9222"),
  STEEL_PROXY_URL: z.string().optional(),
  STEEL_DEFAULT_HEADERS: z
    .string()
    .optional()
    .transform((val) => (val ? JSON.parse(val) : {}))
    .pipe(z.record(z.string()).optional().default({})),
  KILL_TIMEOUT: z.string().optional().default("25"), // to fit in default 30 seconds of Heroku or ECS with some margin
  CHROME_EXECUTABLE_PATH: z.string().optional(),
});

export const env = envSchema.parse(process.env);
