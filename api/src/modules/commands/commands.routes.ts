import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { COMMANDS_API_VERSION, requestJsonSchema } from "../../services/commands/commands.js";
import { CommandEngine, type EngineResponse } from "../../services/commands/engine.js";
import { CommandsPlugin } from "../../services/commands/plugin.js";
import { FileService } from "../../services/file.service.js";
import { $ref } from "../../plugins/schemas.js";
import { quickActionsDone } from "./commands.guard.js";

export function createCommandEngine(server: FastifyInstance): CommandEngine {
  const engine: CommandEngine = new CommandEngine({
    browser: () => server.cdpService.getBrowserInstance(),
    waitForPageSetup: (page) => server.cdpService.waitForPageSetup(page),
    endSession: async (id) => {
      const session = server.sessionService.activeSession;
      if (session.id === id && session.status === "live") {
        await server.sessionService.endSession();
      }
    },
    filesRoot: () => FileService.getInstance().getBaseFilesPath(),
    released: (id) => {
      const session = server.sessionService.activeSession;
      return session.id !== id || session.status !== "live";
    },
    quickActionsDone: () => quickActionsDone(engine),
  });
  server.cdpService.registerPlugin(
    new CommandsPlugin(engine, { id: () => server.sessionService.activeSession.id }),
  );
  return engine;
}

function send(reply: FastifyReply, response: EngineResponse) {
  return reply.code(response.status).headers(response.headers).send(response.body);
}

const failures = {
  400: $ref("CommandRequestError"),
  410: $ref("CommandRequestError"),
  422: $ref("CommandRequestError"),
  500: $ref("CommandRequestError"),
};

function parseJson(
  _request: FastifyRequest,
  body: string,
  done: (error: Error | null, body?: unknown) => void,
) {
  if (body === "") {
    done(null, undefined);
    return;
  }
  try {
    done(null, JSON.parse(body));
  } catch (error) {
    done(Object.assign(error as Error, { statusCode: 400 }), undefined);
  }
}

async function routes(server: FastifyInstance) {
  const engine = server.commandEngine;
  if (!engine) {
    return;
  }
  server.setErrorHandler<FastifyError>(async (error, _request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      return reply
        .code(500)
        .headers({ "x-should-retry": "false" })
        .send({ error: { code: "internal_error", message: error.message } });
    }
    return reply.code(status).send({ error: { code: "invalid_request", message: error.message } });
  });
  server.removeContentTypeParser("application/json");
  server.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) =>
    parseJson(request, body as string, done),
  );
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
          200: $ref("CommandResponse"),
          ...failures,
          429: $ref("CommandRequestError"),
        },
      },
      validatorCompiler: () => (value) => ({ value }),
      serializerCompiler: () => (data) => JSON.stringify(data),
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const key = request.headers["idempotency-key"];
      return send(
        reply,
        await engine.handle({
          sessionId: request.params.sessionId,
          idempotencyKey: Array.isArray(key) ? key[0] : key,
          body: request.body,
        }),
      );
    },
  );

  server.get(
    "/sessions/:sessionId/commands/:executionId",
    {
      schema: {
        operationId: "get_command_execution",
        summary: "Get a command execution",
        description:
          "Waits up to 20 seconds for an execution to finish and returns it. Use it when a run answered with state running.",
        tags: ["Commands"],
        response: { 200: $ref("CommandResponse"), ...failures },
      },
      serializerCompiler: () => (data) => JSON.stringify(data),
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string; executionId: string } }>,
      reply: FastifyReply,
    ) =>
      send(
        reply,
        await engine.executionStatus(request.params.sessionId, request.params.executionId),
      ),
  );

  server.post(
    "/sessions/:sessionId/commands/:executionId/cancel",
    {
      schema: {
        operationId: "cancel_command_execution",
        summary: "Cancel a command execution",
        description:
          "Stops an execution. The running command stops before its next input, and commands that already ran are not undone.",
        tags: ["Commands"],
        response: { 200: $ref("CommandResponse"), ...failures },
      },
      serializerCompiler: () => (data) => JSON.stringify(data),
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string; executionId: string } }>,
      reply: FastifyReply,
    ) =>
      send(
        reply,
        await engine.cancelExecution(request.params.sessionId, request.params.executionId),
      ),
  );
}

export default routes;
