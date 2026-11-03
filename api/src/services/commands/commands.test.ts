import Fastify from "fastify";
import { describe, expect, test } from "vitest";
import type { ZodIssue } from "zod";
import { $ref, schemas } from "../../plugins/schemas.js";
import { requestJsonSchema, requestSchema } from "./commands.js";

function issueCount(issues: ZodIssue[]): number {
  return issues.reduce(
    (count, issue) =>
      count +
      1 +
      (issue.code === "invalid_union"
        ? issue.unionErrors.reduce((nested, error) => nested + issueCount(error.issues), 0)
        : 0),
    0,
  );
}

describe("request schema", () => {
  test("rejects an oversized list without checking every item", () => {
    const many = (item: unknown) => Array.from({ length: 100_000 }, () => item);
    for (const body of [
      { commands: many({}) },
      { commands: [{ command: "select", target: "e1", values: many(0) }] },
      { commands: [{ command: "upload", target: "e1", files: many(0) }] },
      { commands: [{ command: "click", target: "e1", frame: many(0) }] },
    ]) {
      const result = requestSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(issueCount(result.error!.issues)).toBeLessThan(2_000);
    }
  });

  test("allows lists up to their limits", () => {
    const select = (count: number) =>
      requestSchema.safeParse({
        commands: [{ command: "select", target: "e1", values: Array(count).fill("a") }],
      });
    expect(select(1000).success).toBe(true);
    expect(select(1001).error?.issues).toMatchObject([
      { code: "too_big", maximum: 1000, path: ["commands", 0, "values"] },
    ]);
    const commands = (count: number) =>
      requestSchema.safeParse({ commands: Array(count).fill({ command: "snapshot" }) });
    expect(commands(50).success).toBe(true);
    expect(commands(51).error?.issues).toMatchObject([
      { code: "too_big", maximum: 50, path: ["commands"] },
    ]);
  });
});

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
        { command: "get", what: "locator", target: "e3" },
        { command: "click", target: { text: "Accept" }, frame: { title: "Consent" } },
        { command: "click", target: { text: "Accept" }, frame: "iframe#consent" },
        { command: "click", target: { text: "Accept" }, frame: ["iframe", { css: "iframe" }] },
      ]) {
        const response = await app.inject({ method: "POST", url, payload: { commands } });
        expect(response.statusCode, `${url} ${response.body}`).toBe(200);
      }
      for (const commands of [
        [],
        { command: "teleport" },
        { command: "click", target: { text: "Accept" }, frame: [] },
      ]) {
        const response = await app.inject({ method: "POST", url, payload: { commands } });
        expect(response.statusCode, `${url} ${JSON.stringify(commands)}`).toBe(400);
      }
    }
    await app.close();
  });
});
