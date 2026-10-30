import type { CreateSession, MultipleSessions, ReleaseSession, SessionDetails } from "./client";

export type { SessionDetails };

const apiBase = import.meta.env.VITE_API_URL ?? "/api";
const wsBase = import.meta.env.VITE_WS_URL ?? "/ws";

export function apiUrl(path: string): string {
  return new URL(`${apiBase}${path}`, window.location.href).toString();
}

export function wsUrl(path: string): string {
  const url = new URL(`${wsBase}${path}`, window.location.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  return url.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : `Request to ${path} failed with ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export async function getActiveSession(signal: AbortSignal): Promise<SessionDetails | null> {
  const { sessions } = await request<MultipleSessions>("/v1/sessions", { signal });
  return sessions[0] ?? null;
}

export function createSession(body: CreateSession): Promise<SessionDetails> {
  return request<SessionDetails>("/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function releaseSession(id: string): Promise<ReleaseSession> {
  return request<ReleaseSession>(`/v1/sessions/${encodeURIComponent(id)}/release`, {
    method: "POST",
  });
}
