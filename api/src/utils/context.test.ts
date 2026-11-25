import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { Page } from "puppeteer-core";
import {
  extractStorageForPage,
  extractStorageForPageWithTimeout,
  groupSessionStorageByOrigin,
  safePageUrl,
} from "./context.js";

const logger = () =>
  ({
    warn: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }) as unknown as FastifyBaseLogger;

// A crashed renderer: CDP commands are accepted but never answered.
const unresponsivePage = (url = "https://example.com/report") =>
  ({
    url: () => url,
    target: () => ({
      createCDPSession: async () => ({
        send: () => new Promise(() => {}),
        detach: async () => {},
      }),
    }),
  }) as unknown as Page;

describe("extractStorageForPageWithTimeout", () => {
  it("gives up on an unresponsive renderer instead of hanging", async () => {
    const log = logger();

    const result = await extractStorageForPageWithTimeout(unresponsivePage(), log, 50);

    expect(result).toEqual({ localStorage: {}, sessionStorage: {}, indexedDB: {} });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("timed out"));
  });

  it("does not reject, so one bad page cannot fail a release", async () => {
    const exploding = {
      url: () => "https://example.com",
      target: () => {
        throw new Error("gone");
      },
    } as unknown as Page;

    await expect(extractStorageForPageWithTimeout(exploding, logger(), 50)).resolves.toBeDefined();
  });

  it("clears its timer once extraction resolves", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const page = {
      url: () => "https://example.com",
      target: () => ({
        createCDPSession: async () => ({
          send: async () => ({ frameTree: null }),
          detach: async () => {},
        }),
      }),
    } as unknown as Page;

    await extractStorageForPageWithTimeout(page, logger(), 5_000);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("safePageUrl", () => {
  it("returns the url when available", () => {
    expect(safePageUrl({ url: () => "https://example.com" } as unknown as Page)).toBe(
      "https://example.com",
    );
  });

  it("falls back when the target is gone", () => {
    expect(
      safePageUrl({
        url: () => {
          throw new Error("detached");
        },
      } as unknown as Page),
    ).toBe("unknown");
  });
});

// A page whose renderer answers with one localStorage and one sessionStorage item.
const pageWithStorage = (url: string) =>
  ({
    url: () => url,
    target: () => ({
      createCDPSession: async () => ({
        send: async (method: string, params?: any) => {
          if (method === "Page.getFrameTree") return { frameTree: {} };
          if (method === "DOMStorage.getDOMStorageItems") {
            return params.storageId.isLocalStorage
              ? { entries: [["token", "abc"]] }
              : { entries: [["tab", "1"]] };
          }
          if (method === "IndexedDB.requestDatabaseNames") return { databaseNames: [] };
          return {};
        },
        detach: async () => {},
      }),
    }),
  }) as unknown as Page;

describe("storage round trip", () => {
  it("keys storage from a page so the restore path finds it by origin", async () => {
    const extracted = await extractStorageForPage(
      pageWithStorage("https://example.com/account"),
      logger(),
    );

    const restored = groupSessionStorageByOrigin(extracted).get("https://example.com");

    expect(restored?.localStorage).toEqual({ token: "abc" });
    expect(restored?.sessionStorage).toEqual({ tab: "1" });
  });

  it("keeps the port in the key", async () => {
    const extracted = await extractStorageForPage(
      pageWithStorage("http://localhost:8080/"),
      logger(),
    );

    expect(Object.keys(extracted.localStorage!)).toEqual(["http://localhost:8080"]);
  });

  it("restores contexts saved under a bare hostname by older versions", () => {
    const byOrigin = groupSessionStorageByOrigin({
      localStorage: { "example.com": { token: "abc" } },
      indexedDB: { "example.com": [{ id: 0, name: "db", data: [] }] },
    });

    expect(byOrigin.get("https://example.com")?.localStorage).toEqual({ token: "abc" });
    expect(byOrigin.get("http://example.com")?.localStorage).toEqual({ token: "abc" });
    expect(byOrigin.get("https://example.com")?.indexedDB).toHaveLength(1);
  });

  it("prefers an origin key over a legacy hostname key for the same site", () => {
    const byOrigin = groupSessionStorageByOrigin({
      localStorage: {
        "https://example.com": { token: "new" },
        "example.com": { token: "old" },
      },
    });

    expect(byOrigin.get("https://example.com")?.localStorage).toEqual({ token: "new" });
    expect(byOrigin.get("http://example.com")?.localStorage).toEqual({ token: "old" });
  });
});
