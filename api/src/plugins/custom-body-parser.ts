import fp from "fastify-plugin";
import { type FastifyInstance, type FastifyPluginAsync } from "fastify";

const customBodyParser: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    function (req, body, done) {
      try {
        switch (true) {
          case req.url.includes("/release"):
            // Skip parsing for release endpoints
            done(null, null);
            break;

          default:
            // Parse JSON for all other requests
            done(null, JSON.parse(body.toString()));
        }
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
};

export default fp(customBodyParser, { name: "custom-body-parser" });
