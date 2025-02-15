import { ChevronRightIcon } from "@radix-ui/react-icons";
import { Badge } from "@/components/ui/badge";
import { GlowingGreenDot } from "@/components/icons/GlowingGreenDot";
import { useSessionsContext } from "@/hooks/use-sessions-context";
import { SteelIcon } from "../icons/SessionIcon";
import { Link } from "react-router-dom";

export const Header = () => {
  const { pathname } = window.location;
  const currentSessionId =
    pathname.includes("sessions") && pathname.split("/").pop() !== "sessions"
      ? pathname.split("/").pop()
      : null;

  const { useSession } = useSessionsContext();
  const { data: session, isLoading } = useSession(currentSessionId!);

  return (
    <header className="flex justify-between items-center pl-3 pr-10 h-20 w-full">
      <div className="flex-1"></div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="flex items-center gap-3">
          {currentSessionId ? (
            <>
              <SteelIcon />
              Session
            </>
          ) : (
            <>
              <SteelIcon />
              Session
            </>
          )}
        </div>
        {currentSessionId && (
          <>
            <ChevronRightIcon />
            <div className="flex items-center gap-1.5 text-primary">
              <span className="text-sm font-mono">
                #{currentSessionId.split("-")[0]}
              </span>
              {!isLoading && session?.status === "live" && (
                <Badge
                  variant="secondary"
                  className="text-[var(--green-a12)] border border-[var(--green-6)] bg-transparent gap-2 py-0.5 px-2.5 mb-0.5 flex items-center justify-between max-w-fit rounded-full"
                >
                  <GlowingGreenDot />
                  Live
                </Badge>
              )}
            </div>
          </>
        )}
      </div>
      <nav className="flex-1 flex justify-end">
        <div className="flex gap-2 items-center">
          <Link
            to="/playground"
            className="rounded-md opacity-90 bg-transparent flex h-10 px-4 justify-center items-center gap-3 text-primary hover:bg-[rgba(238,206,254,0.13)] font-inter text-base font-normal leading-6 cursor-pointer"
          >
            Playground
          </Link>
          <a
            href="https://docs.steel.dev"
            target="_blank"
            className="rounded-md opacity-90 bg-transparent flex h-10 px-4 justify-center items-center gap-3 text-primary hover:bg-[rgba(238,206,254,0.13)] font-inter text-base font-normal leading-6 cursor-pointer"
          >
            Docs
          </a>
          <a
            href="https://discord.gg/steel-dev"
            target="_blank"
            className="rounded-md opacity-90 bg-transparent flex h-10 px-4 justify-center items-center gap-3 text-primary hover:bg-[rgba(238,206,254,0.13)] font-inter text-base font-normal leading-6 cursor-pointer"
          >
            Discord
          </a>
        </div>
      </nav>
    </header>
  );
};
