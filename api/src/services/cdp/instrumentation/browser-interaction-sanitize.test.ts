import { describe, expect, it } from "vitest";
import {
  MAX_BROWSER_INTERACTION_TEXT_LENGTH,
  sanitizeInteractionPayload,
  truncateBrowserInteractionText,
} from "./browser-interaction-sanitize.js";

describe("browser interaction sanitizer", () => {
  it("drops malformed and unknown interaction payloads", () => {
    expect(sanitizeInteractionPayload(null)).toBeNull();
    expect(sanitizeInteractionPayload({ interaction: null })).toBeNull();
    expect(
      sanitizeInteractionPayload({
        interaction: { action: "hover", eventType: "mouseover" },
      }),
    ).toBeNull();
    expect(
      sanitizeInteractionPayload({
        interaction: { action: "click", eventType: 123 },
      }),
    ).toBeNull();
  });

  it("normalizes and truncates text fields", () => {
    const longText = "x".repeat(MAX_BROWSER_INTERACTION_TEXT_LENGTH + 20);
    const interaction = sanitizeInteractionPayload({
      interaction: {
        action: "click",
        eventType: "click",
        target: {
          accessibleName: `  ${longText}\n\n`,
          text: "  primary   button  ",
        },
      },
    });

    expect(interaction?.target?.accessibleName).toHaveLength(MAX_BROWSER_INTERACTION_TEXT_LENGTH);
    expect(interaction?.target?.accessibleName?.endsWith("...")).toBe(true);
    expect(interaction?.target?.text).toBe("primary button");
  });

  it("keeps only finite numeric pointer values", () => {
    const interaction = sanitizeInteractionPayload({
      interaction: {
        action: "click",
        eventType: "click",
        pointer: {
          x: 12,
          y: Number.NaN,
          button: Number.POSITIVE_INFINITY,
          clickCount: 1,
        },
      },
    });

    expect(interaction?.pointer).toBeUndefined();
  });

  it("preserves drag pointer shape and drag end metadata", () => {
    const interaction = sanitizeInteractionPayload({
      interaction: {
        action: "drag",
        eventType: "drag",
        endTimestamp: "2026-05-22T00:00:01.000Z",
        pointer: {
          startX: 1,
          startY: 2,
          endX: 10,
          endY: 20,
          button: 0,
        },
        endTarget: { tagName: "button" },
      },
    });

    expect(interaction?.pointer).toEqual({
      startX: 1,
      startY: 2,
      endX: 10,
      endY: 20,
      button: 0,
    });
    expect(interaction?.endTimestamp).toBe("2026-05-22T00:00:01.000Z");
    expect(interaction?.endTarget?.tagName).toBe("button");
  });

  it("sanitizes value and page metadata", () => {
    const interaction = sanitizeInteractionPayload({
      interaction: {
        action: "input",
        eventType: "input",
        value: {
          inputType: "text",
          valueLength: 8,
          text: " hello ",
          redacted: false,
          checked: true,
        },
        page: {
          url: " https://example.com/form ",
          title: 123,
        },
      },
    });

    expect(interaction?.value).toEqual({
      inputType: "text",
      valueLength: 8,
      text: "hello",
      redacted: undefined,
      checked: true,
    });
    expect(interaction?.page).toEqual({
      url: "https://example.com/form",
      title: undefined,
    });
  });

  it("exposes text truncation for direct unit coverage", () => {
    expect(truncateBrowserInteractionText("  a\n b\t c  ")).toBe("a b c");
    expect(truncateBrowserInteractionText("   ")).toBeUndefined();
    expect(truncateBrowserInteractionText(1)).toBeUndefined();
  });
});
