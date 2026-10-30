import { describe, expect, test } from "vitest";
import { publicHost } from "./url.js";

describe("publicHost", () => {
  test("maps unspecified bind addresses to localhost", () => {
    expect(publicHost("0.0.0.0")).toBe("localhost");
    expect(publicHost("::")).toBe("localhost");
    expect(publicHost("[::]")).toBe("localhost");
  });

  test("keeps concrete hosts", () => {
    expect(publicHost("127.0.0.1")).toBe("127.0.0.1");
    expect(publicHost("steel.internal")).toBe("steel.internal");
  });
});
