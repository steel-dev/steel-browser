import { Browser, Page, Target } from "puppeteer-core";
import { BrowserLauncherOptions } from "../types/browser.js";

export interface BrowserEvent {
  type: string;
  data?: unknown;
  timestamp: number;
}

export interface DisconnectedEvent extends BrowserEvent {
  type: "disconnected";
}

export interface TargetCreatedEvent extends BrowserEvent {
  type: "targetCreated";
  data: { target: Target };
}

export interface TargetChangedEvent extends BrowserEvent {
  type: "targetChanged";
  data: { target: Target };
}

export interface TargetDestroyedEvent extends BrowserEvent {
  type: "targetDestroyed";
  data: { targetId: string };
}

export interface FileProtocolViolationEvent extends BrowserEvent {
  type: "fileProtocolViolation";
  data: { url: string };
}

export type RuntimeEvent =
  | DisconnectedEvent
  | TargetCreatedEvent
  | TargetChangedEvent
  | TargetDestroyedEvent
  | FileProtocolViolationEvent;

export interface Task {
  id: string;
  label: string;
  promise: Promise<void>;
  abortController: AbortController;
  type: "critical" | "background";
  startedAt: number;
}

export type FailedFromState = "launching" | "live" | "draining";

export interface IdleSession {
  readonly _state: "idle";
  start(config: BrowserLauncherOptions): Promise<LaunchingSession>;
}

export interface LaunchingSession {
  readonly _state: "launching";
  readonly config: BrowserLauncherOptions;
  awaitLaunch(): Promise<LiveSession | ErrorSession>;
}

export interface LiveSession {
  readonly _state: "live";
  readonly browser: Browser;
  readonly primaryPage: Page;
  readonly config: BrowserLauncherOptions;
  end(reason: string): Promise<DrainingSession>;
}

export interface DrainingSession {
  readonly _state: "draining";
  readonly browser: Browser;
  readonly reason: string;
  awaitDrain(): Promise<ClosedSession | ErrorSession>;
}

export interface ErrorSession {
  readonly _state: "error";
  readonly error: Error;
  readonly failedFrom: FailedFromState;
  recover(): IdleSession;
  terminate(): ClosedSession;
}

export interface ClosedSession {
  readonly _state: "closed";
  restart(): IdleSession;
}

export type Session =
  | IdleSession
  | LaunchingSession
  | LiveSession
  | DrainingSession
  | ErrorSession
  | ClosedSession;

export function isIdle(session: Session): session is IdleSession {
  return session._state === "idle";
}

export function isLaunching(session: Session): session is LaunchingSession {
  return session._state === "launching";
}

export function isLive(session: Session): session is LiveSession {
  return session._state === "live";
}

export function isDraining(session: Session): session is DrainingSession {
  return session._state === "draining";
}

export function isClosed(session: Session): session is ClosedSession {
  return session._state === "closed";
}

export function isError(session: Session): session is ErrorSession {
  return session._state === "error";
}

export function assertIdle(session: Session): asserts session is IdleSession {
  if (session._state !== "idle") {
    throw new InvalidStateError(session._state, "idle");
  }
}

export function assertLive(session: Session): asserts session is LiveSession {
  if (session._state !== "live") {
    throw new InvalidStateError(session._state, "live");
  }
}

export function assertError(session: Session): asserts session is ErrorSession {
  if (session._state !== "error") {
    throw new InvalidStateError(session._state, "error");
  }
}

export class InvalidStateError extends Error {
  constructor(
    public readonly currentState: string,
    public readonly expectedState: string,
  ) {
    super(`Invalid state: expected '${expectedState}', got '${currentState}'`);
    this.name = "InvalidStateError";
  }
}

export class LaunchError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "LaunchError";
  }
}
