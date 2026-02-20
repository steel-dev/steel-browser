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
  "facebook.com/tr/",
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

export function isAdRequest(parsed: URL): boolean {
  const { hostname } = parsed;
  return AD_HOSTS.some((adHost) => hostname === adHost || hostname.endsWith(`.${adHost}`));
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

export function isHostBlocked(parsed: URL, blockedHosts?: string[]): boolean {
  if (!blockedHosts?.length) return false;
  const { hostname } = parsed;
  return blockedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

export function compileUrlPatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
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
