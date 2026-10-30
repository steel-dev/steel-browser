import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { SessionDetails } from "../api";
import { useLogs, type LogEntry } from "../hooks";
import { CopyButton } from "./copy-button";
import { ArrowDownIcon, CrossIcon, SearchIcon } from "./icons";
import { Logs } from "./logs";
import { Segmented } from "./segmented";

type Filter = "all" | "console" | "errors";

function matches({ event, summary }: LogEntry, filter: Filter, query: string) {
  if (filter === "console" && summary.kind !== "console") return false;
  if (filter === "errors" && summary.tone !== "red") return false;
  return (
    !query ||
    summary.message.toLowerCase().includes(query) ||
    event.type.toLowerCase().includes(query)
  );
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SessionConsole({ session, hidden }: { session: SessionDetails; hidden: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const input = useRef<HTMLInputElement>(null);
  const logs = useLogs();

  const visible = useMemo(
    () => logs.filter((entry) => matches(entry, filter, search)),
    [logs, filter, search],
  );
  const errorCount = useMemo(
    () => logs.filter((entry) => entry.summary.tone === "red").length,
    [logs],
  );
  const events = () => visible.map((entry) => entry.event);

  return (
    <section className="console" aria-label="Logs" hidden={hidden}>
      <div className="console-head" data-scrolled={scrolled}>
        <div className="console-bar">
          <Segmented
            label="Filter logs"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "console", label: "Console" },
              {
                value: "errors",
                label: (
                  <>
                    Errors
                    {errorCount > 0 && <span className="segment-count">{errorCount}</span>}
                  </>
                ),
              },
            ]}
          />
          <div className="console-actions">
            <CopyButton
              className="round-button"
              value={() => JSON.stringify(events(), null, 2)}
              label="Copy logs"
              disabled={visible.length === 0}
            />
            <button
              type="button"
              className="round-button"
              aria-label="Download logs"
              title="Download logs"
              disabled={visible.length === 0}
              onClick={() =>
                downloadJson(`steel-session-${session.id.slice(0, 8)}-logs.json`, events())
              }
            >
              <ArrowDownIcon />
            </button>
          </div>
        </div>
        <div className="console-search">
          <div className="search-field">
            <SearchIcon />
            <input
              ref={input}
              className="search-input"
              type="search"
              value={query}
              placeholder="Search logs"
              aria-label="Search logs"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              >
                <CrossIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      <Logs
        entries={visible}
        empty={logs.length === 0 ? "Waiting for browser events…" : "No logs match."}
        onScrolledChange={setScrolled}
      />
    </section>
  );
}
