import { FastifyBaseLogger } from "fastify";
import { LogStorage } from "../../services/cdp/instrumentation/storage/log-storage.interface.js";
import { BrowserEventType } from "../../types/enums.js";
import { StateTransitionEvent } from "../../services/cdp/instrumentation/types.js";
import { Span } from "@opentelemetry/api";
import { isDetailedTracingEnabled } from "../tracing/index.js";

export interface StateTransitionLoggerOptions {
  baseLogger?: FastifyBaseLogger;
  storage?: LogStorage;
  enableConsoleLogging?: boolean;
  sessionId?: string;
}

export class StateTransitionLogger {
  private baseLogger?: FastifyBaseLogger;
  private storage?: LogStorage;
  private enableConsoleLogging: boolean;
  private sessionId: string;
  private lastTransitionTime: number;
  private rootSpan: Span | null = null;

  constructor(options: StateTransitionLoggerOptions) {
    this.baseLogger = options.baseLogger;
    this.storage = options.storage;
    this.enableConsoleLogging = options.enableConsoleLogging ?? true;
    this.sessionId = options.sessionId ?? "unknown";
    this.lastTransitionTime = Date.now();
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setRootSpan(span: Span | null): void {
    this.rootSpan = span;
  }

  recordTransition(transition: {
    fromState: string | null;
    toState: string;
    event: string;
    context?: Record<string, unknown>;
  }): void {
    const now = Date.now();
    const duration = now - this.lastTransitionTime;
    this.lastTransitionTime = now;

    const event: StateTransitionEvent = {
      type: BrowserEventType.StateTransition,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      fromState: transition.fromState,
      toState: transition.toState,
      event: transition.event,
      duration,
      context: transition.context,
    };

    if (this.enableConsoleLogging && this.baseLogger) {
      this.baseLogger.info(
        {
          from: event.fromState,
          to: event.toState,
          event: event.event,
          duration: event.duration,
          sessionId: event.sessionId,
        },
        "[StateMachine] State transition",
      );
    }

    if (this.storage) {
      this.storage.write(event, {}).catch((err) => {
        if (this.baseLogger) {
          this.baseLogger.error({ err }, "Failed to write state transition to storage");
        }
      });
    }

    if (this.rootSpan && isDetailedTracingEnabled()) {
      this.rootSpan.addEvent("state.transition", {
        from: transition.fromState || "null",
        to: transition.toState,
        event: transition.event,
        duration,
      });
    }
  }

  async flush(): Promise<void> {
    if (this.storage) {
      await this.storage.flush();
    }
  }
}
