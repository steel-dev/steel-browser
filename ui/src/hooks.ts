import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getActiveSession, wsUrl, type SessionDetails } from "./api";
import { describeEvent, isBrowserEvent, type BrowserEvent, type EventSummary } from "./format";

export type LogEntry = {
  id: number;
  event: BrowserEvent;
  summary: EventSummary;
};

type SessionState = {
  session: SessionDetails | null | undefined;
  error: string | null;
};

export function useActiveSession(intervalMs = 1000) {
  const [state, setState] = useState<SessionState>({ session: undefined, error: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const session = await getActiveSession(controller.signal);
          setState({ session, error: null });
        } catch (error) {
          if (controller.signal.aborted) return;
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, intervalMs);
    };

    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [intervalMs, version]);

  return { ...state, refresh };
}

export function useSocket(path: string, onMessage: (data: unknown) => void) {
  const onData = useEffectEvent(onMessage);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let timer: number | undefined;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl(path));
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        onData(data);
      };
      socket.onclose = () => {
        if (disposed) return;
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** attempt, 10_000));
        attempt += 1;
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [path]);
}

export function useLogs(limit = 1000) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const sequence = useRef(0);
  const pending = useRef<LogEntry[]>([]);
  const frame = useRef<number | null>(null);

  useSocket("/v1/sessions/logs", (data) => {
    const events = (Array.isArray(data) ? data : [data]).filter(isBrowserEvent);
    if (events.length === 0) return;
    const next = events.map((event) => ({
      id: (sequence.current += 1),
      event,
      summary: describeEvent(event),
    }));
    pending.current = [...pending.current, ...next].slice(-limit);
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const batch = pending.current;
      pending.current = [];
      setEntries((current) => [...current, ...batch].slice(-limit));
    });
  });

  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );

  return entries;
}

export function usePageId() {
  const [pageId, setPageId] = useState<string | null>(null);

  useSocket("/v1/sessions/pageId", (data) => {
    if (typeof data === "object" && data !== null && "pageId" in data) {
      if (typeof data.pageId === "string") setPageId(data.pageId);
    }
  });

  return pageId;
}

export function useStoredToggle(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      return;
    }
  }, [key, value]);

  const toggle = useCallback(() => setValue((current) => !current), []);
  return [value, toggle] as const;
}

export function useShortcutKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"))
        return;
      const scope = document.querySelector("dialog[open]") ?? document;
      const key = CSS.escape(event.key.toLowerCase());
      const control = Array.from(
        scope.querySelectorAll<HTMLButtonElement>(`[data-shortcut="${key}"]`),
      ).find((element) => !element.disabled && element.getClientRects().length > 0);
      if (!control) return;
      event.preventDefault();
      control.click();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

const darkScheme = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void) {
  const query = window.matchMedia(darkScheme);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useColorScheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeToScheme, () =>
    window.matchMedia(darkScheme).matches ? "dark" : "light",
  );
}

async function writeClipboard(text: string) {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), resetMs);
    return () => window.clearTimeout(timer);
  }, [copied, resetMs]);

  const copy = useCallback(async (text: string | (() => string)) => {
    try {
      await writeClipboard(typeof text === "function" ? text() : text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  return { copied, copy };
}
