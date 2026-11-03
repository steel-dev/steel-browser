import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { COMMANDS_API_VERSION, requestJsonSchema } from "../../services/commands/commands.js";
import { SessionCommandEngineRegistry } from "../../services/commands/session-engine-registry.js";
import { $ref } from "../../plugins/schemas.js";
import { quickActionsDone } from "./commands.guard.js";

export function createCommandEngine(server: FastifyInstance): SessionCommandEngineRegistry {
  const engines = new SessionCommandEngineRegistry(server);
  server.sessionService.addSessionStartHook(engines.registerSession);
  server.sessionService.addSessionEndHook((sessionId) => engines.release(sessionId));
  return engines;
}

async function routes(server: FastifyInstance) {
  if (!server.commandEngine) {
    return;
  }
  const schema = requestJsonSchema();

  server.get(
    "/sessions/:sessionId/commands/schema",
    {
      schema: {
        operationId: "get_commands_schema",
        summary: "Get the commands request schema",
        description:
          "Returns the JSON Schema of the request body for running commands, so clients can generate types from it.",
        tags: ["Commands"],
        response: {
          200: $ref("CommandsSchemaResponse"),
        },
      },
      serializerCompiler: () => (data) => JSON.stringify(data),
    },
    async () => ({
      version: COMMANDS_API_VERSION,
      schema,
    }),
  );

  server.post(
    "/sessions/:sessionId/commands",
    {
      schema: {
        operationId: "run_commands",
        summary: "Run commands",
        description:
          "Drives the session's browser with high-level commands such as snapshot, click, and fill. Commands run in order and stop at the first failure. Send a random Idempotency-Key header to make retries safe.",
        tags: ["Commands"],
        headers: {
          type: "object",
          properties: {
            "idempotency-key": {
              type: "string",
              description: "A random value. A retry with the same key returns the stored result.",
            },
          },
        },
        body: $ref("CommandRequest"),
        response: {
          200: {
            description: "The execution, or the answered dialog for the dialog command.",
            anyOf: [$ref("CommandResponse"), $ref("CommandDialogResponse")],
          },
          400: $ref("CommandRequestError"),
          410: $ref("CommandRequestError"),
          422: $ref("CommandRequestError"),
          429: $ref("CommandRequestError"),
        },
      },
      validatorCompiler: () => (value) => ({ value }),
      serializerCompiler: () => (data) => JSON.stringify(data),
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const engine = server.commandEngine?.get(request.params.sessionId);
      if (!engine) {
        return reply.code(404).send({
          error: "session_not_found",
          message: `Session ${request.params.sessionId} is not active.`,
        });
      }
      const key = request.headers["idempotency-key"];
      const response = await engine.handle({
        sessionId: request.params.sessionId,
        idempotencyKey: Array.isArray(key) ? key[0] : key,
        body: request.body,
      });
      return reply.code(response.status).headers(response.headers).send(response.body);
    },
  );
}

export default routes;
