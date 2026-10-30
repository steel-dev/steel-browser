import type { SessionDetails } from "../api";
import { formatBytes, formatDate, formatDuration, formatProxy } from "../format";
import { CopyButton } from "./copy-button";
import { CheckIcon, CrossIcon } from "./icons";

type Detail = {
  label: string;
  value: string | boolean;
  copy?: boolean;
};

function detailsFor(session: SessionDetails): Detail[] {
  const details: Detail[] = [{ label: "ID", value: session.id, copy: true }];

  if (session.websocketUrl) {
    details.push({ label: "WebSocket URL", value: session.websocketUrl, copy: true });
  }

  details.push(
    { label: "Started", value: formatDate(session.createdAt) },
    { label: "Duration", value: formatDuration(session.duration) },
    { label: "Timeout", value: session.timeout > 0 ? formatDuration(session.timeout) : "None" },
    {
      label: "Viewport",
      value: session.dimensions
        ? `${session.dimensions.width} × ${session.dimensions.height}`
        : "Default",
    },
    { label: "User agent", value: session.userAgent || "Default", copy: !!session.userAgent },
    { label: "Proxy", value: session.proxy ? formatProxy(session.proxy) : "None" },
  );

  if (session.proxy) {
    const sent = formatBytes(session.proxyTxBytes);
    const received = formatBytes(session.proxyRxBytes);
    details.push({ label: "Proxy traffic", value: `${sent} sent, ${received} received` });
  }

  details.push(
    { label: "Solve captcha", value: Boolean(session.solveCaptcha) },
    { label: "Selenium", value: Boolean(session.isSelenium) },
  );

  return details;
}

function Bool({ on }: { on: boolean }) {
  return (
    <span className="bool" data-on={on} role="img" aria-label={on ? "On" : "Off"}>
      {on ? <CheckIcon /> : <CrossIcon />}
    </span>
  );
}

export function Details({ session }: { session: SessionDetails }) {
  return (
    <dl className="details-grid">
      {detailsFor(session).map(({ label, value, copy }) => (
        <div key={label} className="detail-card">
          <dt>{label}</dt>
          <dd>
            {typeof value === "boolean" ? (
              <Bool on={value} />
            ) : copy ? (
              <CopyButton className="detail-copy" value={value} label={`Copy ${label}`}>
                <span className="detail-value">{value}</span>
              </CopyButton>
            ) : (
              <span className="detail-value" title={value}>
                {value}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
