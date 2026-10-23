import type { FastifyInstance, FastifyReply } from "fastify";

interface QuickActions {
  running: number;
  idle: Array<() => void>;
}

const tracked = new WeakMap<object, QuickActions>();

function quickActionsOf(engine: object): QuickActions {
  let state = tracked.get(engine);
  if (!state) {
    state = { running: 0, idle: [] };
    tracked.set(engine, state);
  }
  return state;
}

export function heldByCommands(
  server: FastifyInstance,
  request: { body?: { proxyUrl?: string | null } },
  reply: FastifyReply,
): boolean {
  if (!server.commandEngine?.claimed() || request.body?.proxyUrl) {
    return false;
  }
  reply.code(409).send({
    message:
      "This session is driven through /v1/sessions/:sessionId/commands, which owns its tabs. Use the commands API, or pass proxyUrl to work in a separate browser context.",
  });
  return true;
}

export async function quickAction(
  server: FastifyInstance,
  request: { body?: { proxyUrl?: string | null } },
  reply: FastifyReply,
  run: () => Promise<unknown>,
): Promise<unknown> {
  if (heldByCommands(server, request, reply)) {
    return reply;
  }
  if (!server.commandEngine || request.body?.proxyUrl) {
    return run();
  }
  const state = quickActionsOf(server.commandEngine);
  state.running++;
  try {
    return await run();
  } finally {
    state.running--;
    if (state.running === 0) {
      for (const resolve of state.idle.splice(0)) {
        resolve();
      }
    }
  }
}

export function quickActionsDone(engine: object): Promise<void> {
  const state = quickActionsOf(engine);
  return state.running === 0
    ? Promise.resolve()
    : new Promise((resolve) => state.idle.push(resolve));
}
