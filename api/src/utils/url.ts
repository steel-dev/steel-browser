import { env } from "../env";

/**
 * Returns the appropriate protocol based on the protocol type and HTTPS setting
 * @param protocolType 'http' or 'ws' - base protocol type
 * @returns The protocol string with or without 's' suffix based on env.USE_SSL
 */
function getProtocol(protocolType: "http" | "ws"): string {
  return env.USE_SSL ? `${protocolType}s` : protocolType;
}

/**
 * Returns the base URL for the server, handling DOMAIN vs HOST:PORT appropriately
 * @param protocolType 'http' or 'ws' - determines the protocol prefix
 * @returns Formatted base URL with appropriate protocol and trailing slash
 */
export function getBaseUrl(protocolType: "http" | "ws" = "http"): string {
  const baseUrl = env.DOMAIN ?? `${env.HOST}:${env.PORT}`;
  const protocol = getProtocol(protocolType);
  return `${protocol}://${baseUrl}/`;
}

/**
 * Returns a fully qualified URL with the given path
 * @param path The path to append to the base URL
 * @param protocolType 'http' or 'ws' - determines the protocol prefix
 * @returns Formatted URL with appropriate protocol
 */
export function getUrl(path: string, protocolType: "http" | "ws" = "http"): string {
  const base = getBaseUrl(protocolType);
  // Handle paths that might already have a leading slash
  const formattedPath = path.startsWith("/") ? path.substring(1) : path;
  return `${base}${formattedPath}`;
}
