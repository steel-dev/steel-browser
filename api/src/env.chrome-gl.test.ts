import { describe, expect, test } from "vitest";
import { envSchema } from "./env.js";

describe("chrome GL env", () => {
  test("defaults to software GL when the variables are unset or blank", () => {
    const parsed = envSchema.parse({});
    expect(parsed.CHROME_USE_GL).toBeUndefined();
    expect(parsed.CHROME_DISABLE_GPU).toBe(true);

    const blank = envSchema.parse({ CHROME_USE_GL: "", CHROME_DISABLE_GPU: "" });
    expect(blank.CHROME_USE_GL).toBeUndefined();
    expect(blank.CHROME_DISABLE_GPU).toBe(true);
  });

  test("reads a self-hosted hardware GL override", () => {
    const parsed = envSchema.parse({
      CHROME_USE_GL: "angle",
      CHROME_DISABLE_GPU: "false",
    });
    expect(parsed.CHROME_USE_GL).toBe("angle");
    expect(parsed.CHROME_DISABLE_GPU).toBe(false);
  });

  test("rejects a CHROME_USE_GL value that is not a single flag name", () => {
    expect(() => envSchema.parse({ CHROME_USE_GL: "angle --no-sandbox" })).toThrow(/CHROME_USE_GL/);
  });
});
