import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIMARY_PAGE_RESET_TIMEOUT_MS, resetPrimaryPage } from "./actions.controller.js";

describe("resetPrimaryPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the primary page", async () => {
    const browserService = { refreshPrimaryPage: vi.fn().mockResolvedValue(undefined) };

    await resetPrimaryPage(browserService as never);

    expect(browserService.refreshPrimaryPage).toHaveBeenCalledOnce();
  });

  it("stops waiting on a refresh that never finishes", async () => {
    vi.useFakeTimers();
    const browserService = { refreshPrimaryPage: vi.fn(() => new Promise<void>(() => {})) };

    const reset = resetPrimaryPage(browserService as never);
    await vi.advanceTimersByTimeAsync(PRIMARY_PAGE_RESET_TIMEOUT_MS);

    await expect(reset).resolves.toBeUndefined();
  });

  it("does not let a failed refresh replace the original error", async () => {
    const browserService = {
      refreshPrimaryPage: vi.fn().mockRejectedValue(new Error("Browser instance not initialized")),
    };

    await expect(resetPrimaryPage(browserService as never)).resolves.toBeUndefined();
  });
});
