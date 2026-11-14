import SessionConsole from "@/components/sessions/session-console";
import { SessionViewer } from "@/components/sessions/session-viewer";
import { Button } from "@/components/ui/button";
import { useSessionsContext } from "@/hooks/use-sessions-context";
import { ArrowLeftIcon, ArrowRightIcon } from "@radix-ui/react-icons";
import { useState } from "react";
import { useParams } from "react-router-dom";

export function SessionContainer() {
  const { id } = useParams();

  const { useSession } = useSessionsContext();
  const { data: session, isLoading, isError } = useSession(id!);
  const [showConsole, setShowConsole] = useState(true);
  if (isLoading) return <div>Loading...</div>;
  if (isError || !session) return <div>Error</div>;

  // On the id-less route the query resolves to the first session, so take the
  // id from the resolved session rather than passing undefined to children.
  const sessionId = id ?? session.id;

  return (
    <div className="flex flex-col overflow-hidden items-center justify-center h-full w-full p-4">
      <div className="flex flex-col overflow-hidden items-center justify-center h-full w-full rounded-md bg-[var(--gray-2)] p-4 pt-2 gap-3">
        <div className="flex items-center overflow-hidden justify-center h-full w-full gap-3">
          <div
            className={`flex flex-col items-center justify-center h-full flex-1 border border-[var(--gray-6)] relative rounded-md ${
              showConsole ? "w-2/3" : "w-full"
            }`}
          >
            <Button
              variant="secondary"
              onClick={() => setShowConsole(!showConsole)}
              className="text-primary bg-[var(--gray-3)] ml-auto px-3 rounded-lg absolute top-2 right-2"
            >
              {showConsole ? (
                <ArrowRightIcon className="w-4 h-4" />
              ) : (
                <ArrowLeftIcon className="w-4 h-4" />
              )}
            </Button>
            <SessionViewer id={sessionId} />
          </div>
          {showConsole && (
            <div className="flex flex-col items-center overflow-hidden w-1/3 justify-center h-full text-primary gap-2">
              <div className="flex flex-col items-center overflow-hidden justify-center w-full h-full border border-[var(--gray-6)] rounded-md overflow-hidden">
                <SessionConsole id={sessionId} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
