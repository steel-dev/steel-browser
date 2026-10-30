import type { ReactNode } from "react";

export function Notice({
  title,
  busy = false,
  children,
}: {
  title: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="notice" role={busy ? "status" : undefined}>
      {busy && <span className="spinner" />}
      <h2 className="notice-title">{title}</h2>
      {children && <p className="notice-body">{children}</p>}
    </div>
  );
}
