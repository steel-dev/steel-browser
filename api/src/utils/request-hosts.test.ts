import { describe, expect, it } from "vitest";
import {
  compileUrlPatterns,
  isAdRequest,
  isHostBlocked,
  isUrlMatchingPatterns,
  normalizeHosts,
} from "./requests.js";

describe("isHostBlocked", () => {
  it("matches the host and its subdomains", () => {
    const blocked = ["example.com"];
    expect(isHostBlocked(new URL("https://example.com/a"), blocked)).toBe(true);
    expect(isHostBlocked(new URL("https://cdn.example.com/a"), blocked)).toBe(true);
    expect(isHostBlocked(new URL("https://notexample.com/a"), blocked)).toBe(false);
  });

  it("matches configured hosts regardless of case", () => {
    const blocked = normalizeHosts(["Ads.Example.COM"]);
    expect(isHostBlocked(new URL("https://ads.example.com/a"), blocked)).toBe(true);
  });

  it("matches a request host that has a trailing root dot", () => {
    expect(isHostBlocked(new URL("https://example.com./a"), ["example.com"])).toBe(true);
    expect(isHostBlocked(new URL("https://cdn.example.com./a"), ["example.com"])).toBe(true);
  });

  it("matches a configured host that has a trailing root dot", () => {
    const blocked = normalizeHosts(["example.com."]);
    expect(isHostBlocked(new URL("https://example.com/a"), blocked)).toBe(true);
  });
});

describe("normalizeHosts", () => {
  it("lowercases hosts and drops one trailing root dot", () => {
    expect(normalizeHosts(["Ads.Example.COM", "example.com."])).toEqual([
      "ads.example.com",
      "example.com",
    ]);
  });
});

describe("isAdRequest", () => {
  it("matches an ad host with a trailing root dot", () => {
    expect(isAdRequest(new URL("https://doubleclick.net./ad"))).toBe(true);
    expect(isAdRequest(new URL("https://stats.g.doubleclick.net./ad"))).toBe(true);
  });

  it("does not match unrelated hosts", () => {
    expect(isAdRequest(new URL("https://example.com/ad"))).toBe(false);
  });

  it("matches an ad entry's path on its host only", () => {
    expect(isAdRequest(new URL("https://www.facebook.com/tr/?id=1&ev=PageView"))).toBe(true);
    expect(isAdRequest(new URL("https://facebook.com/tr?id=1"))).toBe(true);
    expect(isAdRequest(new URL("https://www.facebook.com/trending"))).toBe(false);
  });
});

describe("compileUrlPatterns", () => {
  const matches = (pattern: string, url: string) =>
    isUrlMatchingPatterns(url, compileUrlPatterns([pattern]));

  it("treats ? as a literal query separator", () => {
    expect(matches("https://example.com/api?key=*", "https://example.com/api?key=1")).toBe(true);
  });

  it("does not make the character before ? optional", () => {
    expect(matches("https://example.com/api?key=*", "https://example.com/apkey=1")).toBe(false);
  });

  it("still treats * as a wildcard", () => {
    expect(matches("*.example.com/*", "https://cdn.example.com/a.js")).toBe(true);
    expect(matches("*.example.com/*", "https://example.org/a.js")).toBe(false);
  });
});
