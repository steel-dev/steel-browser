import { describe, expect, test } from "vitest";
import { hideSecrets, SECRET_MASK } from "./secrets.js";

describe("hideSecrets", () => {
  test("hides a longer secret that contains a shorter one", () => {
    expect(hideSecrets("old Summer, new Summer2025!", ["Summer", "Summer2025!"])).toBe(
      `old ${SECRET_MASK}, new ${SECRET_MASK}`,
    );
  });
});
