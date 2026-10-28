import { EventEmitter } from "node:events";
import type { CDPSession, Page } from "puppeteer-core";
import { TargetType } from "puppeteer-core";
import { describe, expect, it, vi } from "vitest";

import { BrowserEventType } from "../../../types/index.js";
import type { BrowserLogger } from "./browser-logger.js";
import { attachPageEvents } from "./page-events.js";

async function setup() {
  const page = new EventEmitter() as EventEmitter & Record<string, unknown>;
  page.target = () => ({ _targetId: "page-target" });
  page.url = () => "https://example.com/";
  const session = new EventEmitter();
  const logger = { record: vi.fn() };
  await attachPageEvents(
    page as unknown as Page,
    session as unknown as CDPSession,
    logger as unknown as BrowserLogger,
    TargetType.PAGE,
  );
  logger.record.mockClear();
  return { page, logger };
}

describe("attachPageEvents", () => {
  it("records the message and stack of a thrown Error", async () => {
    const { page, logger } = await setup();
    const error = new Error("boom");

    page.emit("pageerror", error);

    expect(logger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BrowserEventType.PageError,
        pageId: "page-target",
        targetType: TargetType.PAGE,
        error: { message: "boom", stack: error.stack },
      }),
    );
  });

  it("records a thrown value that is not an Error as a string", async () => {
    const { page, logger } = await setup();

    page.emit("pageerror", "boom");
    page.emit("pageerror", 42);

    expect(logger.record.mock.calls.map(([event]) => event.error)).toEqual([
      { message: "boom" },
      { message: "42" },
    ]);
  });
});
