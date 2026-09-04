import { env } from "@/env";
import { useEffect, useState, useRef } from "react";

export default function SessionLogs({ id }: { id: string }) {
  const [logs, setLogs] = useState<any[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const connectWebSocket = async () => {
      const ws = new WebSocket(`${env.VITE_WS_URL}/v1/sessions/logs`);

      ws.onmessage = (event) => {
        const logs = JSON.parse(event.data);
        setLogs((prevLogs) =>
          [...prevLogs, ...logs].sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          )
        );
      };

      return () => {
        ws.close();
      };
    };
    connectWebSocket();
  }, [id]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);
  const logTypeToColor = (type: string) => {
    if (type === "Console") return "var(--cyan-a11)";
    if (type === "Request") return "var(--pink-a11)";
    if (type === "Response") return "var(--green-a11)";
    if (type === "Error") return "var(--red-a11)";
    return "var(--gray-11)";
  };

  // Two record shapes reach this component:
  //  - the CDP instrumentation nests the payload under a key named after the event type
  //    (`console`, `request`, `response`, ... — see api/src/services/cdp/instrumentation/types.ts)
  //  - selenium.service.ts still sends the payload as a JSON string on `text`
  // Reading `text` unconditionally made `JSON.parse(undefined)` throw on every CDP record,
  // which unmounted the whole tab. ExtensionEvent is flat, so falling back to the record
  // itself keeps `message`/`logLevel` reachable.
  const logToBody = (log: Record<string, any>): Record<string, any> => {
    if (typeof log.text === "string") {
      try {
        return JSON.parse(log.text);
      } catch {
        return { message: log.text };
      }
    }
    return (
      log.console ??
      log.request ??
      log.response ??
      log.responseBody ??
      log.navigation ??
      log.error ??
      log.interaction ??
      log.data ??
      log.cdp ??
      log
    );
  };

  const logTypeToFormat = (type: string, log: Record<string, any>) => {
    if (type === "Console") {
      if (log.message) {
        return log.message
          .replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+(INFO|WARN|ERROR|DEBUG)\s+/, "")
          .replace("\n", "")
          .replace("\t", "");
      }
      return log.text;
    }
    if (type === "Request") return `[${log.method}] ${log.url}`;
    if (type === "Response") return `[${log.status}] ${log.url}`;
    if (type === "Error") return log.message;
    if (type === "Navigation") return log.url || JSON.stringify(log);
    return log.message || JSON.stringify(log);
  };

  return (
    <div
      ref={consoleRef}
      className="w-full h-full overflow-y-auto overflow-x-scroll bg-[var(--gray-2)] p-2 font-mono text-xs flex flex-col"
    >
      {logs.length === 0 && <p className="text-gray-400">No new logs...</p>}
      {logs &&
        logs.slice(-40).map((log) => {
          const logBody = logToBody(log);
          const cleanMessage = logTypeToFormat(log.type, logBody);

          return (
            <pre key={log.id} className="text-overflow-ellipsis mb-1">
              <span className="text-gray-400">
                {new Date(log.timestamp).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </span>{" "}
              <span style={{ color: logTypeToColor(log.type) }}>
                [{log.type}]
              </span>{" "}
              {cleanMessage}
            </pre>
          );
        })}
    </div>
  );
}
