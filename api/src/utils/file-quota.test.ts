import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { normalizeSteelBrowserFileStorage, resolveMaxTotalBytes } from "./file-quota.js";

describe("resolveMaxTotalBytes", () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns undefined when unconfigured", () => {
    expect(resolveMaxTotalBytes()).toBeUndefined();
    expect(resolveMaxTotalBytes({})).toBeUndefined();
    expect(
      resolveMaxTotalBytes({ maxTotalBytes: undefined, maxSizePerSession: undefined }),
    ).toBeUndefined();
  });

  it("returns the canonical value", () => {
    expect(resolveMaxTotalBytes({ maxTotalBytes: 100 })).toBe(100);
  });

  it("falls back to the legacy alias", () => {
    expect(resolveMaxTotalBytes({ maxSizePerSession: 100 })).toBe(100);
  });

  it("prefers the canonical key when both are set", () => {
    expect(resolveMaxTotalBytes({ maxTotalBytes: 200, maxSizePerSession: 100 })).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("prefers the canonical key even when the legacy value is invalid", () => {
    expect(resolveMaxTotalBytes({ maxTotalBytes: 200, maxSizePerSession: NaN })).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("treats 0 as a valid deny-all quota", () => {
    expect(resolveMaxTotalBytes({ maxTotalBytes: 0 })).toBe(0);
  });

  it("treats legacy 0 as a valid deny-all quota", () => {
    expect(resolveMaxTotalBytes({ maxSizePerSession: 0 })).toBe(0);
  });

  it.each([NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    "rejects canonical %p with RangeError",
    (value) => {
      expect(() => resolveMaxTotalBytes({ maxTotalBytes: value })).toThrow(RangeError);
    },
  );

  it.each([NaN, Number.NEGATIVE_INFINITY, -1])("rejects legacy %p with RangeError", (value) => {
    expect(() => resolveMaxTotalBytes({ maxSizePerSession: value })).toThrow(RangeError);
  });

  it("rejects an invalid canonical value even when the legacy alias is valid", () => {
    expect(() => resolveMaxTotalBytes({ maxTotalBytes: NaN, maxSizePerSession: 100 })).toThrow(
      RangeError,
    );
  });
});

describe("legacy deprecation warning", () => {
  it("warns exactly once across repeated legacy-only use", async () => {
    vi.resetModules();
    const fresh = await import("./file-quota.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fresh.resolveMaxTotalBytes({ maxSizePerSession: 100 });
      fresh.resolveMaxTotalBytes({ maxSizePerSession: 100 });
      fresh.normalizeSteelBrowserFileStorage({
        fileStorage: { maxSizePerSession: 100 },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("maxSizePerSession");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("normalizeSteelBrowserFileStorage", () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("maps legacy-only config to the canonical key", () => {
    expect(normalizeSteelBrowserFileStorage({ fileStorage: { maxSizePerSession: 100 } })).toEqual({
      fileStorage: { maxSizePerSession: 100, maxTotalBytes: 100 },
    });
  });

  it("keeps the canonical value when both keys are set", () => {
    expect(
      normalizeSteelBrowserFileStorage({
        fileStorage: { maxTotalBytes: 200, maxSizePerSession: 100 },
      }),
    ).toEqual({ fileStorage: { maxTotalBytes: 200, maxSizePerSession: 100 } });
  });

  it("preserves unrelated options", () => {
    expect(
      normalizeSteelBrowserFileStorage({
        fileStorage: { maxTotalBytes: 50 },
        custom: true,
      }),
    ).toEqual({ fileStorage: { maxTotalBytes: 50 }, custom: true });
  });

  it("preserves shape when unconfigured", () => {
    expect(normalizeSteelBrowserFileStorage({})).toEqual({});
    expect(normalizeSteelBrowserFileStorage({ fileStorage: {} })).toEqual({
      fileStorage: {},
    });
  });

  it("throws RangeError for invalid quota", () => {
    expect(() => normalizeSteelBrowserFileStorage({ fileStorage: { maxTotalBytes: -1 } })).toThrow(
      RangeError,
    );
  });
});
