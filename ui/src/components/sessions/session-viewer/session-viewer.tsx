import { useSessionsContext } from "@/hooks/use-sessions-context";
import { useRef, useEffect, useCallback } from "react";
import "./session-viewer-controls.css";
import { LoadingSpinner } from "@/components/icons/LoadingSpinner";

type SessionViewerProps = {
  id: string;
};

let clipboardBridgeActive = false;

export function SessionViewer({ id }: SessionViewerProps) {
  const { useSession } = useSessionsContext();
  const {
    data: session,
    isLoading: isSessionLoading,
    isError: isSessionError,
  } = useSession(id);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Clipboard bridge message handler
  const handleMessage = useCallback(async (event: MessageEvent) => {
    if (
      !iframeRef.current ||
      event.source !== iframeRef.current.contentWindow
    ) {
      return;
    }
    try {
      switch (event.data.type) {
        case "requestClipboardRead":
          try {
            const text = await navigator.clipboard.readText();
            iframeRef.current.contentWindow?.postMessage(
              {
                type: "clipboardReadResponse",
                text: text,
                requestId: event.data.requestId,
              },
              "*",
            );
          } catch (error) {
            iframeRef.current.contentWindow?.postMessage(
              {
                type: "clipboardReadResponse",
                error: "Failed to read clipboard",
                requestId: event.data.requestId,
              },
              "*",
            );
          }
          break;

        case "requestClipboardWrite":
          try {
            await navigator.clipboard.writeText(event.data.text);
            iframeRef.current.contentWindow?.postMessage(
              {
                type: "clipboardWriteResponse",
                success: true,
                requestId: event.data.requestId,
              },
              "*",
            );
          } catch (error) {
            iframeRef.current.contentWindow?.postMessage(
              {
                type: "clipboardWriteResponse",
                success: false,
                error: "Failed to write to clipboard",
                requestId: event.data.requestId,
              },
              "*",
            );
          }
          break;

        case "clipboardBridgeReady":
          break;
      }
    } catch (error) {
      console.error("Error handling clipboard bridge message:", error);
    }
  }, []);

  // Global keyboard event handler for copy/paste
  const handleKeyDown = useCallback(async (event: KeyboardEvent) => {
    // Only handle if our container is focused or contains the focused element
    if (!containerRef.current?.contains(document.activeElement)) {
      return;
    }

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isCtrlOrCmd && (event.key === "c" || event.key === "C")) {
      event.preventDefault();

      // Try to trigger copy from iframe
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          {
            type: "triggerCopy",
          },
          "*",
        );
      }
    } else if (isCtrlOrCmd && (event.key === "v" || event.key === "V")) {
      event.preventDefault();

      try {
        const text = await navigator.clipboard.readText();

        if (text && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            {
              type: "triggerPaste",
              text: text,
            },
            "*",
          );
        }
      } catch (error) {
        console.error("Failed to read clipboard for paste:", error);
      }
    }
  }, []);

  // Set up event listeners
  useEffect(() => {
    if (!clipboardBridgeActive) {
      window.addEventListener("message", handleMessage);
      document.addEventListener("keydown", handleKeyDown, true);
      clipboardBridgeActive = true;
    }

    return () => {
      // Don't remove global listeners - they should persist across component re-renders
    };
  }, [handleMessage, handleKeyDown]);

  // Make container focusable and handle clicks
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = () => {
      container.focus();
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, []);

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
      className="flex flex-col w-full overflow-hidden flex-1 border-t border-[var(--gray-6)]"
      tabIndex={0}
      style={{ outline: "none" }}
    >
      <iframe
        ref={iframeRef}
        src={`${session?.debugUrl}${
          session?.debugUrl?.includes("?") ? "&" : "?"
        }clipboardBridge=true`}
        sandbox="allow-same-origin allow-scripts allow-clipboard-write allow-clipboard-read"
        className="w-full max-h-full aspect-[16/10] border border-[var(--gray-6)]"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
