const AD_HOSTS = [
  // Ad Networks & Services
  "doubleclick.net",
  "adservice.google.com",
  "googlesyndication.com",
  "google-analytics.com",
  "adnxs.com",
  "rubiconproject.com",
  "advertising.com",
  "adtechus.com",
  "quantserve.com",
  "scorecardresearch.com",
  "casalemedia.com",
  "moatads.com",
  "criteo.com",
  "amazon-adsystem.com",
  "serving-sys.com",
  "adroll.com",
  "chartbeat.com",
  "sharethrough.com",
  "indexww.com",
  "mediamath.com",
  "adsystem.com",
  "adservice.com",
  "adnxs.com",
  "ads-twitter.com",

  // Analytics & Tracking
  "hotjar.com",
  "analytics.google.com",
  "mixpanel.com",
  "kissmetrics.com",
  "googletagmanager.com",
  // Microsoft Clarity
  "clarity.ms",
  "www.clarity.ms",
  "static.clarity.ms",

  // Ad Exchanges
  "openx.net",
  "pubmatic.com",
  "bidswitch.net",
  "taboola.com",
  "outbrain.com",

  // Social Media Tracking
  "facebook.com/tr",
  "connect.facebook.net",
  "platform.twitter.com",
  "ads.linkedin.com",
];

const RE_IMAGE_EXT = /\.(jpg|jpeg|png|webp|svg|ico)(\?.*)?$/i;
const RE_VIDEO_EXT = /\.(mp4|m4s|m3u8|ts|webm|gif)(\?.*)?$/i;
const RE_RANGE = /range=\d+-\d+/i;

export function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Hostnames are case-insensitive and may carry a trailing root dot ("example.com.").
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

function adEntryMatches(parsed: URL, hostname: string, entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return hostMatches(hostname, entry);
  const path = entry.slice(slash);
  return (
    hostMatches(hostname, entry.slice(0, slash)) &&
    (parsed.pathname === path || parsed.pathname.startsWith(`${path}/`))
  );
}

export function isAdRequest(parsed: URL): boolean {
  const hostname = normalizeHost(parsed.hostname);
  return AD_HOSTS.some((entry) => adEntryMatches(parsed, hostname, entry));
}

export function isImageRequest(parsed: URL): boolean {
  return RE_IMAGE_EXT.test(parsed.pathname);
}

export function isHeavyMediaRequest(parsed: URL): boolean {
  const { pathname, searchParams } = parsed;
  if (RE_VIDEO_EXT.test(pathname)) return true;
  const isRange = searchParams.has("range") || RE_RANGE.test(parsed.href);
  return isRange && pathname.includes("/avf/");
}

export function normalizeHosts(hosts: string[]): string[] {
  return hosts.map(normalizeHost);
}

export function isHostBlocked(parsed: URL, normalizedHosts?: string[]): boolean {
  if (!normalizedHosts?.length) return false;
  const hostname = normalizeHost(parsed.hostname);
  return normalizedHosts.some((h) => hostMatches(hostname, h));
}

export function compileUrlPatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
        "i",
      );
    } catch {
      // Fallback: escape the entire pattern for literal matching
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  });
}

export function isUrlMatchingPatterns(url: string, compiledPatterns?: RegExp[]): boolean {
  if (!compiledPatterns?.length) return false;
  return compiledPatterns.some((re) => re.test(url));
}
