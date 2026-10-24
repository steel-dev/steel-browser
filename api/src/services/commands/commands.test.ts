import Fastify from "fastify";
import { describe, expect, test } from "vitest";
import { $ref, schemas } from "../../plugins/schemas.js";
import { requestJsonSchema } from "./commands.js";

describe("published request schema", () => {
  test("accepts one command or a list of commands, as the API does", async () => {
    const app = Fastify({
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    for (const schema of schemas) {
      app.addSchema(schema);
    }
    app.post("/openapi", { schema: { body: $ref("CommandRequest") } }, async () => ({ ok: true }));
    app.post("/json", { schema: { body: requestJsonSchema() } }, async () => ({ ok: true }));
    for (const url of ["/openapi", "/json"]) {
      for (const commands of [
        { command: "snapshot" },
        [{ command: "snapshot" }, { command: "tab", action: "list" }],
      ]) {
        const response = await app.inject({ method: "POST", url, payload: { commands } });
        expect(response.statusCode, `${url} ${response.body}`).toBe(200);
      }
      for (const commands of [[], { command: "eval" }]) {
        const response = await app.inject({ method: "POST", url, payload: { commands } });
        expect(response.statusCode, `${url} ${JSON.stringify(commands)}`).toBe(400);
      }
    }
    await app.close();
  });
});
