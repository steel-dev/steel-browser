import { unpack } from "@rrweb/packer/unpack";
import { EventType, Replayer } from "rrweb";
import "rrweb/dist/style.css";
import { useEffect, useRef, useState } from "react";
import { getRecording, type RecordedEvent } from "../api";
import { formatDuration } from "../format";
import { PauseIcon, PlayIcon } from "./icons";
import { Notice } from "./notice";
import { Segmented } from "./segmented";

type Tab = {
  id: string;
  href: string;
  events: RecordedEvent[];
};

type RecordingState = {
  status: "loading" | "ready" | "unavailable";
  truncated: boolean;
};

function pageHref(event: RecordedEvent | undefined): string | null {
  if (event === undefined) return null;
  try {
    const unpacked = typeof event === "string" ? unpack(event) : event;
    return unpacked.type === EventType.Meta ? unpacked.data.href : null;
  } catch {
    return null;
  }
}

function useRecording(sessionId: string, intervalMs = 1000) {
  const tabs = useRef<Tab[]>([]);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<RecordingState>({ status: "loading", truncated: false });

  useEffect(() => {
    const controller = new AbortController();
    let after = 0;
    let timer: number | undefined;
    tabs.current = [];

    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const page = await getRecording(sessionId, after, controller.signal);
          if (!page) {
            setState({ status: "unavailable", truncated: false });
            return;
          }
          after = page.next;
          for (const batch of page.batches) {
            const id = String(batch.tabId);
            let tab = tabs.current.find((candidate) => candidate.id === id);
            if (!tab) {
              const href = pageHref(batch.events[0]);
              if (href === null) continue;
              tab = { id, href, events: [] };
              tabs.current.push(tab);
            }
            for (const event of batch.events) tab.events.push(event);
          }
          if (page.batches.length > 0) setVersion((value) => value + 1);
          setState({ status: "ready", truncated: page.truncated });
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, intervalMs);
    };

    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sessionId, intervalMs]);

  return { tabs: tabs.current, version, ...state };
}

function Player({
  events,
  version,
  truncated,
}: {
  events: RecordedEvent[];
  version: number;
  truncated: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);
  const fed = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const current = replayer.current;
    if (current) {
      for (const event of events.slice(fed.current)) current.addEvent(event);
    } else if (root.current) {
      const created = new Replayer(events, {
        root: root.current,
        unpackFn: unpack,
        mouseTail: false,
        showWarning: false,
      });
      created.on("resize", (dimension) => setSize(dimension as { width: number; height: number }));
      created.on("finish", () => setPlaying(false));
      created.pause(0);
      replayer.current = created;
    }
    fed.current = events.length;
    void Promise.resolve().then(() => setTotal(replayer.current?.getMetaData().totalTime ?? 0));
  }, [events, version]);

  useEffect(
    () => () => {
      replayer.current?.destroy();
      replayer.current = null;
    },
    [],
  );

  useEffect(() => {
    const element = viewport.current;
    if (!element || size.width === 0 || size.height === 0) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / size.width, height / size.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [size]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (replayer.current) setTime(replayer.current.getCurrentTime());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const current = replayer.current;
    if (!current) return;
    if (playing) {
      current.pause();
      setTime(current.getCurrentTime());
      setPlaying(false);
    } else {
      current.play(time >= total ? 0 : time);
      setPlaying(true);
    }
  };

  const seek = (offset: number) => {
    const current = replayer.current;
    if (!current) return;
    if (playing) current.play(offset);
    else current.pause(offset);
    setTime(offset);
  };

  const playLabel = playing ? "Pause" : "Play";

  return (
    <>
      <div ref={viewport} className="replay-viewport">
        <div
          ref={root}
          className="replay-root"
          style={{
            width: size.width,
            height: size.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        />
      </div>
      <div className="replay-controls">
        <button
          type="button"
          className="round-button"
          aria-label={playLabel}
          title={playLabel}
          onClick={toggle}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <input
          type="range"
          className="replay-scrubber"
          aria-label="Seek"
          min={0}
          max={total}
          step={10}
          value={Math.min(time, total)}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="replay-time">
          {formatDuration(time)} / {formatDuration(total)}
        </span>
        {truncated && (
          <span className="replay-note" title="The API stopped keeping events for this session.">
            Size limit reached
          </span>
        )}
      </div>
    </>
  );
}

export function Replay({ sessionId }: { sessionId: string }) {
  const { tabs, version, status, truncated } = useRecording(sessionId);
  const [selected, setSelected] = useState<string | null>(null);
  const tab = tabs.find((candidate) => candidate.id === selected) ?? tabs[0];

  if (status === "loading") {
    return (
      <div className="player">
        <Notice title="Loading recording" busy />
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="player">
        <Notice title="No replay">The API has no recording for this session.</Notice>
      </div>
    );
  }

  if (!tab || tab.events.length < 2) {
    return (
      <div className="player">
        <Notice title="Nothing recorded yet">
          Steel records pages in headless sessions. They show up here once a page loads.
        </Notice>
      </div>
    );
  }

  return (
    <div className="player replay">
      {tabs.length > 1 && (
        <div className="replay-tabs">
          <Segmented
            label="Recorded tabs"
            value={tab.id}
            onChange={setSelected}
            options={tabs.map(({ id, href }, index) => ({
              value: id,
              label: <span title={href}>Tab {index + 1}</span>,
            }))}
          />
        </div>
      )}
      <Player key={tab.id} events={tab.events} version={version} truncated={truncated} />
    </div>
  );
}
