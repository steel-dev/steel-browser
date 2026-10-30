import type { ReactNode } from "react";
import { useCopy } from "../hooks";
import { CheckIcon, CopyIcon } from "./icons";

export function CopyButton({
  value,
  label,
  className,
  disabled,
  children,
}: {
  value: string | (() => string);
  label: string;
  className: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      className={className}
      aria-label={children ? undefined : label}
      title={label}
      data-copied={copied}
      disabled={disabled}
      onClick={() => void copy(value)}
    >
      {children}
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
