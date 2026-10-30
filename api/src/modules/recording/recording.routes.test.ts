import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, test, vi } from "vitest";
import { schemas } from "../../plugins/schemas.js";
import type { CDPService } from "../../services/cdp/cdp.service.js";
import { RecordingService } from "../../services/recording.service.js";
import type { SessionService } from "../../services/session.service.js";
import { BrowserEventType, EmitEvent } from "../../types/enums.js";
import sessionsRoutes from "../sessions/sessions.routes.js";
import recordingRoutes from "./recording.routes.js";

describe("session recording", () => {
  let app: FastifyInstance;
  const session = { id: "first" };
  const record = vi.fn();
  const emit = vi.fn();

  async function start(recording: RecordingService | null) {
    app = Fastify();
    app.decorate("cdpService", {
      getInstrumentationLogger: () => ({ record }),
      emit,
    } as unknown as CDPService);
    app.decorate("sessionService", { activeSession: session } as unknown as SessionService);
    app.decorate("recordingService", recording);
    for (const schema of schemas) {
      app.addSchema(schema);
    }
    await app.register(sessionsRoutes, { prefix: "/v1" });
    await app.register(recordingRoutes, { prefix: "/v1" });
    await app.ready();
  }

  function save(body: object) {
    return app.inject({ method: "POST", url: "/v1/events", payload: body });
  }

  function load(sessionId: string, after?: number) {
    return app.inject({
      method: "GET",
      url: `/v1/sessions/${sessionId}/recording`,
      query: after === undefined ? {} : { after: String(after) },
    });
  }

  afterEach(async () => {
    await app?.close();
    session.id = "first";
    record.mockClear();
    emit.mockClear();
  });

  test("hands the event body to the logger unchanged and streams it", async () => {
    await start(null);
    const response = await save({ events: ["a", "b"] });
    expect(response.statusCode).toBe(200);
    expect(record).toHaveBeenCalledWith({
      type: BrowserEventType.Recording,
      timestamp: expect.any(String),
      data: { events: ["a", "b"] },
    });
    expect(emit).toHaveBeenCalledWith(EmitEvent.Recording, { events: ["a", "b"] });
  });

  test("leaves the recording route out when recording is off", async () => {
    await start(null);
    expect((await load("first")).statusCode).toBe(404);
  });

  test("returns batches with their tab, after a cursor", async () => {
    await start(new RecordingService(1_000_000));
    await save({ events: ["a"], tabId: 1 });
    await save({ events: ["b", "c"], tabId: 2 });
    await save({ events: ["d"] });

    const all = (await load("first")).json();
    expect(all).toEqual({
      batches: [
        { seq: expect.any(Number), tabId: 1, events: ["a"] },
        { seq: expect.any(Number), tabId: 2, events: ["b", "c"] },
        { seq: expect.any(Number), tabId: null, events: ["d"] },
      ],
      next: all.batches[2].seq,
      truncated: false,
    });

    const newer = (await load("first", all.batches[0].seq)).json();
    expect(newer.batches.map((batch) => batch.events)).toEqual([["b", "c"], ["d"]]);
    expect((await load("first", all.next)).json()).toEqual({
      batches: [],
      next: all.next,
      truncated: false,
    });
  });

  test("stops keeping events at the size limit", async () => {
    await start(new RecordingService(60));
    await save({ events: ["x".repeat(10)] });
    await save({ events: ["y".repeat(100)] });
    await save({ events: ["z"] });

    const { batches, truncated } = (await load("first")).json();
    expect(batches.map((batch) => batch.events)).toEqual([["x".repeat(10)]]);
    expect(truncated).toBe(true);
  });

  test("starts over when the next session records", async () => {
    await start(new RecordingService(1_000_000));
    await save({ events: ["old"] });
    session.id = "second";

    expect((await load("second")).json()).toEqual({ batches: [], next: 0, truncated: false });
    expect((await load("first")).json().batches).toHaveLength(1);

    await save({ events: ["new"] });
    expect((await load("second")).json().batches.map((batch) => batch.events)).toEqual([["new"]]);
    expect((await load("first")).statusCode).toBe(404);
  });
});
