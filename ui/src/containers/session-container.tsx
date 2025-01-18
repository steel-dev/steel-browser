import SessionConsole from "@/components/sessions/session-console";
import { SessionViewer } from "@/components/sessions/session-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSessionsContext } from "@/hooks/use-sessions-context";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Link2Icon,
} from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

export function SessionContainer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { useSession } = useSessionsContext();
  const { data: session, isLoading, isError } = useSession(id!);
  const [showConsole, setShowConsole] = useState(true);
  const [mostRecentUrl, setMostRecentUrl] = useState("about:blank");
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      navigate("/login");
    }
  }, [session]);

  if (isLoading) return <div>Loading...</div>;
  if (isError || !session) return <div>Error</div>;

  return (
    <div className="flex flex-col items-center justify-center w-full h-full p-4 overflow-hidden">
      <div className="flex flex-col overflow-hidden items-center justify-center h-full w-full rounded-md bg-[var(--gray-2)] p-4 pt-2 gap-3">
        <div className="flex items-center justify-center w-full h-full gap-3 overflow-hidden">
          <div
            className={`flex flex-col items-center justify-center h-full flex-1 border border-[var(--gray-6)] rounded-md ${
              showConsole ? "w-2/3" : "w-full"
            }`}
          >
            <div className="flex flex-col items-center justify-center w-full p-4 text-primary">
              <div className="flex items-center justify-center w-full h-full">
                <Badge
                  variant="secondary"
                  className="text-primary bg-[var(--gray-3)] py-2 px-3 flex items-center justify-between min-w-[400px] max-w-[700px] hover:bg-[var(--gray-4)] ml-auto"
                >
                  <span className="ml-auto text-xs">
                    {mostRecentUrl.substring(0, 50)}
                  </span>
                  <div
                    className="flex items-center ml-auto hover:cursor-pointer"
                    onClick={() => {
                      window.open(mostRecentUrl, "_blank");
                    }}
                  >
                    <Link2Icon className="w-4 h-4" />
                  </div>
                </Badge>
                <Button
                  variant="secondary"
                  onClick={() => setShowConsole(!showConsole)}
                  className="text-primary bg-[var(--gray-3)] ml-auto px-3 rounded-lg"
                >
                  {showConsole ? (
                    <ArrowRightIcon className="w-4 h-4" />
                  ) : (
                    <ArrowLeftIcon className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
            <SessionViewer
              id={id!}
              showConsole={showConsole}
              setMostRecentUrl={setMostRecentUrl}
            />
          </div>
          {showConsole && (
            <div className="flex flex-col items-center justify-center w-1/3 h-full gap-2 overflow-hidden text-primary">
              <div className="flex flex-col items-center overflow-hidden justify-center w-full h-full border border-[var(--gray-6)] rounded-md">
                {session && <SessionConsole id={id!} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
