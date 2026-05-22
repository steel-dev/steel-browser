import { EventEmitter } from "events";
import { TargetType } from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { BrowserEventType } from "../../../types/enums.js";
import type { BrowserLogger } from "./browser-logger.js";
import { attachCDPEvents } from "./cdp-events.js";
import {
  attachBrowserInteractionEvents,
  BROWSER_INTERACTION_BINDING,
  BROWSER_INTERACTION_WORLD,
} from "./browser-interaction-events.js";
import { BROWSER_INTERACTION_SOURCE } from "./browser-interaction-sanitize.js";
import type { BrowserEventUnion } from "./types.js";

class FakeSession extends EventEmitter {
  calls: Array<{ method: string; params?: any }> = [];
  failRunImmediately = false;

  id() {
    return "fake-session";
  }

  async send(method: string, params?: any) {
    this.calls.push({ method, params });
    if (
      this.failRunImmediately &&
      method === "Page.addScriptToEvaluateOnNewDocument" &&
      params?.runImmediately === true
    ) {
      throw new Error("runImmediately not supported");
    }
    return {};
  }
}

class FakePage extends EventEmitter {
  currentUrl = "about:blank";

  url() {
    return this.currentUrl;
  }
}

function createLogger() {
  const records: BrowserEventUnion[] = [];
  const logger: BrowserLogger = {
    record: (event) => records.push(event),
    resetContext: () => {},
    setContext: () => {},
    getContext: () => ({}),
  };
  return { logger, records };
}

describe("browser interaction CDP attachment", () => {
  it("adds the runtime binding and page script", async () => {
    const session = new FakeSession();
    const page = new FakePage();
    const { logger } = createLogger();

    await attachBrowserInteractionEvents(
      session as any,
      page as any,
      logger,
      TargetType.PAGE,
      "page-1",
    );

    expect(session.calls[0]).toEqual({
      method: "Runtime.addBinding",
      params: {
        name: BROWSER_INTERACTION_BINDING,
        executionContextName: BROWSER_INTERACTION_WORLD,
      },
    });
    expect(session.calls[1]).toMatchObject({
      method: "Page.addScriptToEvaluateOnNewDocument",
      params: {
        worldName: BROWSER_INTERACTION_WORLD,
        runImmediately: true,
      },
    });
    expect(session.calls[1].params.source).toContain(BROWSER_INTERACTION_BINDING);
  });

  it("falls back when runImmediately is not supported", async () => {
    const session = new FakeSession();
    session.failRunImmediately = true;
    const page = new FakePage();
    const { logger } = createLogger();

    await attachBrowserInteractionEvents(
      session as any,
      page as any,
      logger,
      TargetType.PAGE,
      "page-1",
    );

    expect(session.calls).toEqual([
      expect.objectContaining({ method: "Runtime.addBinding" }),
      expect.objectContaining({
        method: "Page.addScriptToEvaluateOnNewDocument",
        params: expect.objectContaining({ runImmediately: true }),
      }),
      expect.objectContaining({
        method: "Page.addScriptToEvaluateOnNewDocument",
        params: expect.not.objectContaining({ runImmediately: true }),
      }),
    ]);
  });

  it("passes interaction value logging opt-in to the injected script", async () => {
    const session = new FakeSession();
    const page = new FakePage();
    const { logger } = createLogger();

    await attachBrowserInteractionEvents(
      session as any,
      page as any,
      logger,
      TargetType.PAGE,
      "page-1",
      { dangerouslyLogInteractionValues: true },
    );

    expect(session.calls[1]).toMatchObject({
      method: "Page.addScriptToEvaluateOnNewDocument",
      params: expect.objectContaining({
        source: expect.stringContaining('"logTextValues":true'),
      }),
    });
  });

  it("records sanitized binding payloads as browser interactions", async () => {
    const session = new FakeSession();
    const page = new FakePage();
    const { logger, records } = createLogger();

    await attachBrowserInteractionEvents(
      session as any,
      page as any,
      logger,
      TargetType.PAGE,
      "page-1",
    );
    records.length = 0;

    session.emit("Runtime.bindingCalled", {
      name: BROWSER_INTERACTION_BINDING,
      payload: JSON.stringify({
        source: BROWSER_INTERACTION_SOURCE,
        timestamp: "2026-05-22T00:00:00.000Z",
        interaction: {
          action: "click",
          eventType: "click",
          pointer: { x: 1, y: 2, button: 0, clickCount: 1 },
          page: { url: "https://example.com" },
        },
      }),
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: BrowserEventType.BrowserInteraction,
      timestamp: "2026-05-22T00:00:00.000Z",
      pageId: "page-1",
      interaction: {
        action: "click",
        pointer: { x: 1, y: 2, button: 0, clickCount: 1 },
        page: { url: "https://example.com" },
      },
    });
  });

  it("records only main-frame navigation interactions", async () => {
    const session = new FakeSession();
    const page = new FakePage();
    page.currentUrl = "https://initial.example";
    const { logger, records } = createLogger();

    await attachBrowserInteractionEvents(
      session as any,
      page as any,
      logger,
      TargetType.PAGE,
      "page-1",
    );
    records.length = 0;

    page.emit("framenavigated", {
      parentFrame: () => ({}),
      url: () => "https://iframe.example",
    });
    page.emit("framenavigated", {
      parentFrame: () => null,
      url: () => "https://main.example",
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: BrowserEventType.BrowserInteraction,
      interaction: {
        action: "navigate",
        navigation: { url: "https://main.example" },
      },
    });
  });

  it("does not duplicate browser interaction binding calls as raw CDP events", () => {
    const session = new FakeSession();
    const { logger, records } = createLogger();

    attachCDPEvents(session as any, logger);
    session.emit("event", {
      method: "Runtime.bindingCalled",
      params: { name: BROWSER_INTERACTION_BINDING },
    });
    session.emit("event", {
      method: "Runtime.bindingCalled",
      params: { name: "otherBinding" },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: BrowserEventType.CDPEvent,
      cdp: { name: "Runtime.bindingCalled", params: { name: "otherBinding" } },
    });
  });
});
