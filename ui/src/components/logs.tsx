import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
  type UIEvent,
} from "react";
import { formatTime, type LogKind } from "../format";
import type { LogEntry } from "../hooks";
import {
  ActivityIcon,
  AlertIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  CodeIcon,
  GlobeIcon,
  PointerIcon,
  TerminalIcon,
  XCircleIcon,
} from "./icons";

const icons: Record<LogKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  console: TerminalIcon,
  request: ArrowUpRightIcon,
  response: ArrowDownLeftIcon,
  navigation: GlobeIcon,
  error: AlertIcon,
  failed: XCircleIcon,
  interaction: PointerIcon,
  cdp: CodeIcon,
  other: ActivityIcon,
};

const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const { event, summary } = entry;
  const Icon = icons[summary.kind];

  return (
    <details className="log" onToggle={(toggle) => setOpen(toggle.currentTarget.open)}>
      <summary className="log-row" data-tone={summary.tone}>
        <span className="log-icon" role="img" aria-label={event.type} title={event.type}>
          <Icon />
        </span>
        <span className="log-message">{summary.message}</span>
        <span className="log-time">{formatTime(event.timestamp)}</span>
        <ChevronDownIcon className="log-chevron" />
      </summary>
      {open && <pre className="log-json">{JSON.stringify(event, null, 2)}</pre>}
    </details>
  );
});

export const Logs = memo(function Logs({
  entries,
  empty,
  onScrolledChange,
}: {
  entries: LogEntry[];
  empty: string;
  onScrolledChange: (scrolled: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const element = list.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [entries]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    onScrolledChange(element.scrollTop > 0);
  };

  return (
    <div ref={list} className="logs" role="log" aria-live="off" onScroll={onScroll}>
      {entries.length === 0 ? (
        <p className="logs-empty">{empty}</p>
      ) : (
        entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
      )}
    </div>
  );
});
