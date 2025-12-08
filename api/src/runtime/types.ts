import { Browser, Page, Target } from "puppeteer-core";
import { BrowserLauncherOptions } from "../types/browser.js";

export enum SessionState {
  Idle = "Idle",
  Launching = "Launching",
  Ready = "Ready",
  Live = "Live",
  Draining = "Draining",
  Closed = "Closed",
}

export interface MachineEvent {
  type: string;
  data?: any;
  timestamp?: number;
}

export interface LaunchSucceededEvent extends MachineEvent {
  type: "launchSucceeded";
  data: {
    browser: Browser;
    primaryPage: Page;
  };
}

export interface DisconnectedEvent extends MachineEvent {
  type: "disconnected";
  data?: {
    reason?: string;
  };
}

export interface TargetCreatedEvent extends MachineEvent {
  type: "targetCreated";
  data: {
    target: Target;
  };
}

export interface TargetChangedEvent extends MachineEvent {
  type: "targetChanged";
  data: {
    target: Target;
  };
}

export interface TargetDestroyedEvent extends MachineEvent {
  type: "targetDestroyed";
  data: {
    targetId: string;
  };
}

export interface FileProtocolViolationEvent extends MachineEvent {
  type: "fileProtocolViolation";
  data: {
    url: string;
  };
}

export interface LaunchFailedEvent extends MachineEvent {
  type: "launchFailed";
  data: {
    error: Error;
  };
}

export type RuntimeEvent =
  | LaunchSucceededEvent
  | DisconnectedEvent
  | TargetCreatedEvent
  | TargetChangedEvent
  | TargetDestroyedEvent
  | FileProtocolViolationEvent
  | LaunchFailedEvent;

export interface MachineCommand {
  type: string;
  data?: any;
}

export interface StartCommand extends MachineCommand {
  type: "start";
  data: {
    config: BrowserLauncherOptions;
  };
}

export interface EndCommand extends MachineCommand {
  type: "end";
  data: {
    reason: string;
  };
}

export type RuntimeCommand = StartCommand | EndCommand;

export interface StateTransition {
  from: SessionState;
  to: SessionState;
  event?: string;
  command?: string;
}

export interface SessionContext {
  config?: BrowserLauncherOptions;
  browser?: Browser;
  primaryPage?: Page;
  wsEndpoint?: string;
  error?: Error;
  [key: string]: any;
}

export interface Task {
  id: string;
  label: string;
  promise: Promise<void>;
  type: "critical" | "background";
  startedAt: number;
}

export interface TransitionHook {
  onEnter?(state: SessionState, ctx: SessionContext): Promise<void> | void;
  onExit?(state: SessionState, ctx: SessionContext): Promise<void> | void;
  onEvent?(event: RuntimeEvent, ctx: SessionContext): Promise<void> | void;
}
