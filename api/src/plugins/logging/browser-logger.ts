import pino from "pino";
import type { FastifyBaseLogger } from "fastify";
import { BrowserEventType } from "../../types/enums.js";

export type LogLevel = Exclude<pino.Level, "fatal" | "trace">;

export type Ctx = { [key: string]: string };

export interface TargetContext {
  target: string;
}

export interface BrowserContext extends TargetContext {
  type: BrowserEventType;
}

export interface ExtensionContext extends TargetContext {
  extensionId: string;
}

export interface ServiceWorkerContext extends TargetContext {
  workerId: string;
}

export interface CommonLogFields {
  err?: Error;
}

type TransportEntry = pino.TransportSingleOptions<Record<string, any>>;

export type TargetTransportMap = {
  default?: TransportEntry;
} & {
  [K in Exclude<string, "default">]?: TransportEntry;
};

type RequireMissing<TFull, TPartial> = Omit<TFull, keyof TPartial>;

type ForbidKeys<Keys extends PropertyKey> = {
  [K in Keys]?: never;
};

// Session payload:
// - P: arbitrary extra keys allowed
// - err?: Error allowed
// - must include Req (the required missing context pieces)
// - forbidden to include other CombinedCtx keys except Req
type SessionPayload<
  CombinedCtx extends object,
  P extends Record<string, unknown>,
  Req extends object,
> = P & CommonLogFields & Req & ForbidKeys<Exclude<keyof CombinedCtx, keyof Req>>;

type StrictTargetLogFn<CombinedCtx extends object, Req extends object> = keyof Req extends never
  ? ((msg: string) => void) &
      (<P extends Record<string, unknown>>(
        payload: SessionPayload<CombinedCtx, P, Req>,
        msg?: string,
      ) => void)
  : <P extends Record<string, unknown>>(
      payload: SessionPayload<CombinedCtx, P, Req>,
      msg?: string,
    ) => void;

// Specialized target single-function type:
// - Always logs at info
// - If there are missing required fields, only (payload, text?) is allowed
// - If no missing required fields, allow also (textOnly)
type SpecializedTargetFn<CombinedCtx extends object, Req extends object> = keyof Req extends never
  ? ((text: string) => void) &
      (<P extends Record<string, unknown>>(
        payload: SessionPayload<CombinedCtx, P, Req>,
        text?: string,
      ) => void)
  : <P extends Record<string, unknown>>(
      payload: SessionPayload<CombinedCtx, P, Req>,
      text?: string,
    ) => void;

export type SpecializedTarget<
  BaseCtx extends Ctx | {},
  TCtx extends object,
  Def extends Partial<TCtx> = {},
> = SpecializedTargetFn<BaseCtx & TCtx, RequireMissing<TCtx, Def>> & {
  context: Readonly<Def>;
};

export type BaseTargetLogger<BaseCtx extends Ctx | {}> = {
  [L in LogLevel]: StrictTargetLogFn<BaseCtx, {}>;
};

export interface BrowserLogger<BaseCtx extends Ctx | {} = {}> extends BaseTargetLogger<BaseCtx> {
  cdp: SpecializedTarget<BaseCtx, TargetContext, { target: "cdp" }>;
  browser: SpecializedTarget<BaseCtx, BrowserContext, { target: "browser" }>;
  extension: SpecializedTarget<BaseCtx, ExtensionContext, { target: "extension" }>;
  service_worker: SpecializedTarget<BaseCtx, ServiceWorkerContext, { target: "service_worker" }>;

  context(next: Partial<BaseCtx> | ((prev: Readonly<BaseCtx>) => Partial<BaseCtx> | BaseCtx)): void;

  getContext(): Readonly<BaseCtx>;
}

export interface CreateBrowserLoggerOptions<BaseCtx extends Ctx | {} = {}> {
  baseContext?: BaseCtx;
  transports?: TargetTransportMap;
}

/**
 Helper: builds a StrictTargetLogFn that merges current combined context
 at call time and routes to the provided logger.
 We do not bind base context via child, because base context is mutable.
*/
function makeStrictFn<CombinedCtx extends object, Req extends object>(
  targetLogger: pino.Logger | FastifyBaseLogger,
  getCombinedContext: () => CombinedCtx,
  level: LogLevel,
): StrictTargetLogFn<CombinedCtx, Req> {
  function emitWithPayload(a: Record<string, unknown>, b?: string): void {
    const ctx = getCombinedContext();
    targetLogger[level](
      { ...(ctx as object), ...(a as object) } as Record<string, unknown>,
      b as string | undefined,
    );
  }

  function emitMsgOnly(msg: string): void {
    const ctx = getCombinedContext();
    targetLogger[level](ctx as Record<string, unknown>, msg);
  }

  const fn: any = function (a: unknown, b?: string): void {
    if (typeof a === "string") {
      emitMsgOnly(a);
    } else {
      emitWithPayload(a as Record<string, unknown>, b);
    }
  };

  return fn as StrictTargetLogFn<CombinedCtx, Req>;
}

/**
 Create a specialized target function that always logs at "info".
 It merges BaseCtx (dynamic) + static defaults (Def) + call payload (if any).
 - If the call is string-only, it's mapped to { text } with just the merged context.
 - No lazy defaults; defaults are static.
*/
function createSpecializedTarget<
  BaseCtx extends Ctx | {},
  TCtx extends object,
  Def extends Partial<TCtx> = {},
>(
  targetPino: pino.Logger | FastifyBaseLogger,
  getBaseCtx: () => BaseCtx,
  defaults: Def,
): SpecializedTarget<BaseCtx, TCtx, Def> {
  type Combined = BaseCtx & TCtx;
  type Req = RequireMissing<TCtx, Def>;
  const defObj = (defaults ?? ({} as Def)) as Def;

  const getBasePlusDefaults = () =>
    ({
      ...(getBaseCtx() as object),
      ...(defObj as object),
    }) as BaseCtx & Partial<TCtx>;

  const fn: any = function (a: unknown, b?: string): void {
    const base = getBasePlusDefaults();

    if (typeof a === "string") {
      targetPino.info(base as Record<string, unknown>, a);
      return;
    }

    const payload = a as Record<string, unknown>;
    const msg = b as string | undefined;

    targetPino.info(
      { ...(base as object), ...(payload as object) } as Record<string, unknown>,
      msg,
    );
  };

  Object.defineProperty(fn, "context", {
    value: Object.freeze(defObj),
    writable: false,
    configurable: false,
    enumerable: true,
  });

  return fn as SpecializedTarget<BaseCtx, TCtx, Def>;
}

/**
 Resolve a pino Logger for a given target name using the transport map:
 - If a per-target transport exists, use it
 - Else if a default transport exists, use it
 - Else fall back to the provided base logger
 Instances created for transports are cached.
*/
function buildTransportRouter(
  base: pino.Logger | FastifyBaseLogger,
  transports?: TargetTransportMap,
) {
  const cache = new Map<string, pino.Logger>();

  const getFor = (name: string | "default"): pino.Logger | FastifyBaseLogger => {
    if (!transports) return base;

    const specific = transports[name];
    const def = transports.default;

    if (!specific && !def) return base;

    const key = specific ? name : "default";

    if (cache.has(key)) return cache.get(key)!;

    const opt = specific ?? def!;
    const pipeline = pino.transport(opt);
    const inst = pino({
      level: (base as any).level as string | undefined,
      transport: pipeline,
    });

    cache.set(key, inst);
    return inst;
  };

  return {
    root(): pino.Logger | FastifyBaseLogger {
      if (!transports?.default) return base;
      return getFor("default");
    },
    target(name: string): pino.Logger | FastifyBaseLogger {
      const hasSpecific = !!transports?.[name];
      if (hasSpecific) return getFor(name);
      if (transports?.default) return getFor("default");
      return base;
    },
  };
}

/**
 Main factory with options:
 - baseContext: initial base context (generic, defaults to {})
 - transports: per-target transport overrides and/or default transport
*/
export function createBrowserLogger<BaseCtx extends Ctx | {} = {}>(
  baseLogger: pino.Logger | FastifyBaseLogger,
  options?: CreateBrowserLoggerOptions<BaseCtx>,
): BrowserLogger<BaseCtx> {
  let baseCtxRef: BaseCtx = (options?.baseContext ?? ({} as BaseCtx)) as BaseCtx;

  const getBaseCtx = () => baseCtxRef;

  const normalizedTransports =
    options?.transports && Object.keys(options.transports).length > 0
      ? options.transports
      : undefined;

  const router = buildTransportRouter(baseLogger, normalizedTransports);

  const rootLogger = router.root();
  const getRootCombined = () => getBaseCtx();

  const core: BaseTargetLogger<BaseCtx> = {
    info: makeStrictFn<BaseCtx, {}>(rootLogger, getRootCombined, "info"),
    warn: makeStrictFn<BaseCtx, {}>(rootLogger, getRootCombined, "warn"),
    error: makeStrictFn<BaseCtx, {}>(rootLogger, getRootCombined, "error"),
    debug: makeStrictFn<BaseCtx, {}>(rootLogger, getRootCombined, "debug"),
  };

  const cdp = createSpecializedTarget<BaseCtx, TargetContext, { target: "cdp" }>(
    router.target("cdp"),
    getBaseCtx,
    { target: "cdp" },
  );

  const browser = createSpecializedTarget<BaseCtx, BrowserContext, { target: "browser" }>(
    router.target("browser"),
    getBaseCtx,
    { target: "browser" },
  );

  const extension = createSpecializedTarget<BaseCtx, ExtensionContext, { target: "extension" }>(
    router.target("extension"),
    getBaseCtx,
    { target: "extension" },
  );

  const service_worker = createSpecializedTarget<
    BaseCtx,
    ServiceWorkerContext,
    { target: "service_worker" }
  >(router.target("service_worker"), getBaseCtx, {
    target: "service_worker",
  });

  const contextUpdate = (
    next: Partial<BaseCtx> | ((prev: Readonly<BaseCtx>) => Partial<BaseCtx> | BaseCtx),
  ) => {
    const patch =
      typeof next === "function"
        ? (next as (prev: Readonly<BaseCtx>) => Partial<BaseCtx> | BaseCtx)(baseCtxRef)
        : next;

    baseCtxRef = {
      ...baseCtxRef,
      ...(patch as Partial<BaseCtx>),
    } as BaseCtx;
  };

  const getContext = () => baseCtxRef as Readonly<BaseCtx>;

  return {
    ...core,
    cdp,
    browser,
    extension,
    service_worker,
    context: contextUpdate,
    getContext,
  };
}
