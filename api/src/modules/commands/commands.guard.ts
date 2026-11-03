import type { FastifyInstance, FastifyReply } from "fastify";
import type { CommandEngine } from "../../services/commands/engine.js";

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
  sessionId?: string,
): boolean {
  const engine: CommandEngine | undefined = sessionId
    ? server.commandEngine?.get(sessionId)
    : undefined;
  if (!engine || request.body?.proxyUrl) {
    return false;
  }
  if (engine.busy()) {
    reply.code(409).send({
      message:
        "Commands are running in this session. Try again when they finish, or pass proxyUrl to work in a separate browser context.",
    });
    return true;
  }
  return false;
}

export async function quickAction(
  server: FastifyInstance,
  request: { body?: { proxyUrl?: string | null } },
  reply: FastifyReply,
  run: () => Promise<unknown>,
  sessionId?: string,
): Promise<unknown> {
  if (heldByCommands(server, request, reply, sessionId)) {
    return reply;
  }
  const engine = sessionId ? server.commandEngine?.get(sessionId) : undefined;
  if (!engine || request.body?.proxyUrl) {
    return run();
  }
  const state = quickActionsOf(engine);
  state.running++;
  try {
    return await run();
  } finally {
    engine.pageChanged();
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
