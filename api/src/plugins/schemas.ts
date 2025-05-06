import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import fastifySwagger from "@fastify/swagger";
import fastifyScalar from "@scalar/fastify-api-reference";
import { titleCase } from "../utils/text.js";
import actionSchemas from "../modules/actions/actions.schema.js";
import cdpSchemas from "../modules/cdp/cdp.schemas.js";
import browserSchemas from "../modules/sessions/sessions.schema.js";
import seleniumSchemas from "../modules/selenium/selenium.schema.js";
import scalarTheme from "./scalar-theme.js";
import { buildJsonSchemas } from "../utils/schema.js";
import filesSchemas from "../modules/files/files.schema.js";
import { getBaseUrl } from "../utils/url.js";

const SCHEMAS = {
  ...actionSchemas,
  ...browserSchemas,
  ...cdpSchemas,
  ...seleniumSchemas,
  ...filesSchemas,
};

export const { schemas, $ref } = buildJsonSchemas(SCHEMAS);

const schemaPlugin: FastifyPluginAsync = async (fastify) => {
  for (const schema of schemas) {
    fastify.addSchema(schema);
  }

  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Steel Browser Instance API",
        description: "Documentation for controlling a single instance of Steel Browser",
        version: "0.0.1",
      },
      servers: [
        {
          url: getBaseUrl(),
          description: "Local server",
        },
      ],
      paths: {}, // paths must be included even if it's an empty object
      components: {
        securitySchemes: {},
      },
    },
    refResolver: {
      buildLocalReference: (json, baseUri, fragment, i) => {
        return titleCase(json.$id as string) || `Fragment${i}`;
      },
    },
  });

  await fastify.register(fastifyScalar, {
    routePrefix: "/documentation",
    configuration: {
      customCss: scalarTheme,
    },
  });
};

export default fp(schemaPlugin);
