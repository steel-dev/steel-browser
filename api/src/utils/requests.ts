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

export function isAdRequest(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return AD_HOSTS.some((adHost) => hostname === adHost || hostname.endsWith(`.${adHost}`));
  } catch {
    return false;
  }
}

export function isImageRequest(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const hasImageExt = /\.(jpg|jpeg|png|webp|svg|ico)(\?.*)?$/i.test(pathname);
    return hasImageExt;
  } catch {
    return false;
  }
}

export function isHeavyMediaRequest(url: string): boolean {
  try {
    const { pathname, searchParams } = new URL(url);
    const hasVideoExt = /\.(mp4|m4s|m3u8|ts|webm|gif)(\?.*)?$/i.test(pathname);
    const isRange = searchParams.has("range") || /range=\d+-\d+/i.test(url);
    if (hasVideoExt) return true;
    if (isRange && pathname.includes("/avf/")) return true;
    return false;
  } catch {
    return false;
  }
}

export function isHostBlocked(url: string, blockedHosts?: string[]): boolean {
  if (!blockedHosts?.length) return false;
  try {
    const { hostname } = new URL(url);
    return blockedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function isUrlMatchingPatterns(url: string, patterns?: string[]): boolean {
  if (!patterns?.length) return false;
  try {
    const toRegex = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    return patterns.some((p) => {
      try {
        const re = toRegex(p);
        return re.test(url);
      } catch {
        return url.includes(p);
      }
    });
  } catch {
    return false;
  }
}
