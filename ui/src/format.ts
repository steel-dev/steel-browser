export type Tone = "neutral" | "red" | "yellow" | "blue";

export type LogKind =
  | "console"
  | "request"
  | "response"
  | "navigation"
  | "error"
  | "failed"
  | "interaction"
  | "cdp"
  | "other";

export type BrowserEvent = {
  type: string;
  timestamp?: string;
  request?: { method?: string; url?: string };
  response?: { status?: number; url?: string };
  navigation?: { url?: string };
  console?: { level?: string; text?: string };
  error?: { message?: string; url?: string };
  interaction?: {
    action?: string;
    target?: { accessibleName?: string; text?: string; tagName?: string };
    navigation?: { url?: string };
  };
  cdp?: { name?: string; command?: string; duration?: number };
  message?: string;
  logLevel?: string;
};

export type EventSummary = {
  kind: LogKind;
  tone: Tone;
  message: string;
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const join = (...parts: (string | number | undefined)[]) =>
  parts.filter((part) => part !== undefined && part !== "").join(" ");

const tag = (value: string | number | undefined) =>
  value === undefined || value === "" ? undefined : `[${value}]`;

function summarize(event: BrowserEvent): EventSummary {
  switch (event.type) {
    case "Request":
      return {
        kind: "request",
        tone: "neutral",
        message: join(tag(event.request?.method), event.request?.url),
      };
    case "Response": {
      const status = event.response?.status;
      return {
        kind: "response",
        tone: status !== undefined && status >= 400 ? "red" : "neutral",
        message: join(tag(status), event.response?.url),
      };
    }
    case "Navigation":
      return { kind: "navigation", tone: "blue", message: event.navigation?.url ?? "" };
    case "Console": {
      const level = event.console?.level ?? event.logLevel ?? "log";
      return {
        kind: "console",
        tone: level === "error" ? "red" : level.startsWith("warn") ? "yellow" : "neutral",
        message: event.console?.text ?? event.message ?? "",
      };
    }
    case "RequestFailed":
      return {
        kind: "failed",
        tone: "red",
        message: [event.error?.message ?? event.message, event.error?.url]
          .filter(Boolean)
          .join(" @ "),
      };
    case "PageError":
    case "BrowserError":
    case "Error":
      return {
        kind: "error",
        tone: "red",
        message: event.error?.message ?? event.message ?? "",
      };
    case "BrowserInteraction": {
      const target = event.interaction?.target;
      return {
        kind: "interaction",
        tone: "neutral",
        message: join(
          event.interaction?.action,
          target?.accessibleName || target?.text || target?.tagName?.toLowerCase(),
          event.interaction?.navigation?.url,
        ),
      };
    }
    case "CDPEvent":
      return { kind: "cdp", tone: "neutral", message: event.cdp?.name ?? "" };
    case "CDPCommand":
    case "CDPCommandResult":
      return {
        kind: "cdp",
        tone: "neutral",
        message: join(
          event.cdp?.command,
          event.cdp?.duration !== undefined ? `${event.cdp.duration}ms` : undefined,
        ),
      };
    default:
      return { kind: "other", tone: "neutral", message: "" };
  }
}

export function describeEvent(event: BrowserEvent): EventSummary {
  const summary = summarize(event);
  return summary.message ? summary : { ...summary, message: JSON.stringify(event) };
}

export function isBrowserEvent(value: unknown): value is BrowserEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function formatTime(timestamp?: string): string {
  const date = timestamp ? new Date(timestamp) : null;
  return date && !Number.isNaN(date.getTime()) ? timeFormat.format(date) : "--:--:--";
}

export function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatProxy(proxy: string): string {
  const host = URL.canParse(proxy) ? new URL(proxy).host : "";
  return host || proxy.slice(proxy.lastIndexOf("@") + 1);
}
