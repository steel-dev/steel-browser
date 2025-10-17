import { z } from "zod";

const LaunchRequest = z.object({
  options: z.object({
    args: z.array(z.string()).optional(),
    chromiumSandbox: z.boolean().optional(),
    devtools: z.boolean().optional(),
    downloadsPath: z.string().optional(),
    headless: z.boolean().optional(),
    ignoreDefaultArgs: z.union([z.boolean(), z.array(z.string())]).optional(),
    proxyUrl: z.string().optional(),
    timeout: z.number().optional(),
    tracesDir: z.string().optional(),
  }),
  req: z.any().optional(),
  stealth: z.boolean().optional(),
  cookies: z.array(z.any()).optional(),
  userAgent: z.string().optional(),
  extensions: z.array(z.string()).optional(),
  logSinkUrl: z.string().optional(),
  customHeaders: z.record(z.string()).optional(),
  timezone: z.string().optional(),
  dimensions: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .nullable()
    .optional(),
});

const LaunchResponse = z.object({
  success: z.boolean(),
});

export type LaunchRequest = z.infer<typeof LaunchRequest>;

export const seleniumSchemas = {
  LaunchRequest,
  LaunchResponse,
};

export default seleniumSchemas;
