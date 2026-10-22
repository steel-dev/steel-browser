import http from "node:http";
import { AddressInfo } from "node:net";
import { Server as ProxyServer } from "proxy-chain";
import { afterEach, describe, expect, it } from "vitest";
import { fetchPdf } from "../fetchPdf.js";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const running: (() => Promise<void>)[] = [];

async function startTarget(handler: Handler) {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, seen };
}

async function startProxy() {
  const tunnels: string[] = [];
  const proxy = new ProxyServer({
    port: 0,
    host: "127.0.0.1",
    prepareRequestFunction: ({ hostname, port }) => {
      tunnels.push(`${hostname}:${port}`);
      return {};
    },
  });
  await proxy.listen();
  running.push(() => proxy.close(true));
  return { url: `http://127.0.0.1:${proxy.port}`, tunnels };
}

function browserPage(
  cookies: { name: string; value: string }[] = [],
  evaluate: () => Promise<string> = async () => "PageAgent/1.0",
) {
  return {
    cookies: async () => cookies,
    evaluate,
    browser: () => ({ userAgent: async () => "BrowserAgent/1.0" }),
  } as never;
}

function respond(status: number, contentType: string, body: string | Buffer): Handler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
  };
}

const pdf = respond(200, "application/pdf", "%PDF-1.7 test");

afterEach(async () => {
  await Promise.all(running.splice(0).map((stop) => stop()));
});

describe("fetchPdf", () => {
  it("downloads through the page's proxy with its cookies and user agent", async () => {
    const target = await startTarget(pdf);
    const proxy = await startProxy();

    const result = await fetchPdf(
      browserPage([
        { name: "a", value: "1" },
        { name: "b", value: "2" },
      ]),
      `${target.origin}/paper.pdf`,
      { proxyUrl: proxy.url },
    );

    expect(result.buffer.toString()).toBe("%PDF-1.7 test");
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/pdf");
    expect(result.headers["content-type"]).toBe("application/pdf");
    expect(proxy.tunnels).toEqual([target.host]);
    expect(target.seen).toHaveLength(1);
    expect(target.seen[0]).toMatchObject({
      cookie: "a=1; b=2",
      "user-agent": "PageAgent/1.0",
      referer: `${target.origin}/`,
    });
  });

  it("goes straight to the target when the page has no proxy", async () => {
    const target = await startTarget(pdf);

    const result = await fetchPdf(browserPage(), `${target.origin}/paper.pdf`);

    expect(result.buffer.toString()).toBe("%PDF-1.7 test");
    expect(target.seen).toHaveLength(1);
    expect(target.seen[0].cookie).toBeUndefined();
  });

  it("uses the browser user agent when the page cannot report one", async () => {
    const target = await startTarget(pdf);

    await fetchPdf(
      browserPage([], async () => {
        throw new Error("Execution context was destroyed");
      }),
      `${target.origin}/paper.pdf`,
    );

    expect(target.seen[0]["user-agent"]).toBe("BrowserAgent/1.0");
  });

  it("rejects a response that is not a pdf", async () => {
    const target = await startTarget(respond(200, "text/html", "<html></html>"));

    await expect(fetchPdf(browserPage(), `${target.origin}/paper.pdf`)).rejects.toThrow(
      "Expected PDF; got status 200 content-type text/html",
    );
  });

  it("rejects an error status from the target", async () => {
    const target = await startTarget(respond(403, "application/pdf", "nope"));

    await expect(fetchPdf(browserPage(), `${target.origin}/paper.pdf`)).rejects.toThrow(
      "Expected PDF; got status 403 content-type application/pdf",
    );
  });

  it("counts a page that stalls before the download against the same deadline", async () => {
    const target = await startTarget(pdf);
    const stalledPage = {
      cookies: () => new Promise(() => {}),
      evaluate: async () => "PageAgent/1.0",
      browser: () => ({ userAgent: async () => "BrowserAgent/1.0" }),
    } as never;

    await expect(
      fetchPdf(stalledPage, `${target.origin}/paper.pdf`, { timeoutMs: 50 }),
    ).rejects.toThrow("PDF download timed out after 50 ms");
    expect(target.seen).toHaveLength(0);
  });

  it("passes on the error of a page that closed before the download", async () => {
    const target = await startTarget(pdf);
    const closedPage = {
      cookies: async () => {
        throw new Error("Protocol error (Network.getCookies): Target closed");
      },
      evaluate: async () => "PageAgent/1.0",
      browser: () => ({ userAgent: async () => "BrowserAgent/1.0" }),
    } as never;

    await expect(fetchPdf(closedPage, `${target.origin}/paper.pdf`)).rejects.toThrow(
      "Protocol error (Network.getCookies): Target closed",
    );
  });

  it("gives up on a download that takes too long", async () => {
    const target = await startTarget(() => {});

    await expect(
      fetchPdf(browserPage(), `${target.origin}/paper.pdf`, { timeoutMs: 50 }),
    ).rejects.toThrow("PDF download timed out after 50 ms");
  });

  it("refuses a pdf over the size limit", async () => {
    const target = await startTarget(
      respond(200, "application/pdf", Buffer.alloc(2 * 1024 * 1024)),
    );

    await expect(
      fetchPdf(browserPage(), `${target.origin}/paper.pdf`, { maxMegabytes: 1 }),
    ).rejects.toThrow("PDF is larger than 1 MB");
  });
});
