import { useState } from "react";
import { Notice } from "./components/notice";
import { Rail, type ApiStatus } from "./components/rail";
import { SessionConsole } from "./components/session-console";
import { Stage } from "./components/stage";
import { TopBar } from "./components/top-bar";
import { useActiveSession, useShortcutKeys, useStoredToggle } from "./hooks";

export function App() {
  const { session, error, refresh } = useActiveSession();
  const [railOpen, toggleRail] = useStoredToggle("steel-browser:rail", true);
  const [consoleOpen, toggleConsole] = useStoredToggle("steel-browser:console", true);
  const [devtoolsOpen, toggleDevtools] = useStoredToggle("steel-browser:devtools", false);
  const [replayOpen, setReplayOpen] = useState(false);
  useShortcutKeys();

  const status: ApiStatus = error
    ? session
      ? "reconnecting"
      : "offline"
    : session === undefined
    ? "connecting"
    : "online";

  return (
    <div className="shell" data-rail={railOpen ? "open" : "closed"}>
      {railOpen && <Rail status={status} onCollapse={toggleRail} />}
      <div className="body">
        <main className="panel">
          <TopBar
            session={session}
            railOpen={railOpen}
            onToggleRail={toggleRail}
            consoleOpen={consoleOpen}
            onToggleConsole={toggleConsole}
            replayOpen={replayOpen}
            onToggleReplay={() => setReplayOpen((open) => !open)}
            devtoolsOpen={devtoolsOpen}
            onToggleDevtools={toggleDevtools}
            onSessionChange={refresh}
          />
          {session ? (
            <div className="workspace">
              <SessionConsole key={session.id} session={session} hidden={!consoleOpen} />
              <Stage session={session} devtoolsOpen={devtoolsOpen} replayOpen={replayOpen} />
            </div>
          ) : error ? (
            <Notice title="Can't reach the Steel API">
              Make sure the API is running. This page reconnects on its own.
            </Notice>
          ) : session === null ? (
            <Notice title="No session">
              Start one with <code>POST /v1/sessions</code>.
            </Notice>
          ) : (
            <Notice title="Connecting" busy />
          )}
        </main>
      </div>
    </div>
  );
}
