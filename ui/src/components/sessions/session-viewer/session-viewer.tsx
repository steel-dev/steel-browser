import { useSessionsContext } from "@/hooks/use-sessions-context";
import { useEffect, useRef, useState } from "react";
import rrwebPlayer from "rrweb-player";
import "./session-viewer-controls.css";
import { LoadingSpinner } from "@/components/icons/LoadingSpinner";
import { LiveEmptyState } from "./live-empty-state";
import { env } from "@/env";

type SessionViewerProps = {
  id: string;
  showConsole?: boolean;
  setMostRecentUrl: (url: string) => void;
};

export function SessionViewer({
  id,
  showConsole,
  setMostRecentUrl,
}: SessionViewerProps) {
  const { useSession } = useSessionsContext();
  const {
    data: session,
    isLoading: isSessionLoading,
    isError: isSessionError,
  } = useSession(id);

  const playerRef = useRef<rrwebPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerCreatedRef = useRef(false);

  const [events, setEvents] = useState<any[]>([]);
  const [hasEvents, setHasEvents] = useState(false);

  useEffect(() => {
    let hasEvents = false;
    let maxTimestamp = 0;
    let firstUrl = "";
    for (const event of events) {
      if (event.type === 4 && event.data.href !== "about:blank") {
        hasEvents = true;
        if (event.timestamp > maxTimestamp) {
          maxTimestamp = event.timestamp;
          if (!firstUrl) firstUrl = event.data.href;
        }
      }
    }
    setHasEvents(hasEvents);
    if (firstUrl) setMostRecentUrl(firstUrl);

    if (
      hasEvents &&
      !playerCreatedRef.current &&
      !isSessionLoading &&
      !isSessionError &&
      containerRef.current
    ) {
      playerRef.current = new rrwebPlayer({
        target: containerRef.current,
        props: {
          events,
          autoPlay: true,
          skipInactive: true,
          liveMode: session?.status === "live",
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          mouseTail: false,
          showController: session?.status !== "live",
        },
      });
      if (session?.status === "live") {
        // @ts-expect-error play doesn't accept a timestamp in ts
        playerRef.current.play(Date.now() - events[0].timestamp);
      }
      playerCreatedRef.current = true;
      playerRef.current.addEventListener("event-cast", (event) => {
        if (event.type === 4 && event.data.href !== "about:blank") {
          setMostRecentUrl(event.data.href);
        }
      });
    }
  }, [events, session, isSessionLoading, isSessionError]);

  useEffect(() => {
    const updateSize = () => {
      if (playerRef.current && containerRef.current) {
        // @ts-expect-error $set doesn't exist in ts
        playerRef.current.$set({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight - 80,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [showConsole]);

  useEffect(() => {
    if (!isSessionLoading && !isSessionError) {
      if (session?.status === "live") {
        const connectWebSocket = async () => {
          const ws = new WebSocket(`${env.VITE_WS_URL}/v1/sessions/recording`);

          ws.onmessage = (message) => {
            const events = JSON.parse(message.data);
            if (playerRef.current) {
              events.forEach((event) => {
                playerRef.current!.addEvent(event);
              });
            } else {
              setEvents((prevEvents) => [...prevEvents, ...events]);
            }
          };

          return ws;
        };

        let ws: WebSocket;
        connectWebSocket().then((socket) => {
          ws = socket;
        });

        return () => {
          if (ws) ws.close();
        };
      }
    }
  }, [session, id, isSessionLoading, isSessionError]);

  const isLive = session?.status === "live";

  if (isSessionLoading)
    return (
      <div
        ref={containerRef}
        className="flex flex-col w-full flex-1 border-t border-[var(--gray-6)]"
      >
        <div className="flex flex-col items-center justify-center flex-1 w-full">
          <LoadingSpinner className="w-16 h-16 text-[var(--gray-6)]" />
        </div>
      </div>
    );
  if (isSessionError)
    return (
      <div
        ref={containerRef}
        className="flex flex-col w-full flex-1 border-t border-[var(--gray-6)]"
      >
        <h1 className="text-[var(--tomato-5)]">Error loading session</h1>
      </div>
    );

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full flex-1 border-t border-[var(--gray-6)]"
    >
      {!hasEvents && isLive && <LiveEmptyState session={session!} />}
    </div>
  );
}
