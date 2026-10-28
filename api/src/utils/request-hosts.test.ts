import { describe, expect, it } from "vitest";
import { isAdRequest, isHostBlocked, normalizeHosts } from "./requests.js";

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
});
