import pino from "pino";
import type { FastifyBaseLogger } from "fastify";
import { BrowserEventUnion } from "./types.js";

export type Context = Record<string, any>;

export interface BrowserLogger {
  record(event: BrowserEventUnion): void;
  setContext(
    update: Partial<Context> | ((prev: Readonly<Context>) => Partial<Context> | Context),
  ): void;
  getContext(): Readonly<Context>;
  flush?(): Promise<void>;
}

export interface CreateBrowserLoggerOptions {
  baseLogger: pino.Logger | FastifyBaseLogger;
  initialContext?: Context;
}

export function createBrowserLogger(options: CreateBrowserLoggerOptions): BrowserLogger {
  let context: Context = options.initialContext ?? {};

  const setContext = (
    update: Partial<Context> | ((prev: Readonly<Context>) => Partial<Context> | Context),
  ) => {
    if (typeof update === "function") {
      const result = update(context);
      context = { ...context, ...result };
    } else {
      context = { ...context, ...update };
    }
  };

  const getContext = (): Readonly<Context> => context;

  const record = (event: BrowserEventUnion) => {
    const mergedEvent = { ...context, ...event };
    options.baseLogger.info(mergedEvent, event.type);
  };

  return {
    record,
    setContext,
    getContext,
  };
}
