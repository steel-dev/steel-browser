import { FastifyInstance } from "fastify";
import { handleRunCode } from "./playground.controller";

async function routes(server: FastifyInstance) {
    server.post(
        "/run",
        {
            schema: {
                operationId: "run_code",
                description: "Execute python3 code",
                tags: ["Playground"],
                summary: "Execute python3 code",
                body: {
                    type: 'object',
                    required: ['code'],
                    properties: {
                        code: { type: 'string' }
                    }
                },
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            result: { type: 'string' },
                            error: { type: 'string' },
                            exitCode: { type: 'number' }
                        }
                    },
                    400: {
                        type: 'object',
                        properties: {
                            error: { type: 'string' }
                        }
                    },
                    500: {
                        type: 'object',
                        properties: {
                            error: { type: 'string' }
                        }
                    }
                }
            }
        },
        handleRunCode
    );
}

export default routes;