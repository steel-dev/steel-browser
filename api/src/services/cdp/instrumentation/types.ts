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
  request: {
    method: string;
    url: string;
    resourceType?: string;
    postData?: string;
    headers?: Record<string, string>;
  };
}

export interface ResponseEvent extends BaseBrowserEvent {
  type: BrowserEventType.Response;
  response: {
    status: number;
    url: string;
    mimeType?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export interface ResponseBodyEvent extends BaseBrowserEvent {
  type: BrowserEventType.ResponseBody;
  responseBody: {
    requestId: string;
    body: string;
    base64Encoded: boolean;
  };
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

export interface BrowserInteractionTarget {
  tagName?: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  attributes?: {
    id?: string;
    name?: string;
    type?: string;
    href?: string;
    ariaLabel?: string;
    placeholder?: string;
    title?: string;
    testId?: string;
  };
  selector?: {
    css?: string;
    id?: string;
    testId?: string;
    name?: string;
    aria?: string;
  };
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface BrowserInteractionEvent extends BaseBrowserEvent {
  type: BrowserEventType.BrowserInteraction;
  interaction: {
    action: "click" | "doubleClick" | "keyPress" | "input" | "change" | "submit" | "navigate";
    eventType: string;
    target?: BrowserInteractionTarget;
    pointer?: {
      x: number;
      y: number;
      button?: number;
      clickCount?: number;
    };
    keyboard?: {
      key?: string;
      code?: string;
    };
    value?: {
      inputType?: string;
      valueLength?: number;
      checked?: boolean;
    };
    navigation?: {
      url: string;
    };
    page?: {
      url?: string;
      title?: string;
    };
  };
}

export interface CDPEvent extends BaseBrowserEvent {
  type: BrowserEventType.CDPEvent;
  cdp: {
    name: string;
    params?: object;
  };
}

export interface CDPCommandEvent extends BaseBrowserEvent {
  type: BrowserEventType.CDPCommand;
  cdp: {
    command: string;
    params?: object;
    sessionId: string;
  };
}

export interface CDPCommandResultEvent extends BaseBrowserEvent {
  type: BrowserEventType.CDPCommandResult;
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
  | ResponseBodyEvent
  | NavigationEvent
  | ConsoleEvent
  | ErrorEvent
  | RecordingEvent
  | BrowserInteractionEvent
  | CDPEvent
  | CDPCommandEvent
  | CDPCommandResultEvent
  | ExtensionEvent;
