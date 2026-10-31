import { describe, expect, it } from "vitest";
import { parseUpgradeParams } from "./browser-socket.js";

describe("parseUpgradeParams", () => {
  it("reads query params from a normal upgrade path", () => {
    expect(parseUpgradeParams("/v1/sessions/cast?pageId=abc&tabInfo=true")).toEqual({
      pageId: "abc",
      tabInfo: "true",
    });
    expect(parseUpgradeParams("")).toEqual({});
  });

  it.each(["//a b/x", "//[/x", "//%zz/", "http://[x/", "//:99999/"])(
    "returns null instead of throwing for %s",
    (url) => {
      expect(parseUpgradeParams(url)).toBeNull();
    },
  );
});
