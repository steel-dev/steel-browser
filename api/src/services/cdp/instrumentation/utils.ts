import type { Target, Protocol } from "puppeteer-core";

export function extractTargetId(target: Target): string {
  return (target as any)._targetId as string;
}

export function serializeRemoteObject(obj: Protocol.Runtime.RemoteObject): string {
  if (obj.value !== undefined) {
    return typeof obj.value === "object" ? JSON.stringify(obj.value, null, 2) : String(obj.value);
  }
  return obj.description ?? "<unknown>";
}

export function formatLocation(stackTrace?: Protocol.Runtime.StackTrace): string | undefined {
  if (!stackTrace?.callFrames?.[0]) return undefined;
  const frame = stackTrace.callFrames[0];
  return `${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
}
