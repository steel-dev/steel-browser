import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url.js";

describe("normalizeUrl", () => {
  it("adds https:// to a bare host", () => {
    expect(normalizeUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("keeps http:// and https:// URLs unchanged", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("keeps a URL whose scheme is upper case", () => {
    expect(normalizeUrl("HTTPS://example.com/a")).toBe("HTTPS://example.com/a");
    expect(normalizeUrl("Http://example.com")).toBe("Http://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});
