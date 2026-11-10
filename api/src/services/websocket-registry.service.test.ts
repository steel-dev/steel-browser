import { describe, expect, it } from "vitest";
import type { WebSocketHandler } from "../types/websocket.js";
import { WebSocketRegistryService } from "./websocket-registry.service.js";

function handlerFor(path: string): WebSocketHandler {
  return { path, handler: () => {} };
}

describe("WebSocketRegistryService.matchHandler", () => {
  it("matches a static path regardless of the query string", () => {
    const registry = new WebSocketRegistryService();
    const logs = handlerFor("/v1/sessions/logs");
    registry.registerHandler(logs);

    expect(registry.matchHandler("/v1/sessions/logs?x=1")).toBe(logs);
  });

  it("prefers the longest matching prefix over insertion order", () => {
    const registry = new WebSocketRegistryService();
    const cast = handlerFor("/v1/sessions/");
    const logs = handlerFor("/v1/sessions/logs");
    registry.registerHandler(cast);
    registry.registerHandler(logs);

    expect(registry.matchHandler("/v1/sessions/logs")).toBe(logs);
    expect(registry.matchHandler("/v1/sessions/abc/cast?tabInfo=true")).toBe(cast);
  });

  it("returns undefined when no handler matches", () => {
    const registry = new WebSocketRegistryService();
    registry.registerHandler(handlerFor("/v1/sessions/"));

    expect(registry.matchHandler("/")).toBeUndefined();
    expect(registry.matchHandler("/cdp?x=1")).toBeUndefined();
  });
});
