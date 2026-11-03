import { afterEach, describe, expect, it, vi } from "vitest";
import { getPageFavicon } from "./casting.js";

// Runs the function passed to page.evaluate against a fake document.
const faviconFor = (pageUrl: string, href: string | null, base: string = pageUrl) => {
  vi.stubGlobal("document", {
    baseURI: base,
    querySelector: () => (href === null ? null : { getAttribute: () => href }),
  });
  vi.stubGlobal("window", { location: new URL(pageUrl) });
  const page = { evaluate: async (fn: () => unknown) => fn() };
  return getPageFavicon(page as any);
};

describe("getPageFavicon", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps absolute URLs", async () => {
    expect(await faviconFor("https://a.com/x", "https://cdn.b.com/i.png")).toBe(
      "https://cdn.b.com/i.png",
    );
  });

  it("resolves protocol-relative and root-relative URLs", async () => {
    expect(await faviconFor("https://a.com/x", "//cdn.b.com/i.png")).toBe("https://cdn.b.com/i.png");
    expect(await faviconFor("https://a.com/x/y", "/i.png")).toBe("https://a.com/i.png");
  });

  it("resolves path-relative URLs against the page, not the origin root", async () => {
    expect(await faviconFor("https://a.com/docs/guide/", "favicon.ico")).toBe(
      "https://a.com/docs/guide/favicon.ico",
    );
    expect(await faviconFor("https://a.com/docs/guide", "../favicon.ico")).toBe(
      "https://a.com/favicon.ico",
    );
  });

  it("honours <base href>", async () => {
    expect(await faviconFor("https://a.com/p", "i.png", "https://a.com/static/")).toBe(
      "https://a.com/static/i.png",
    );
  });

  it("returns data: URLs unchanged", async () => {
    expect(await faviconFor("https://a.com/", "data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("returns null when there is no icon", async () => {
    expect(await faviconFor("https://a.com/", null)).toBeNull();
  });
});
