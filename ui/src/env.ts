import { z } from "zod";

const envSchema = z.object({
  VITE_API_URL: z.string().default("http://0.0.0.0:3000"),
  VITE_WS_URL: z.string().default("ws://0.0.0.0:3000"),
  VITE_OPENAPI_URL: z
    .string()
    .default("http://0.0.0.0:3000/documentation/json"),
});

export const env = envSchema.parse(import.meta.env);
