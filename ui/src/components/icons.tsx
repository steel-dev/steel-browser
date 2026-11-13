import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon(props: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5" />
      <path d="M10.25 5.75v-1.5a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7.25" cy="7.25" r="4.25" />
      <path d="m10.5 10.5 3 3" />
    </Icon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 4.5h6v6" />
      <path d="m11.5 4.5-7 7" />
    </Icon>
  );
}

export function ArrowDownLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 11.5h-6v-6" />
      <path d="m4.5 11.5 7-7" />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10" />
      <path d="m4 9 4 4 4-4" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </Icon>
  );
}

export function RailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
      <path d="M6.25 2.75v10.5" />
    </Icon>
  );
}

export function ConsoleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
      <rect x="4.5" y="5" width="2.5" height="6" rx="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function DevToolsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
      <rect x="4.5" y="9" width="7" height="2.25" rx="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function WindowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
      <path d="M2.25 6h11.5" />
      <path d="M4.6 4.4h.01M6.3 4.4h.01" />
    </Icon>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 4.5C6.7 3.5 5 3 2.75 3v9.5c2.25 0 3.95.5 5.25 1.5 1.3-1 3-1.5 5.25-1.5V3C11 3 9.3 3.5 8 4.5Z" />
      <path d="M8 4.5V14" />
    </Icon>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.25 7.75c0 2.9-2.35 4.75-5.25 4.75-.8 0-1.56-.14-2.24-.4L2.75 13l.86-2.36a4.4 4.4 0 0 1-.86-2.89C2.75 4.85 5.1 3 8 3s5.25 1.85 5.25 4.75Z" />
    </Icon>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="4.5" cy="3.75" r="1.25" />
      <circle cx="4.5" cy="12.25" r="1.25" />
      <circle cx="11.5" cy="5.25" r="1.25" />
      <path d="M4.5 5v6" />
      <path d="M11.5 6.5c0 2.5-2.5 3-7 4.5" />
    </Icon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
      <path d="m5 6.5 1.75 1.5L5 9.5" />
      <path d="M8.5 9.5H11" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.13 3.25a1 1 0 0 1 1.74 0l5.06 8.75a1 1 0 0 1-.87 1.5H2.94a1 1 0 0 1-.87-1.5l5.06-8.75Z" />
      <path d="M8 6.75v2.5" />
      <path d="M8 11.25h.01" />
    </Icon>
  );
}

export function XCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="m6 6 4 4M10 6l-4 4" />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.25 8h11.5" />
      <path d="M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75C6.4 12.15 5.6 10.25 5.6 8S6.4 3.85 8 2.25Z" />
    </Icon>
  );
}

export function PointerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 2.75 9 4-3.9 1.35L7.25 12 3.5 2.75Z" />
    </Icon>
  );
}

export function CodeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5.5 5-3 3 3 3" />
      <path d="m10.5 5 3 3-3 3" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 8h2.5L6 4l4 8 1.5-4H14" />
    </Icon>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.25 8a5.75 5.75 0 1 0 1.7-4.07L2.25 5.6" />
      <path d="M2.25 2.75V5.6H5.1" />
      <path d="M8 5v3l2 1.25" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M5 3.9v8.2a.75.75 0 0 0 1.14.64l6.6-4.1a.75.75 0 0 0 0-1.28l-6.6-4.1A.75.75 0 0 0 5 3.9Z"
        fill="currentColor"
        stroke="none"
      />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3.5" width="2.75" height="9" rx="0.75" fill="currentColor" stroke="none" />
      <rect x="9.25" y="3.5" width="2.75" height="9" rx="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function SteelLogo(props: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 39.9639 39.9639"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M36.9898 39.9639C38.0308 39.9639 38.5513 39.9639 38.9489 39.7613C39.2987 39.5831 39.5831 39.2987 39.7613 38.9489C39.9639 38.5513 39.9639 38.0308 39.9639 36.9898L39.9639 2.97406C39.9639 1.93304 39.9639 1.41253 39.7613 1.01492C39.5831 0.665164 39.2987 0.380806 38.949 0.202599C38.5513 3.11805e-06 38.0308 3.07255e-06 36.9898 2.98154e-06L2.97406 7.78848e-09C1.93304 -8.32201e-08 1.41253 -1.28724e-07 1.01492 0.202595C0.665166 0.380803 0.380808 0.665161 0.2026 1.01491C4.58068e-06 1.41253 4.53518e-06 1.93304 4.44417e-06 2.97405L1.47042e-06 36.9898C1.37941e-06 38.0308 1.33391e-06 38.5513 0.202597 38.9489C0.380805 39.2987 0.665162 39.5831 1.01492 39.7613C1.41253 39.9639 1.93304 39.9639 2.97406 39.9639L36.9898 39.9639ZM34.7682 6.66065C35.7464 6.66065 36.2355 6.66065 36.5578 6.86528C36.8399 7.04442 37.0432 7.32439 37.1261 7.64814C37.2208 8.01795 37.0693 8.48299 36.7662 9.41307L33.3964 19.7548C33.156 20.4925 33.0358 20.8614 32.8098 21.1343C32.6102 21.3753 32.353 21.562 32.0621 21.6771C31.7326 21.8074 31.3446 21.8074 30.5687 21.8074L5.45147 21.8074C4.28855 21.8074 3.70709 21.8074 3.445 21.58C3.21771 21.3828 3.09997 21.0878 3.12904 20.7883C3.16256 20.4429 3.58427 20.0426 4.42769 19.2419L15.9597 8.29483C16.5957 7.69108 16.9137 7.3892 17.2803 7.17362C17.6054 6.98246 17.9577 6.84188 18.3251 6.7567C18.7394 6.66065 19.1778 6.66065 20.0548 6.66065L34.7682 6.66065Z" />
    </svg>
  );
}
