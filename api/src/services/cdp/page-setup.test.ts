import { describe, expect, it, vi } from "vitest";
import { CDPService } from "./cdp.service.js";

const prototype = CDPService.prototype as unknown as {
  setUpTarget(this: unknown, target: unknown): Promise<void>;
  waitForPageSetup(this: unknown, page: unknown): Promise<void>;
  getTargetId(this: unknown, page: unknown): string;
};

function serviceState(handleNewTarget: () => Promise<void>) {
  const state = {
    pageSetups: new Map<string, Promise<void>>(),
    handleNewTarget: vi.fn(handleNewTarget),
    logger: { debug: vi.fn(), error: vi.fn() },
    getTargetId: prototype.getTargetId,
    setUpTarget: (target: unknown) => prototype.setUpTarget.call(state, target),
    waitForPageSetup: (page: unknown) => prototype.waitForPageSetup.call(state, page),
  };
  return state;
}

function targetWithPage(targetId: string) {
  const target = { _targetId: targetId };
  const page = { target: () => target };
  return { target, page };
}

describe("CDPService page setup", () => {
  it("lets a caller wait until a new page has been set up", async () => {
    let finish: () => void = () => {};
    const state = serviceState(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { target, page } = targetWithPage("page-1");

    void state.setUpTarget(target);
    let ready = false;
    const waiting = state.waitForPageSetup(page).then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    finish();
    await waiting;

    expect(ready).toBe(true);
    expect(state.pageSetups.has("page-1")).toBe(false);
  });

  it("does not wait for pages it is not setting up", async () => {
    const state = serviceState(async () => {});
    const { page } = targetWithPage("unknown");

    await expect(state.waitForPageSetup(page)).resolves.toBeUndefined();
  });

  it("settles the wait when setup fails", async () => {
    const state = serviceState(async () => {
      throw new Error("setup blew up");
    });
    const { target, page } = targetWithPage("page-2");

    void state.setUpTarget(target);

    await expect(state.waitForPageSetup(page)).resolves.toBeUndefined();
    expect(state.logger.error).toHaveBeenCalledOnce();
    expect(state.pageSetups.has("page-2")).toBe(false);
  });

  it("keeps the newer setup when a target is set up again", async () => {
    const firstSetup: { finish?: () => void } = {};
    let calls = 0;
    const state = serviceState(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<void>((resolve) => {
          firstSetup.finish = resolve;
        });
      }
      return new Promise<void>(() => {});
    });
    const { target } = targetWithPage("page-3");

    const first = state.setUpTarget(target);
    void state.setUpTarget(target);
    firstSetup.finish?.();
    await first;

    expect(state.pageSetups.has("page-3")).toBe(true);
  });
});
