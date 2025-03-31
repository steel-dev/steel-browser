import { z } from "zod";

const envSchema = z.object({
  VITE_API_URL: z.string().default("/api"),
  VITE_WS_URL: z.string().default("/ws"),
});

export const env = envSchema.parse(import.meta.env);
