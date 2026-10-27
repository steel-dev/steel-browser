import { env } from "../env.js";

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
 * Builds the DevTools frontend URL for a debugger websocket endpoint.
 *
 * The frontend expects a scheme-less host/path and prepends the scheme itself,
 * choosing it from which query parameter carries the value: `ws` becomes
 * `ws://`, `wss` becomes `wss://`. A secure endpoint therefore has to be passed
 * as `wss`, otherwise the frontend opens an insecure socket that an
 * HTTPS-served frontend then blocks as mixed content.
 *
 * @param debuggerUrl Absolute URL of the DevTools frontend
 * @param debuggerWsUrl Absolute ws:// or wss:// debugger endpoint
 * @returns The frontend URL carrying the endpoint in the matching parameter
 */
export function buildDevtoolsFrontendUrl(debuggerUrl: string, debuggerWsUrl: string): string {
  const isSecure = debuggerWsUrl.startsWith("wss:");
  const parameter = isSecure ? "wss" : "ws";
  const schemeless = debuggerWsUrl.replace(/^wss?:/, "");

  return `${debuggerUrl}?${parameter}=${schemeless}`;
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

/**
 * Normalizes a URL by adding https:// protocol if missing
 * @param url The URL to normalize
 * @returns The normalized URL with proper protocol, or null if invalid
 */
export function normalizeUrl(url: string): string | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    return trimmedUrl;
  }

  const normalizedUrl = `https://${trimmedUrl}`;

  try {
    new URL(normalizedUrl);
    return normalizedUrl;
  } catch {
    return null;
  }
}
