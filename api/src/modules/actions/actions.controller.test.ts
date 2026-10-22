import { afterEach, describe, expect, it, vi } from "vitest";
import { CDPService } from "../../services/cdp/cdp.service.js";
import {
  PAGE_LOAD_TIMEOUT_MS,
  PAGE_SETUP_TIMEOUT_MS,
  PRIMARY_PAGE_RESET_TIMEOUT_MS,
  pageLoadTimeLeft,
  resetPrimaryPage,
  waitForPageSetup,
} from "./actions.controller.js";

function fakePage() {
  return { close: vi.fn().mockResolvedValue(undefined) };
}

function browserWithSlowPageCreation(primaryPage: ReturnType<typeof fakePage>) {
  const creation: { finish?: (page: unknown) => void } = {};
  const state = {
    primaryPage,
    createPage: () =>
      new Promise((resolve) => {
        creation.finish = resolve;
      }),
    pluginManager: { onBeforePageClose: vi.fn().mockResolvedValue(undefined) },
  };
  const browserService = {
    refreshPrimaryPage: (signal?: AbortSignal) =>
      CDPService.prototype.refreshPrimaryPage.call(state as never, signal),
  };
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
