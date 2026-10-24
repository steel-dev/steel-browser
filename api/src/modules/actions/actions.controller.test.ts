import type { FastifyReply } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CDPService } from "../../services/cdp/cdp.service.js";
import type { SessionService } from "../../services/session.service.js";
import {
  handlePDF,
  handleScrape,
  handleScreenshot,
  PAGE_LOAD_TIMEOUT_MS,
  PAGE_SETUP_TIMEOUT_MS,
  PRIMARY_PAGE_RESET_TIMEOUT_MS,
  pageLoadTimeLeft,
  resetPrimaryPage,
  waitForPageSetup,
} from "./actions.controller.js";

function fakePage() {
  return { close: vi.fn().mockResolvedValue(undefined), isClosed: () => false };
}

function pending() {
  const step: { finish: () => void; promise: Promise<void> } = {
    finish: () => {},
    promise: Promise.resolve(),
  };
  step.promise = new Promise<void>((resolve) => {
    step.finish = resolve;
  });
  return step;
}

function browserWithPrimaryPage(
  primaryPage: ReturnType<typeof fakePage>,
  createPage: () => Promise<unknown>,
) {
  const state = {
    primaryPage,
    createPage,
    pluginManager: { onBeforePageClose: vi.fn().mockResolvedValue(undefined) },
  };
  const browserService = {
    refreshPrimaryPage: (signal?: AbortSignal) =>
      CDPService.prototype.refreshPrimaryPage.call(state as never, signal),
  };
  return { state, browserService };
}

function browserWithSlowPageCreation(primaryPage: ReturnType<typeof fakePage>) {
  const creation: { finish?: (page: unknown) => void } = {};
  const { state, browserService } = browserWithPrimaryPage(
    primaryPage,
    () =>
      new Promise((resolve) => {
        creation.finish = resolve;
      }),
  );
  return { state, browserService, creation };
}

describe("resetPrimaryPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the primary page", async () => {
    const browserService = { refreshPrimaryPage: vi.fn().mockResolvedValue(undefined) };

    await resetPrimaryPage(browserService as never);

    expect(browserService.refreshPrimaryPage).toHaveBeenCalledOnce();
    expect(browserService.refreshPrimaryPage.mock.calls[0][0].aborted).toBe(false);
  });

  it("stops waiting on a refresh that never finishes and abandons it", async () => {
    vi.useFakeTimers();
    const browserService = {
      refreshPrimaryPage: vi.fn((_signal: AbortSignal) => new Promise<void>(() => {})),
    };

    const reset = resetPrimaryPage(browserService as never);
    await vi.advanceTimersByTimeAsync(PRIMARY_PAGE_RESET_TIMEOUT_MS);

    await expect(reset).resolves.toBeUndefined();
    expect(browserService.refreshPrimaryPage.mock.calls[0][0].aborted).toBe(true);
  });

  it("does not let a failed refresh replace the original error", async () => {
    const browserService = {
      refreshPrimaryPage: vi.fn().mockRejectedValue(new Error("Browser instance not initialized")),
    };

    await expect(resetPrimaryPage(browserService as never)).resolves.toBeUndefined();
  });

  it("keeps a refresh that finishes late from closing the page the next action uses", async () => {
    vi.useFakeTimers();
    const current = fakePage();
    const late = fakePage();
    const { state, browserService, creation } = browserWithSlowPageCreation(current);

    const reset = resetPrimaryPage(browserService as never);
    await vi.advanceTimersByTimeAsync(PRIMARY_PAGE_RESET_TIMEOUT_MS);
    await reset;

    creation.finish?.(late);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.primaryPage).toBe(current);
    expect(current.close).not.toHaveBeenCalled();
    expect(state.pluginManager.onBeforePageClose).not.toHaveBeenCalled();
    expect(late.close).toHaveBeenCalledOnce();
  });

  it("keeps the old page for the next action when plugin cleanup outlasts the reset", async () => {
    vi.useFakeTimers();
    const current = fakePage();
    const fresh = fakePage();
    const cleanup = pending();
    const { state, browserService } = browserWithPrimaryPage(current, async () => fresh);
    state.pluginManager.onBeforePageClose.mockImplementation(() => cleanup.promise);

    const reset = resetPrimaryPage(browserService as never);
    await vi.advanceTimersByTimeAsync(PRIMARY_PAGE_RESET_TIMEOUT_MS);
    await reset;
    const nextActionPage = state.primaryPage;

    cleanup.finish();
    await vi.advanceTimersByTimeAsync(0);

    expect(nextActionPage).toBe(current);
    expect(state.primaryPage).toBe(current);
    expect(current.close).not.toHaveBeenCalled();
    expect(fresh.close).toHaveBeenCalledOnce();
  });

  it("gives the next action the new page when closing the old one outlasts the reset", async () => {
    vi.useFakeTimers();
    const current = fakePage();
    const fresh = fakePage();
    const closing = pending();
    current.close.mockImplementation(() => closing.promise);
    const { state, browserService } = browserWithPrimaryPage(current, async () => fresh);

    const reset = resetPrimaryPage(browserService as never);
    await vi.advanceTimersByTimeAsync(PRIMARY_PAGE_RESET_TIMEOUT_MS);
    await reset;
    const nextActionPage = state.primaryPage;

    closing.finish();
    await vi.advanceTimersByTimeAsync(0);

    expect(nextActionPage).toBe(fresh);
    expect(state.primaryPage).toBe(fresh);
    expect(fresh.close).not.toHaveBeenCalled();
  });
});

describe("waitForPageSetup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the page to finish its setup", async () => {
    let finish: () => void = () => {};
    const browserService = {
      waitForPageSetup: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const page = {};
    let ready = false;

    const waiting = waitForPageSetup(browserService as never, page as never).then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    finish();
    await waiting;

    expect(ready).toBe(true);
    expect(browserService.waitForPageSetup).toHaveBeenCalledWith(page);
  });

  it("stops waiting on a setup that never finishes", async () => {
    vi.useFakeTimers();
    const browserService = { waitForPageSetup: vi.fn(() => new Promise<void>(() => {})) };

    const waiting = waitForPageSetup(browserService as never, {} as never);
    await vi.advanceTimersByTimeAsync(PAGE_SETUP_TIMEOUT_MS);

    await expect(waiting).resolves.toBeUndefined();
  });
});

describe("pageLoadTimeLeft", () => {
  it("leaves the PDF download whatever the navigation did not use", () => {
    expect(pageLoadTimeLeft(1_200)).toBe(PAGE_LOAD_TIMEOUT_MS - 1_200);
  });

  it("never hands out a non-positive timeout", () => {
    expect(pageLoadTimeLeft(PAGE_LOAD_TIMEOUT_MS)).toBe(1);
    expect(pageLoadTimeLeft(PAGE_LOAD_TIMEOUT_MS + 5_000)).toBe(1);
  });
});

function fixture() {
  const browserService = {
    isRunning: () => true,
    getPrimaryPage: vi.fn().mockRejectedValue(new Error("Primary page failed")),
    refreshPrimaryPage: vi.fn().mockResolvedValue(undefined),
  };
  const proxy = {
    listen: vi.fn().mockRejectedValue(new Error("Proxy failed")),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const sessionService = { proxyFactory: vi.fn().mockResolvedValue(proxy) };
  const reply = { code: vi.fn(), send: vi.fn() };
  reply.code.mockReturnValue(reply);
  return {
    browserService: browserService as unknown as CDPService,
    refresh: browserService.refreshPrimaryPage,
    sessionService: sessionService as unknown as SessionService,
    reply: reply as unknown as FastifyReply,
    status: reply.code,
  };
}

const handlers = [
  ["scrape", handleScrape],
  ["screenshot", handleScreenshot],
  ["pdf", handlePDF],
] as const;

describe("quick action failures", () => {
  it.each(handlers)("%s keeps the primary page when it ran with a proxy", async (_, handle) => {
    const { browserService, refresh, sessionService, reply, status } = fixture();
    const request = { body: { url: "https://example.com", proxyUrl: "http://proxy.test:8080" } };

    await handle(sessionService, browserService, request as never, reply);

    expect(status).toHaveBeenCalledWith(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(handlers)("%s replaces the primary page that failed", async (_, handle) => {
    const { browserService, refresh, sessionService, reply, status } = fixture();
    const request = { body: { url: "https://example.com" } };

    await handle(sessionService, browserService, request as never, reply);

    expect(status).toHaveBeenCalledWith(500);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
