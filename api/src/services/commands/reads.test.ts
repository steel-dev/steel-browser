import { describe, expect, test } from "vitest";
import { urlMatches } from "./reads.js";

describe("urlMatches", () => {
  test.each([
    ["example.com", "https://example.com/a", true],
    ["https://example.com/*", "https://example.com/a/b", true],
    ["*/checkout/*", "https://shop.test/checkout/done", true],
    ["https://*.test/done", "https://a.test/done", true],
    ["*done", "https://a.test/done?x=1", false],
    ["a*a", "a", false],
    ["*", "https://a.test/", true],
    ["https://a.test/*/b", "https://a.test/b", false],
  ])("%s against %s", (pattern, url, expected) => {
    expect(urlMatches(pattern, url)).toBe(expected);
  });

  test("stays fast with many wildcards", () => {
    const started = Date.now();
    expect(urlMatches("*a".repeat(12) + "*b", "https://example.com/" + "a".repeat(80))).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});
