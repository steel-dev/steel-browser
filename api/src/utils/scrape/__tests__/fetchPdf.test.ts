import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPdf } from "../fetchPdf.js";

function pageWithCookies(cookies: { name: string; value: string }[] = []) {
  return { cookies: vi.fn().mockResolvedValue(cookies) } as never;
}

function stubFetch(body: string, contentType: string, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(body, { status, headers: { "content-type": contentType } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchPdf", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the pdf with the page's cookies and a bounded wait", async () => {
    const fetchMock = stubFetch("%PDF-1.7", "application/pdf");

    const result = await fetchPdf(
      pageWithCookies([
        { name: "a", value: "1" },
        { name: "b", value: "2" },
      ]),
      "https://arxiv.org/pdf/2603.05923",
    );

    expect(result.buffer.toString()).toBe("%PDF-1.7");
    expect(result.contentType).toBe("application/pdf");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://arxiv.org/pdf/2603.05923");
    expect(init.headers).toEqual({ Referer: "https://arxiv.org/", Cookie: "a=1; b=2" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no cookie header when the page has none", async () => {
    const fetchMock = stubFetch("%PDF-1.7", "application/pdf; charset=binary");

    await fetchPdf(pageWithCookies(), "https://example.com/report.pdf");

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Referer: "https://example.com/" });
  });

  it("rejects a response that is not a pdf", async () => {
    stubFetch("<html></html>", "text/html");

    await expect(fetchPdf(pageWithCookies(), "https://example.com/report.pdf")).rejects.toThrow(
      "Expected PDF; got status 200 content-type text/html",
    );
  });

  it("rejects a failed download", async () => {
    stubFetch("nope", "application/pdf", 403);

    await expect(fetchPdf(pageWithCookies(), "https://example.com/report.pdf")).rejects.toThrow(
      "Expected PDF; got status 403 content-type application/pdf",
    );
  });
});
