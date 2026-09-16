import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { Page } from "puppeteer-core";
import { extractStorageForPageWithTimeout, safePageUrl } from "./context.js";

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
