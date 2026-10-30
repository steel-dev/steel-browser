import type { Tone } from "../format";
import {
  ArrowUpRightIcon,
  BookIcon,
  BranchIcon,
  ChatIcon,
  RailIcon,
  SteelLogo,
  WindowIcon,
} from "./icons";

export type ApiStatus = "connecting" | "online" | "reconnecting" | "offline";

const problems: Partial<Record<ApiStatus, { label: string; tone: Tone }>> = {
  reconnecting: { label: "Reconnecting to the API…", tone: "yellow" },
  offline: { label: "Can't reach the API", tone: "red" },
};

const links = [
  { href: "https://docs.steel.dev", label: "Docs", icon: BookIcon },
  { href: "https://discord.gg/steel-dev", label: "Discord", icon: ChatIcon },
  { href: "https://github.com/steel-dev/steel-browser", label: "GitHub", icon: BranchIcon },
];

export function Rail({ status, onCollapse }: { status: ApiStatus; onCollapse: () => void }) {
  const problem = problems[status];

  return (
    <aside className="rail" aria-label="Sidebar">
      <div className="rail-head">
        <SteelLogo
          className="rail-logo"
          role="img"
          aria-hidden={false}
          aria-label="Steel Browser"
        />
        <button
          type="button"
          className="bar-button"
          aria-label="Collapse sidebar"
          aria-expanded={true}
          title="Collapse sidebar"
          onClick={onCollapse}
        >
          <RailIcon />
        </button>
      </div>
      <nav className="rail-nav" aria-label="Main">
        <div className="rail-group">
          <p className="rail-group-title">Browsers</p>
          <div className="rail-items">
            <a className="rail-item" href={import.meta.env.BASE_URL} aria-current="page">
              <WindowIcon />
              <span className="rail-item-label">Sessions</span>
            </a>
          </div>
        </div>
        <div className="rail-group">
          <p className="rail-group-title">External</p>
          <div className="rail-items">
            {links.map(({ href, label, icon: Icon }) => (
              <a key={href} className="rail-item" href={href} target="_blank" rel="noreferrer">
                <Icon />
                <span className="rail-item-label">{label}</span>
                <ArrowUpRightIcon className="rail-item-trail" />
              </a>
            ))}
          </div>
        </div>
      </nav>
      {problem && (
        <div className="rail-foot">
          <div className="api-status" role="status" data-tone={problem.tone}>
            <span className="api-status-dot" />
            {problem.label}
          </div>
        </div>
      )}
    </aside>
  );
}
