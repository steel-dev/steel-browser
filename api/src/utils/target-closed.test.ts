import { describe, expect, it } from "vitest";
import { isTargetClosedError } from "./target-closed.js";

describe("isTargetClosedError", () => {
  it("matches Puppeteer's TargetCloseError", () => {
    const error = new Error("Protocol error (Network.setExtraHTTPHeaders): Target closed");
    error.name = "TargetCloseError";
    expect(isTargetClosedError(error)).toBe(true);
  });

  it("matches a ProtocolError whose message says the target closed", () => {
    const error = new Error("Protocol error (Runtime.evaluate): Session closed");
    error.name = "ProtocolError";
    expect(isTargetClosedError(error)).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isTargetClosedError(new Error("net::ERR_PROXY_CONNECTION_FAILED"))).toBe(false);
    expect(isTargetClosedError("timeout")).toBe(false);
    expect(isTargetClosedError(null)).toBe(false);
  });
});
