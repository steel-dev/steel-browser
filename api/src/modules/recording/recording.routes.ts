import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { $ref } from "../../plugins/schemas.js";
import type { RecordingQuery } from "./recording.schema.js";

async function routes(server: FastifyInstance) {
  const recording = server.recordingService;
  if (!recording) {
    return;
  }

  server.get(
    "/sessions/:sessionId/recording",
    {
      schema: {
        operationId: "get_session_recording",
        summary: "Get the session recording",
        description:
          "Returns the rrweb events recorded in a session so it can be replayed. Pass `after` to get only the batches recorded since an earlier response.",
        tags: ["Sessions"],
        querystring: $ref("RecordingQuery"),
        response: {
          200: $ref("RecordingResponse"),
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Querystring: RecordingQuery }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { after } = request.query;
      const page = recording.read(sessionId, after);
      if (page) {
        return reply.send(page);
      }
      if (sessionId === server.sessionService.activeSession.id) {
        return reply.send({ batches: [], next: after, truncated: false });
      }
      return reply.code(404).send({ message: "No recording for this session" });
    },
  );
}

export default routes;
