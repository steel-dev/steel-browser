import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { CDPService } from "./cdp.service.js";
import { BrowserEventType, EmitEvent } from "../../types/enums.js";

describe("CDPService instrumentation events", () => {
  it("bridges recording logger events to legacy EventEmitter subscribers", async () => {
    const service = new CDPService({ keepAlive: false }, pino({ level: "silent" }));
    const listener = vi.fn();
    service.on(EmitEvent.Recording, listener);

    service.getInstrumentationLogger().record({
      type: BrowserEventType.Recording,
      timestamp: "2025-01-01T00:00:00Z",
      data: { events: [{ type: "click" }] },
    });

    expect(listener).toHaveBeenCalledWith({ events: [{ type: "click" }] });

    await service.shutdown();
  });
});
