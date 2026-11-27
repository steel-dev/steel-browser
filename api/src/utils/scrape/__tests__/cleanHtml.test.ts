import { describe, expect, it } from "vitest";
import { cleanHtml } from "../cleanHtml.js";

describe("cleanHtml", () => {
  it("returns an empty string for an empty document", async () => {
    await expect(cleanHtml("")).resolves.toBe("");
  });

  it("keeps an element that has text", async () => {
    await expect(cleanHtml('<p style="color: red">hello</p>')).resolves.toBe(
      "<html><body><p>hello</p></body></html>",
    );
  });
});
