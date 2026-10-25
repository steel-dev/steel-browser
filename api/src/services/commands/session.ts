import type { Browser } from "puppeteer-core";
import type { Command, CommandRequest } from "./commands.js";
import type { Dialog, DialogAction } from "./dialogs.js";
import { DEFAULT_RECORD_LIMITS, Records, type Execution, type RecordLimits } from "./records.js";
import { RefTable } from "./refs.js";
import { TabRegistry, type BrowserHost, type OpenDialogs, type TabEvents } from "./tabs.js";

export interface EngineHost extends BrowserHost {
  cdpClients(): number;
  endSession(id: string): Promise<void>;
  filesRoot(): string;
  released(id: string): boolean;
  quickActionsDone(): Promise<void>;
}

export interface EngineLimits extends RecordLimits {
  responseDeadlineMs: number;
  executionLimitMs: number;
  navigationTimeoutMs: number;
  interruptGraceMs: number;
  inputTimeoutMs: number;
  maxQueued: number;
  maxDialogs: number;
  maxRefs: number;
  frameReadMs: number;
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  ...DEFAULT_RECORD_LIMITS,
  responseDeadlineMs: 20_000,
  executionLimitMs: 60_000,
  navigationTimeoutMs: 15_000,
  interruptGraceMs: 2_000,
  inputTimeoutMs: 10_000,
  maxQueued: 16,
  maxDialogs: 256,
  maxRefs: 50_000,
  frameReadMs: 5_000,
};

export const STEP_MS = 1_000;

export const KEPT_SNAPSHOTS = 32;

export const KEPT_EVENTS = 500;

export type Observe = NonNullable<CommandRequest["observe"]>;

export interface Job {
  execution: Execution;
  commands: Command[];
  onDialog?: DialogAction;
  observe?: Observe;
  expiresAt: number;
  limitAt: number;
  tab?: string;
  tabs: Set<string>;
  claim: boolean;
  interrupting?: Promise<boolean>;
  current: Command | null;
  inflight: Promise<unknown> | null;
  touched: boolean;
  cancelled: boolean;
}

export interface SessionEvent {
  id: number;
  type: string;
  tab: string;
  at: string;
  [field: string]: unknown;
}

interface KeptSnapshot {
  tab: string;
  options: string;
  text: string;
}

export class Counters {
  executions = 0;
  refs = 1;
  tabs = 0;
  snapshots = 0;
  events = 0;
  dialogs = 0;
}

export class ActiveSession {
  readonly records: Records;
  readonly refs: RefTable;
  readonly tabs: TabRegistry;
  readonly queue: Job[] = [];
  readonly dialogs = new Map<string, Dialog>();
  readonly kept = new Map<string, KeptSnapshot>();
  readonly latest = new Map<string, string>();
  readonly events: SessionEvent[] = [];
  readonly downloads = new Map<string, { file: string; url: string }>();
  running: Job | null = null;
  browser: Browser | null = null;
  pumping = false;
  ended = false;
  ending = false;
  claimed = false;

  constructor(
    readonly id: string,
    host: BrowserHost,
    limits: EngineLimits,
    now: () => number,
    events: TabEvents,
    private readonly counters: Counters,
    dialogs: OpenDialogs,
  ) {
    this.records = new Records(limits, now, counters);
    this.refs = new RefTable(limits.maxRefs, counters);
    this.tabs = new TabRegistry(host, events, counters, dialogs);
  }

  get snapshots(): number {
    return this.counters.snapshots;
  }

  set snapshots(value: number) {
    this.counters.snapshots = value;
  }

  get eventSequence(): number {
    return this.counters.events;
  }

  set eventSequence(value: number) {
    this.counters.events = value;
  }

  get dialogSequence(): number {
    return this.counters.dialogs;
  }

  set dialogSequence(value: number) {
    this.counters.dialogs = value;
  }
}
