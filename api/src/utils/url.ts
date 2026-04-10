import dns from "dns";
import { promisify } from "util";
import net from "net";
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

const lookup = promisify(dns.lookup);

function isPrivateIP(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    return (
      parts[0] === 10 || // 10.0.0.0/8
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
      (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0/16
      parts[0] === 127 || // 127.0.0.0/8
      (parts[0] === 169 && parts[1] === 254) || // 169.254.0.0/16
      parts[0] === 0 || // 0.0.0.0/8
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || // 100.64.0.0/10
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) || // 192.0.0.0/24
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) || // 192.0.2.0/24
      (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) || // 198.18.0.0/15
      (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) || // 198.51.100.0/24
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || // 203.0.113.0/24
      parts[0] >= 224 // 224.0.0.0/4 and 240.0.0.0/4
    );
  } else if (net.isIPv6(ip)) {
    const ipLower = ip.toLowerCase();
    if (
      ipLower === "::1" ||
      ipLower === "::" ||
      ipLower.startsWith("fc") ||
      ipLower.startsWith("fd") || // fc00::/7
      ipLower.startsWith("fe8") ||
      ipLower.startsWith("fe9") ||
      ipLower.startsWith("fea") ||
      ipLower.startsWith("feb") // fe80::/10
    ) {
      return true;
    }
    if (ipLower.startsWith("::ffff:")) {
      const ipv4Part = ipLower.split("::ffff:")[1];
      return isPrivateIP(ipv4Part);
    }
  }
  return false;
}

export async function isSafeUrl(urlString: string): Promise<boolean> {
  try {
    const url = new URL(urlString);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    if (net.isIP(hostname)) {
      return !isPrivateIP(hostname);
    }

    try {
      const addresses = await lookup(hostname, { all: true });

      for (const { address } of addresses) {
        if (isPrivateIP(address)) {
          return false;
        }
      }
    } catch (e) {
      // If we can't resolve it, we err on the side of caution or allow it?
      // Usually better to fail safely for SSRF if it doesn't resolve, but fetch might still try if proxy is used.
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}
