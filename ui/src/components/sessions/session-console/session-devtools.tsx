// import { useSessionsContext } from "@/hooks/use-sessions-context";

import { useEffect, useState } from "react";

export default function SessionDevTools() {
  const [pageId, setPageId] = useState<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(
      `${import.meta.env.VITE_API_URL}/v1/sessions/pageId`
    );

    ws.onmessage = (event) => {
      setPageId(event.data.pageId);
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!pageId) return;

    const iframe = document.querySelector("iframe");
    if (iframe) {
      iframe.src = iframe.src + "";
    }
  }, [pageId]);

  return (
    <iframe
      src={`${import.meta.env.VITE_API_URL}/v1/devtools/inspector.html${
        pageId ? `?pageId=${pageId}` : ""
      }`}
      className="w-full h-full"
    />
  );
}