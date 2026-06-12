import type { FastifyRequest } from "fastify";

import { env } from "../env.js";

/**
 * Returns the appropriate protocol based on the protocol type and HTTPS setting
 * @param protocolType 'http' or 'ws' - base protocol type
 * @returns The protocol string with or without 's' suffix based on env.USE_SSL
 */
function getProtocol(protocolType: "http" | "ws"): string {
  return env.USE_SSL ? `${protocolType}s` : protocolType;
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function getPublicHost(): string {
  if (env.DOMAIN) return env.DOMAIN;

  const host = env.HOST;
  if (isWildcardHost(host)) {
    return `localhost:${env.PORT}`;
  }

  return `${host}:${env.PORT}`;
}

export function getInternalHost(): string {
  const host = env.HOST_IP ?? env.HOST;
  if (isWildcardHost(host)) {
    return "localhost";
  }
  return host;
}

function getRequestHost(request: FastifyRequest): string | null {
  const forwardedHost = request.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.trim()) {
    return forwardedHost.trim();
  }
  if (Array.isArray(forwardedHost) && forwardedHost[0]?.trim()) {
    return forwardedHost[0].trim();
  }

  const host = request.headers.host;
  if (typeof host === "string" && host.trim()) {
    return host.trim();
  }

  return null;
}

function getRequestProtocol(request: FastifyRequest, protocolType: "http" | "ws"): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const normalized = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : "";

  if (normalized === "https" || normalized === "wss") {
    return protocolType === "ws" ? "wss" : "https";
  }
  if (normalized === "http" || normalized === "ws") {
    return protocolType === "ws" ? "ws" : "http";
  }

  return getProtocol(protocolType);
}

/**
 * Returns the base URL for the server, handling DOMAIN vs HOST:PORT appropriately
 * @param protocolType 'http' or 'ws' - determines the protocol prefix
 * @returns Formatted URL with appropriate protocol and trailing slash
 */
export function getBaseUrl(protocolType: "http" | "ws" = "http"): string {
  const baseUrl = getPublicHost();
  const protocol = getProtocol(protocolType);
  return `${protocol}://${baseUrl}/`;
}

export function getBaseUrlFromRequest(
  request: FastifyRequest,
  protocolType: "http" | "ws" = "http",
): string {
  const requestHost = getRequestHost(request);
  const baseUrl = requestHost || getPublicHost();
  const protocol = getRequestProtocol(request, protocolType);
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
  const formattedPath = path.startsWith("/") ? path.substring(1) : path;
  return `${base}${formattedPath}`;
}

export function getUrlFromRequest(
  request: FastifyRequest,
  path: string,
  protocolType: "http" | "ws" = "http",
): string {
  const base = getBaseUrlFromRequest(request, protocolType);
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
