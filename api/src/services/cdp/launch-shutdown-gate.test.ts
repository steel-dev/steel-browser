import type { ChildProcess } from "node:child_process";
import { expect, it, vi } from "vitest";
import { LaunchShutdownGate } from "./launch-shutdown-gate.js";
import { ConfigurationError } from "./errors/launch-errors.js";
function fixture() {
  const proc = { exitCode: null, signalCode: null, killed: true, kill: vi.fn(() => true) };
  const browser = { process: () => proc as unknown as ChildProcess, close: vi.fn(async () => {}) };
  const report = vi.fn();
  return { proc, browser, report, gate: new LaunchShutdownGate(report) };
}
it("permits ordinary launches until permanently sealed", () => {
  const { gate, browser, proc } = fixture();
  gate.assertOpen();
  expect(gate.accept(browser)).toBe(browser);
  gate.seal();
  gate.seal();
  expect(() => gate.assertOpen()).toThrow(ConfigurationError);
  expect(proc.kill).not.toHaveBeenCalled();
});
it("rejects and force-stops a browser returned after shutdown even when close is stuck", async () => {
  const { gate, browser, proc } = fixture();
  browser.close.mockImplementation(() => new Promise(() => {}));
  const launch = Promise.withResolvers<typeof browser>();
  const published = launch.promise.then((value) => gate.accept(value));
  gate.seal();
  launch.resolve(browser);
  await expect(published).rejects.toMatchObject({ isRetryable: false });
  expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  expect(browser.close).toHaveBeenCalledOnce();
});
it("rejects even when signalling and asynchronous browser close fail", async () => {
  const { gate, browser, proc, report } = fixture();
  proc.kill.mockImplementation(() => {
    throw new Error("kill denied");
  });
  browser.close.mockRejectedValue(new Error("close failed"));
  gate.seal();
  expect(() => gate.accept(browser)).toThrow("Application shutdown");
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2));
});
it("does not signal an already exited process", () => {
  const { gate, browser, proc } = fixture();
  Object.assign(proc, { exitCode: 0 });
  gate.seal();
  expect(() => gate.accept(browser)).toThrow("Application shutdown");
  expect(proc.kill).not.toHaveBeenCalled();
});

it("retires after an unconfirmed launcher failure and never starts a retry", async () => {
  const shutdown = vi.fn();
  const gate = new LaunchShutdownGate(vi.fn(), shutdown);
  const cause = new Error("DevTools endpoint timed out");
  const operation = vi.fn().mockRejectedValue(cause);
  await expect(gate.launch(operation)).rejects.toMatchObject({ isRetryable: false, cause });
  expect(shutdown).toHaveBeenCalledOnce();
  await expect(gate.launch(operation)).rejects.toMatchObject({ isRetryable: false, cause });
  expect(operation).toHaveBeenCalledOnce();
});
