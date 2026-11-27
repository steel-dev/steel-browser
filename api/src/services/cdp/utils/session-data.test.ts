import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CookieData, SessionData } from "../../context/types.js";
import {
  collectSessionData,
  emptyPageCounts,
  mergePageStorage,
  settleWithin,
  type PageCounts,
  type PagesStorage,
  type SessionDataSources,
} from "./session-data.js";

const logger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }) as unknown as FastifyBaseLogger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

const never = <T>() => new Promise<T>(() => {});

const cookie = { name: "sid", value: "fixture", domain: "example.com" } as CookieData;

const disk: SessionData = {
  localStorage: { "example.com": { theme: "dark", fromDisk: "1" } },
  sessionStorage: { "example.com": { step: "1" } },
};

const pageData: SessionData = {
  localStorage: { "example.com": { theme: "light" }, "other.com": { a: "1" } },
  sessionStorage: {},
  indexedDB: {},
};

const pagesRead = (counts: Partial<PageCounts> = { ok: 1 }): PagesStorage => ({
  data: pageData,
  pages: { ...emptyPageCounts(), ...counts },
});

function sources(overrides: Partial<SessionDataSources> = {}): SessionDataSources {
  return {
    cookies: async () => [cookie],
    disk: async () => disk,
    pages: async () => pagesRead(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("settleWithin", () => {
  it("returns the value when work finishes in time", async () => {
    await expect(settleWithin(async () => 42, 1_000)).resolves.toMatchObject({
      status: "ok",
      value: 42,
    });
  });

  it("reports a synchronous throw as a failure instead of rejecting", async () => {
    const outcome = await settleWithin(() => {
      throw new Error("boom");
    }, 1_000);

    expect(outcome).toMatchObject({ status: "failed", error: "boom" });
  });

  it("gives up on work that never settles", async () => {
    vi.useFakeTimers();
    const pending = settleWithin(never, 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toMatchObject({ status: "timed_out" });
  });

  it("clears its timer when work finishes first", async () => {
    vi.useFakeTimers();
    await settleWithin(async () => "done", 500);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("mergePageStorage", () => {
  it("uses the last localStorage snapshot per origin and counts each outcome", () => {
    const empty = { localStorage: {}, sessionStorage: {}, indexedDB: {} };

    const merged = mergePageStorage(
      [
        { data: { ...empty, localStorage: { "a.com": { x: "1" } } }, outcome: "ok" },
        { data: { ...empty, localStorage: { "a.com": { y: "2" } } }, outcome: "ok" },
        { data: empty, outcome: "gone" },
        { data: empty, outcome: "timed_out" },
      ],
      1,
    );

    expect(merged.data.localStorage).toEqual({ "a.com": { y: "2" } });
    expect(merged.pages).toEqual({ ok: 2, gone: 1, failed: 0, timed_out: 1, crashed: 1 });
  });
});

describe("collectSessionData", () => {
  it("merges every source, with live page storage winning over disk", async () => {
    const log = logger();

    const result = await collectSessionData(sources(), log, 1_000);

    expect(result).toEqual({
      cookies: [cookie],
      liveLocalStorageOrigins: ["example.com", "other.com"],
      localStorage: {
        "example.com": { theme: "light" },
        "other.com": { a: "1" },
      },
      sessionStorage: { "example.com": { step: "1" } },
      indexedDB: {},
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[CDPService\] Session data dumped successfully: cookies=ok/),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps disk and page storage when the cookie read hangs", async () => {
    vi.useFakeTimers();
    const log = logger();

    const pending = collectSessionData(sources({ cookies: never }), log, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result.cookies).toBeUndefined();
    expect(result.localStorage).toEqual({
      "example.com": { theme: "light" },
      "other.com": { a: "1" },
    });
    expect(result.sessionStorage).toEqual({ "example.com": { step: "1" } });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("dumped partially: cookies=timed_out("),
    );
  });

  it("keeps cookies and page storage when the disk read hangs", async () => {
    vi.useFakeTimers();
    const log = logger();

    const pending = collectSessionData(sources({ disk: never }), log, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result.cookies).toEqual([cookie]);
    expect(result.localStorage).toEqual(pageData.localStorage);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("disk=timed_out("));
  });

  it("finishes by the deadline even when every source hangs", async () => {
    vi.useFakeTimers();
    const log = logger();

    const pending = collectSessionData({ cookies: never, disk: never, pages: never }, log, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(pending).resolves.toEqual({
      localStorage: {},
      sessionStorage: {},
      indexedDB: {},
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/cookies=timed_out\(.*disk=timed_out\(.*pages=timed_out\(/),
    );
  });

  it("keeps storage when the cookie read fails because the browser is gone", async () => {
    const log = logger();

    const result = await collectSessionData(
      sources({
        cookies: async () => {
          throw new Error("Protocol error (Target.attachToTarget): No target with given id found");
        },
      }),
      log,
      1_000,
    );

    expect(result.cookies).toBeUndefined();
    expect(result.sessionStorage).toEqual({ "example.com": { step: "1" } });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("cookies=failed("));
  });

  it("reports the save as partial when a page closed before it was read", async () => {
    const log = logger();

    await collectSessionData(
      sources({ pages: async () => pagesRead({ ok: 1, gone: 1 }) }),
      log,
      1_000,
    );

    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/dumped partially: .*pages=ok\(\d+ms; ok=1 gone=1\)$/),
    );
  });

  it("reports the save as partial when a page timed out or had crashed", async () => {
    const log = logger();

    await collectSessionData(
      sources({ pages: async () => pagesRead({ timed_out: 1, crashed: 2 }) }),
      log,
      1_000,
    );

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("timed_out=1 crashed=2"));
  });

  it("counts a session with no web pages as complete", async () => {
    const log = logger();

    await collectSessionData(sources({ pages: async () => mergePageStorage([]) }), log, 1_000);

    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/pages=ok\(\d+ms\)$/));
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("never logs storage or cookie values", async () => {
    vi.useFakeTimers();
    const log = logger();

    const pending = collectSessionData(sources({ disk: never }), log, 100);
    await vi.advanceTimersByTimeAsync(100);
    await pending;

    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls]);
    expect(logged).not.toContain("fixture");
    expect(logged).not.toContain("light");
  });
});
