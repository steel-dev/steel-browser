import type { SessionDetails } from "../api";
import { CopyButton } from "./copy-button";
import { ChevronRightIcon, ConsoleIcon, DevToolsIcon, RailIcon, ReplayIcon } from "./icons";
import { NewSessionButton } from "./new-session";
import { ReleaseButton } from "./release-button";

export function TopBar({
  session,
  railOpen,
  onToggleRail,
  consoleOpen,
  onToggleConsole,
  replayOpen,
  onToggleReplay,
  devtoolsOpen,
  onToggleDevtools,
  onSessionChange,
}: {
  session: SessionDetails | null | undefined;
  railOpen: boolean;
  onToggleRail: () => void;
  consoleOpen: boolean;
  onToggleConsole: () => void;
  replayOpen: boolean;
  onToggleReplay: () => void;
  devtoolsOpen: boolean;
  onToggleDevtools: () => void;
  onSessionChange: () => void;
}) {
  const consoleLabel = consoleOpen ? "Hide logs" : "Show logs";
  const replayLabel = replayOpen ? "Show live view" : "Show replay";
  const devtoolsLabel = devtoolsOpen ? "Hide DevTools" : "Show DevTools";

  return (
    <header className="top-bar">
      {!railOpen && (
        <button
          type="button"
          className="bar-button rail-toggle"
          aria-label="Expand sidebar"
          aria-expanded={false}
          title="Expand sidebar"
          onClick={onToggleRail}
        >
          <RailIcon />
        </button>
      )}
      {session && (
        <button
          type="button"
          className="bar-button"
          aria-label={consoleLabel}
          aria-pressed={consoleOpen}
          title={consoleLabel}
          onClick={onToggleConsole}
        >
          <ConsoleIcon />
        </button>
      )}
      {session && (
        <button
          type="button"
          className="bar-button"
          aria-label={replayLabel}
          aria-pressed={replayOpen}
          title={replayLabel}
          onClick={onToggleReplay}
        >
          <ReplayIcon />
        </button>
      )}
      {session?.debugUrl && !replayOpen && (
        <button
          type="button"
          className="bar-button devtools-toggle"
          aria-label={devtoolsLabel}
          aria-pressed={devtoolsOpen}
          title={devtoolsLabel}
          onClick={onToggleDevtools}
        >
          <DevToolsIcon />
        </button>
      )}
      <nav className="crumbs" aria-label="Breadcrumb">
        <span className="crumb-parent">Sessions</span>
        {session && (
          <>
            <ChevronRightIcon className="crumb-sep" />
            <span className="crumb-current" aria-current="page" title={session.id}>
              {session.id}
            </span>
            <CopyButton className="crumb-copy" value={session.id} label="Copy session ID" />
          </>
        )}
      </nav>
      {session && (
        <div className="top-bar-actions">
          {session.status === "live" && (
            <ReleaseButton sessionId={session.id} onReleased={onSessionChange} />
          )}
          <NewSessionButton onStarted={onSessionChange} />
        </div>
      )}
    </header>
  );
}
