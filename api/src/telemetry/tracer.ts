import type { Span, SpanOptions } from "@opentelemetry/api";
import { noopSpan } from "./noop.js";

let otel: typeof import("@opentelemetry/api") | undefined;
try {
  otel = await import("@opentelemetry/api");
} catch (err: any) {
  if (err?.code !== "MODULE_NOT_FOUND" && err?.code !== "ERR_MODULE_NOT_FOUND") {
    throw err;
  }
}

interface TracerOptions extends SpanOptions {
  spanName?: string;
  tracerName?: string;
}

export const tracer = {
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F,
    opts?: Omit<TracerOptions, "spanName">,
  ): ReturnType<F> {
    if (!otel) {
      return fn(noopSpan) as ReturnType<F>;
    }

    const { tracerName, ...options } = opts ?? {};
    const rawTracer = otel.trace.getTracer(tracerName ?? "steel");

    return rawTracer.startActiveSpan(name, options ?? {}, (span: Span) => {
      try {
        const result = fn(span);

        if (result instanceof Promise) {
          return result
            .catch((error: Error) => {
              span.recordException(error);
              span.setStatus({
                code: otel.SpanStatusCode.ERROR,
                message: error.message,
              });
              throw error;
            })
            .finally(() => {
              span.end();
            }) as ReturnType<F>;
        }

        span.setStatus({ code: otel.SpanStatusCode.OK });
        span.end();
        return result as ReturnType<F>;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({
          code: otel.SpanStatusCode.ERROR,
          message: error.message,
        });
        span.end();
        throw error;
      }
    });
  },
  factory(tracerName: string) {
    return {
      startActiveSpan<F extends (span: Span) => unknown>(
        name: string,
        fn: F,
        opts?: Omit<TracerOptions, "spanName" | "tracerName">,
      ): ReturnType<F> {
        return tracer.startActiveSpan(name, fn, { ...opts, tracerName });
      },
    };
  },
};

export function traceable(
  target: Object,
  propertyKey: string,
  descriptor: PropertyDescriptor,
): void;
export function traceable(opts?: TracerOptions): MethodDecorator;
export function traceable(
  targetOrOpts?: any,
  propertyKey?: string,
  descriptor?: PropertyDescriptor,
): any {
  // Used as @traceable
  if (typeof targetOrOpts === "object" && propertyKey !== undefined && descriptor !== undefined) {
    return createDecorator()(targetOrOpts, propertyKey, descriptor);
  }

  // Used as @traceable({...})
  return createDecorator(targetOrOpts as TracerOptions | undefined);
}

function createDecorator(opts?: TracerOptions) {
  const { spanName, tracerName, ...options } = opts ?? {};
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!otel) {
      return descriptor;
    }

    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const tracername = tracerName ?? toKebabCase(target.constructor.name);
      const name = spanName ?? `${target.constructor.name}.${propertyKey}`;

      return tracer.startActiveSpan(
        name,
        () => {
          return originalMethod.apply(this, args);
        },
        {
          ...options,
          tracerName: tracername,
        },
      );
    };
  };
}

function toKebabCase(str: string) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
