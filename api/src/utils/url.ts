import { env } from "../env";

/**
 * Returns the base URL for the server, handling DOMAIN vs HOST:PORT appropriately
 * @param protocol 'http' or 'ws' - determines the protocol prefix
 * @returns Formatted base URL with appropriate protocol and trailing slash
 */
export function getBaseUrl(protocol: "http" | "ws" = "http"): string {
  const baseUrl = env.DOMAIN ?? `${env.HOST}:${env.PORT}`;
  return `${protocol}://${baseUrl}/`;
}

/**
 * Returns a fully qualified URL with the given path
 * @param path The path to append to the base URL
 * @param protocol 'http' or 'ws' - determines the protocol prefix
 * @returns Formatted URL with appropriate protocol
 */
export function getUrl(path: string, protocol: "http" | "ws" = "http"): string {
  const base = getBaseUrl(protocol);
  // Handle paths that might already have a leading slash
  const formattedPath = path.startsWith("/") ? path.substring(1) : path;
  return `${base}${formattedPath}`;
}
