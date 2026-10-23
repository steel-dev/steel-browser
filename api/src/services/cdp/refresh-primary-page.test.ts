import { describe, expect, it, vi } from "vitest";
import { CDPService } from "./cdp.service.js";

function fakePage(closed = false) {
  return { close: vi.fn().mockResolvedValue(undefined), isClosed: () => closed };
}

function serviceState(primaryPage: unknown, createPage: () => Promise<unknown>) {
  return {
    primaryPage,
    createPage: vi.fn(createPage),
    pluginManager: { onBeforePageClose: vi.fn().mockResolvedValue(undefined) },
  };
}

const refreshPrimaryPage = CDPService.prototype.refreshPrimaryPage;

describe("CDPService.refreshPrimaryPage", () => {
  it("swaps in a new primary page and closes the old one", async () => {
    const previous = fakePage();
    const fresh = fakePage();
    const state = serviceState(previous, async () => fresh);

    await refreshPrimaryPage.call(state as never);

    expect(state.primaryPage).toBe(fresh);
    expect(state.pluginManager.onBeforePageClose).toHaveBeenCalledWith(previous);
    expect(previous.close).toHaveBeenCalledOnce();
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it("does not close a primary page that is already closed", async () => {
    const previous = fakePage(true);
    const fresh = fakePage();
    const state = serviceState(previous, async () => fresh);

    await refreshPrimaryPage.call(state as never);

    expect(state.primaryPage).toBe(fresh);
    expect(state.pluginManager.onBeforePageClose).not.toHaveBeenCalled();
    expect(previous.close).not.toHaveBeenCalled();
  });

  it("sets the first primary page when there is none", async () => {
    const fresh = fakePage();
    const state = serviceState(null, async () => fresh);

    await refreshPrimaryPage.call(state as never);

    expect(state.primaryPage).toBe(fresh);
    expect(state.pluginManager.onBeforePageClose).not.toHaveBeenCalled();
  });

  it("leaves the primary page alone once the refresh was abandoned", async () => {
    const previous = fakePage();
    const fresh = fakePage();
    const abandon = new AbortController();
    const state = serviceState(previous, async () => {
      abandon.abort();
      return fresh;
    });

    await refreshPrimaryPage.call(state as never, abandon.signal);

    expect(state.primaryPage).toBe(previous);
    expect(previous.close).not.toHaveBeenCalled();
    expect(state.pluginManager.onBeforePageClose).not.toHaveBeenCalled();
    expect(fresh.close).toHaveBeenCalledOnce();
  });

  it("leaves the primary page alone when abandoned while plugins let go of it", async () => {
    const previous = fakePage();
    const fresh = fakePage();
    const abandon = new AbortController();
    const state = serviceState(previous, async () => fresh);
    state.pluginManager.onBeforePageClose.mockImplementation(async () => {
      abandon.abort();
    });

    await refreshPrimaryPage.call(state as never, abandon.signal);

    expect(state.primaryPage).toBe(previous);
    expect(previous.close).not.toHaveBeenCalled();
    expect(fresh.close).toHaveBeenCalledOnce();
  });

  it("hands out the new page before the old one starts closing", async () => {
    const previous = fakePage();
    const fresh = fakePage();
    const abandon = new AbortController();
    const state = serviceState(previous, async () => fresh);
    let primaryWhileClosing: unknown;
    previous.close.mockImplementation(async () => {
      primaryWhileClosing = state.primaryPage;
      abandon.abort();
    });

    await refreshPrimaryPage.call(state as never, abandon.signal);

    expect(primaryWhileClosing).toBe(fresh);
    expect(state.primaryPage).toBe(fresh);
    expect(previous.close).toHaveBeenCalledOnce();
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it("keeps a primary page that was replaced while the new one was created", async () => {
    const previous = fakePage();
    const replacement = fakePage();
    const fresh = fakePage();
    const state = serviceState(previous, async () => {
      state.primaryPage = replacement;
      return fresh;
    });

    await refreshPrimaryPage.call(state as never);

    expect(state.primaryPage).toBe(replacement);
    expect(previous.close).not.toHaveBeenCalled();
    expect(replacement.close).not.toHaveBeenCalled();
    expect(fresh.close).toHaveBeenCalledOnce();
  });
});
