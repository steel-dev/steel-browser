import { describe, expect, test } from "vitest";
import {
  formatSecChUa,
  generateBrandVersionList,
  getGreasedBrandVersion,
  getUserAgentBrandLists,
} from "./user-agent-brands.js";

/**
 * Sec-CH-UA of real Google Chrome releases. 135-146 are samples of the
 * header-generator 2.1.82 dataset whose `navigator.userAgentData.brands` and
 * `Sec-CH-UA` header agree with each other and with the UA major (the
 * dataset also holds mixed-up samples, which is why it cannot be trusted as
 * is); 120, 124, 131 and 139 are widely observed values of those releases.
 */
const REAL_CHROME_SEC_CH_UA: Record<number, string> = {
  120: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  124: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  131: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  135: '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
  138: '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  139: '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
  140: '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  142: '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  143: '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  144: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
  145: '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  146: '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
};

describe("Chromium UA-CH brand list port", () => {
  test.each(Object.entries(REAL_CHROME_SEC_CH_UA))(
    "matches real Google Chrome %s",
    (major, secChUa) => {
      const { brands } = getUserAgentBrandLists(`${major}.0.1234.56`);
      expect(formatSecChUa(brands)).toBe(secChUa);
    },
  );

  test("matches Debian Chromium 156, a Chromium-branded build (native, see native test)", () => {
    expect(getUserAgentBrandLists("156.0.8078.108", null)).toEqual({
      brands: [
        { brand: "Not:A-Brand", version: "8" },
        { brand: "Chromium", version: "156" },
      ],
      fullVersionList: [
        { brand: "Not:A-Brand", version: "8.0.0.0" },
        { brand: "Chromium", version: "156.0.8078.108" },
      ],
    });
  });

  test("puts the full version in fullVersionList in the same order as brands", () => {
    const { brands, fullVersionList } = getUserAgentBrandLists("156.0.8078.108");
    expect(brands).toEqual([
      { brand: "Not:A-Brand", version: "8" },
      { brand: "Chromium", version: "156" },
      { brand: "Google Chrome", version: "156" },
    ]);
    expect(fullVersionList).toEqual([
      { brand: "Not:A-Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: "156.0.8078.108" },
      { brand: "Google Chrome", version: "156.0.8078.108" },
    ]);
  });

  test("places brand i at position order[i] (ShuffleBrandList), not list[order[i]]", () => {
    // Seed 124 picks order {2, 0, 1}: GREASE goes last, Chromium first.
    expect(
      generateBrandVersionList({
        seed: 124,
        brand: "Google Chrome",
        version: "124",
        fullVersion: false,
      }).map(({ brand }) => brand),
    ).toEqual(["Chromium", "Google Chrome", "Not-A.Brand"]);
  });

  test("shuffles a fourth, additional brand with the 24-permutation table", () => {
    expect(
      generateBrandVersionList({
        seed: 5,
        brand: "Google Chrome",
        version: "5",
        fullVersion: false,
        additionalBrand: { brand: "Extra", version: "1" },
      }).map(({ brand }) => brand),
    ).toEqual(["Not/A)Brand", "Extra", "Google Chrome", "Chromium"]);
  });

  test("uses the GREASE characters and versions of the spec algorithm", () => {
    expect(getGreasedBrandVersion(0, false)).toEqual({ brand: "Not A(Brand", version: "8" });
    expect(getGreasedBrandVersion(10, true)).toEqual({ brand: "Not_A Brand", version: "99.0.0.0" });
  });

  test("rejects versions Chromium cannot produce", () => {
    expect(() => getUserAgentBrandLists("beta")).toThrow(/Invalid Chrome version/);
    expect(() =>
      generateBrandVersionList({ seed: -1, brand: null, version: "1", fullVersion: false }),
    ).toThrow(/Invalid brand seed/);
  });
});
