import { Span } from "@opentelemetry/api";
import { tracer } from "../../telemetry/tracer.js";
import { env } from "../../env.js";

export function isDetailedTracingEnabled(): boolean {
  return env.BROWSER_TRACING_LEVEL === "detailed";
}

export async function traceOperation<T>(
  name: string,
  level: "minimal" | "detailed",
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const shouldTrace = level === "minimal" || isDetailedTracingEnabled();

  if (!shouldTrace) {
    return fn({} as any); // Pass a dummy span if tracing is disabled for this level
  }

  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
    return fn(span);
  });
}

/**
 * Root session span - always minimal level
 */
export async function traceSession<T>(
  sessionId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return traceOperation(`browser.session`, "minimal", fn, { "session.id": sessionId });
}

/**
 * Boot phase spans - detailed level
 */
export async function traceBootPhase<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return traceOperation(`browser.boot.${name}`, "detailed", fn);
}
