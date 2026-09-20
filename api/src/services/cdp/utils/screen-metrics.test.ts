import { describe, expect, it } from "vitest";
import { resolveScreenMetrics } from "./screen-metrics.js";

const fingerprintScreen = {
  width: 1920,
  height: 1080,
  availWidth: 1920,
  availHeight: 1032,
  devicePixelRatio: 2,
};

describe("resolveScreenMetrics", () => {
  it("returns null when neither dimensions nor fingerprint screen are available", () => {
    expect(resolveScreenMetrics({})).toBeNull();
    expect(resolveScreenMetrics({ dimensions: null, fingerprintScreen: null })).toBeNull();
  });

  it("uses the fingerprint screen when no dimensions were requested", () => {
    expect(resolveScreenMetrics({ fingerprintScreen })).toEqual(fingerprintScreen);
  });

  it("uses the requested dimensions when no fingerprint was generated", () => {
    expect(resolveScreenMetrics({ dimensions: { width: 1234, height: 777 } })).toEqual({
      width: 1234,
      height: 777,
      availWidth: 1234,
      availHeight: 777,
      devicePixelRatio: 1,
    });
  });

  it("prefers the requested dimensions over a mismatched fingerprint screen", () => {
    expect(
      resolveScreenMetrics({ dimensions: { width: 1111, height: 700 }, fingerprintScreen }),
    ).toEqual({
      width: 1111,
      height: 700,
      // The available area is clamped to the screen it sits on.
      availWidth: 1111,
      availHeight: 700,
      devicePixelRatio: 2,
    });
  });

  it("keeps the fingerprint available area when it fits the requested dimensions", () => {
    expect(
      resolveScreenMetrics({ dimensions: { width: 1920, height: 1080 }, fingerprintScreen }),
    ).toEqual(fingerprintScreen);
  });

  it("falls back to a device pixel ratio of 1 when the fingerprint has none", () => {
    expect(
      resolveScreenMetrics({
        dimensions: { width: 800, height: 600 },
        fingerprintScreen: { ...fingerprintScreen, devicePixelRatio: 0 },
      }),
    ).toMatchObject({ devicePixelRatio: 1 });
  });

  it("ignores non-positive dimensions and fingerprint values", () => {
    expect(
      resolveScreenMetrics({ dimensions: { width: 0, height: 600 }, fingerprintScreen }),
    ).toEqual(fingerprintScreen);
    expect(
      resolveScreenMetrics({
        dimensions: { width: 1024, height: 768 },
        fingerprintScreen: { ...fingerprintScreen, availWidth: 0, availHeight: -1 },
      }),
    ).toEqual({
      width: 1024,
      height: 768,
      availWidth: 1024,
      availHeight: 768,
      devicePixelRatio: 2,
    });
    expect(
      resolveScreenMetrics({ fingerprintScreen: { ...fingerprintScreen, width: 0 } }),
    ).toBeNull();
  });
});
