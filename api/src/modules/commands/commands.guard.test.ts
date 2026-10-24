import type { FastifyInstance, FastifyReply } from "fastify";
import { describe, expect, test } from "vitest";
import { quickAction, quickActionsDone } from "./commands.guard.js";

function fixture() {
  const engine = { claimed: () => false, busy: () => false };
  const server = { commandEngine: engine } as unknown as FastifyInstance;
  return { engine, server, reply: {} as FastifyReply };
}

describe("quick action tracking", () => {
  test("holds commands until a quick action on the primary page finishes", async () => {
    const { engine, server, reply } = fixture();
    let finish = () => {};
    const running = quickAction(
      server,
      { body: {} },
      reply,
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    let done = false;
    const waiting = quickActionsDone(engine).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    finish();
    await running;
    await waiting;
    expect(done).toBe(true);
  });

  test("runs quick actions as before when the commands API is off", async () => {
    const server = { commandEngine: null } as unknown as FastifyInstance;
    const result = await quickAction(server, { body: {} }, {} as FastifyReply, async () => "done");
    expect(result).toBe("done");
  });

  test("does not hold commands for a quick action in its own context", async () => {
    const { engine, server, reply } = fixture();
    let finish = () => {};
    const running = quickAction(
      server,
      { body: { proxyUrl: "http://proxy.test:8080" } },
      reply,
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    await quickActionsDone(engine);
    finish();
    await running;
  });
});
