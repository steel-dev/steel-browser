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
