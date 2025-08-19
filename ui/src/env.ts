import { z } from "zod";

const envSchema = z.object({
  VITE_API_URL: z.string().default(
    import.meta.env.MODE === "production" ? "" : "/api"
  ),
  VITE_WS_URL: z.string().default(
    import.meta.env.MODE === "production" ? "" : "/ws"
  ),
});

export const env = envSchema.parse(import.meta.env);
