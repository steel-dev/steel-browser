import { useSessionsContext } from "@/hooks/use-sessions-context";
import { useRef } from "react";
import "./session-viewer-controls.css";
import { LoadingSpinner } from "@/components/icons/LoadingSpinner";

type SessionViewerProps = {
  id: string;
};

export function SessionViewer({ id }: SessionViewerProps) {
  const { useSession } = useSessionsContext();
  const {
    data: session,
    isLoading: isSessionLoading,
    isError: isSessionError,
  } = useSession(id);

  const containerRef = useRef<HTMLDivElement>(null);

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
    >
      <iframe
        src={session?.debugUrl}
        sandbox="allow-same-origin allow-scripts"
        className="w-full max-h-full aspect-[16/10] border border-[var(--gray-6)]"
      />
    </div>
  );
}
