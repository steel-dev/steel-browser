import type { TargetType } from "puppeteer-core";
import type { BrowserEventType } from "../../../types/enums.js";

export interface BaseBrowserEvent {
  type: BrowserEventType;
  timestamp: string;
  targetType?: TargetType;
  pageId?: string;
}

export interface RequestEvent extends BaseBrowserEvent {
  type: BrowserEventType.Request;
  request: { method: string; url: string };
}

export interface ResponseEvent extends BaseBrowserEvent {
  type: BrowserEventType.Response;
  response: { status: number; url: string };
}

export interface NavigationEvent extends BaseBrowserEvent {
  type: BrowserEventType.Navigation;
  navigation: { url: string };
}

export interface ConsoleEvent extends BaseBrowserEvent {
  type: BrowserEventType.Console;
  console: { level: string; text: string; loc?: string };
}

export interface ErrorEvent extends BaseBrowserEvent {
  type:
    | BrowserEventType.PageError
    | BrowserEventType.BrowserError
    | BrowserEventType.Error
    | BrowserEventType.RequestFailed;
  error: { message: string; stack?: string; url?: string };
}

export interface RecordingEvent extends BaseBrowserEvent {
  type: BrowserEventType.Recording | BrowserEventType.ScreencastFrame;
  data: any;
}

export interface CdpEvent extends BaseBrowserEvent {
  type: BrowserEventType.CdpEvent;
  cdp: {
    name: string;
    params?: object;
  };
}

export interface CdpCommandEvent extends BaseBrowserEvent {
  type: BrowserEventType.CdpCommand;
  cdp: {
    command: string;
    params?: object;
    sessionId: string;
  };
}

export interface CdpCommandResultEvent extends BaseBrowserEvent {
  type: BrowserEventType.CdpCommandResult;
  cdp: {
    command: string;
    duration: number;
    sessionId: string;
    success: boolean;
    error?: string;
  };
}

export interface ExtensionEvent extends BaseBrowserEvent {
  type: BrowserEventType.Console | BrowserEventType.PageError | BrowserEventType.RequestFailed;
  extensionId: string;
  serviceWorkerId?: string;
  logLevel: "log" | "warn" | "error";
  message: string;
  loc?: string;
  executionContextId?: number;
}

export type BrowserEventUnion =
  | RequestEvent
  | ResponseEvent
  | NavigationEvent
  | ConsoleEvent
  | ErrorEvent
  | RecordingEvent
  | CdpEvent
  | CdpCommandEvent
  | CdpCommandResultEvent
  | ExtensionEvent;
