import { describe, expect, test } from "vitest";
import { DEFAULT_RECORD_LIMITS, Records } from "./records.js";

describe("Records", () => {
  test("keeps the epoch check of an after whose token was dropped while it waited", () => {
    let now = 0;
    const records = new Records(DEFAULT_RECORD_LIMITS, () => now);
    const after = records.issue();
    const execution = records.create({
      key: null,
      hash: "h",
      mutating: true,
      after,
    });
    now = 2 * 60 * 60_000;
    records.sweep();
    expect(records.valid(after)).toBe(false);
    expect(records.epochChangedSince(execution)).toBe(false);
  });
});
