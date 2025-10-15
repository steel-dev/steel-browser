import { BrowserServerOptions } from "./browser.js";

export enum ScrapeFormat {
  HTML = "html",
  READABILITY = "readability",
  CLEANED_HTML = "cleaned_html",
  MARKDOWN = "markdown",
}

export enum BrowserEventType {
  Request = "Request",
  Navigation = "Navigation",
  Console = "Console",
  PageError = "PageError",
  RequestFailed = "RequestFailed",
  Response = "Response",
  Error = "Error",
  BrowserError = "BrowserError",
  Recording = "Recording",
  ScreencastFrame = "ScreencastFrame",
  CDPCommand = "CDPCommand",
  CDPCommandResult = "CDPCommandResult",
  CDPEvent = "CDPEvent",
}

export enum EmitEvent {
  Log = "log",
  PageId = "pageId",
  Recording = "recording",
}
