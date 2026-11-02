import { describe, expect, it } from "vitest";
import { nativeDeviceScaleFactor } from "./native-display.js";

describe("native display scale", () => {
  it("preserves a restored profile's real device scale", () => {
    for (const scale of [0.5, 1, 1.25, 1.5, 2, 4]) {
      expect(
        nativeDeviceScaleFactor({ fingerprint: { screen: { devicePixelRatio: scale } } }),
      ).toBe(scale);
    }
    expect(nativeDeviceScaleFactor(null)).toBe(1);
  });

  it("rejects invalid native scales instead of launching a contradictory display", () => {
    for (const scale of [null, "1.25", 0, -1, 4.1, NaN, Infinity]) {
      expect(() =>
        nativeDeviceScaleFactor({ fingerprint: { screen: { devicePixelRatio: scale } } }),
      ).toThrow("Invalid native profile");
    }
  });
});
