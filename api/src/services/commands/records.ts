import { randomBytes } from "node:crypto";
import type { CommandEffect } from "./errors.js";
import type { TabInfo } from "./tabs.js";

export type ExecutionState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "expired";

const FINAL_STATES = new Set<ExecutionState>([
  "completed",
  "failed",
  "cancelled",
  "timeout",
  "expired",
]);

const BODY_FIELDS = ["snapshot", "data", "diff", "value"];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface ErrorInfo {
  code: string;
  message: string;
  reason?: string;
}

export interface CommandResult {
  ok: boolean;
  effect: CommandEffect;
  error?: ErrorInfo;
  [field: string]: unknown;
}

export interface Execution {
  id: string;
  key: string | null;
  afterKey: string | null;
  aliases: string[];
  headerKey: boolean;
  hash: string;
  mutating: boolean;
  after?: string;
  afterIssuedAt?: number;
  afterOperation?: Operation;
  state: ExecutionState;
  effect: CommandEffect;
  results: CommandResult[];
  ran: number;
  error?: ErrorInfo;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  next?: string;
  epochChanged?: boolean;
  bumped: boolean;
  bodySize?: number;
  tab?: string;
  page?: TabInfo | null;
  observe?: Record<string, unknown>;
  bodyExpired: boolean;
}

export interface Operation {
  issuedAt: number;
  epoch: number;
  executionId?: string;
  executionOpen: boolean;
}

export interface RecordLimits {
  operationTtlMs: number;
  keyRecordTtlMs: number;
  afterGraceMs: number;
  bodyTtlMs: number;
  maxRecords: number;
  maxOperations: number;
  maxLooseRecords: number;
  maxBodyBytes: number;
  protectedMs: number;
}

export const DEFAULT_RECORD_LIMITS: RecordLimits = {
  operationTtlMs: 60 * 60_000,
  keyRecordTtlMs: 60 * 60_000,
  afterGraceMs: 60 * 60_000,
  bodyTtlMs: 10 * 60_000,
  maxRecords: 8192,
  maxOperations: 16_384,
  maxLooseRecords: 256,
  maxBodyBytes: 64 * 1024 * 1024,
  protectedMs: 5 * 60_000,
};

export function isFinal(state: ExecutionState): boolean {
  return FINAL_STATES.has(state);
}

export class Records {
  epoch = 0;
  private watermark = 0;
  private readonly executions = new Map<string, Execution>();
  private readonly keys = new Map<string, string>();
  private readonly operations = new Map<string, Operation>();
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly limits: RecordLimits,
    private readonly now: () => number,
    private readonly counters: { executions: number } = { executions: 0 },
  ) {}

  create(input: {
    key: string | null;
    afterKey?: string | null;
    headerKey?: boolean;
    hash: string;
    mutating: boolean;
    after?: string;
  }): Execution {
    const execution: Execution = {
      id: `x-${++this.counters.executions}`,
      key: input.key,
      afterKey: input.afterKey ?? null,
      aliases: [],
      headerKey: input.headerKey === true,
      hash: input.hash,
      mutating: input.mutating,
      after: input.after,
      afterIssuedAt: input.after ? this.operations.get(input.after)?.issuedAt : undefined,
      afterOperation: input.after ? this.operations.get(input.after) : undefined,
      state: "queued",
      effect: "none",
      results: [],
      ran: 0,
      createdAt: this.now(),
      bumped: false,
      bodyExpired: false,
    };
    this.executions.set(execution.id, execution);
    for (const key of [input.key, input.afterKey]) {
      if (key) {
        this.keys.set(key, execution.id);
      }
    }
    return execution;
  }

  get(id: string): Execution | undefined {
    return this.executions.get(id);
  }

  byKey(key: string): Execution | undefined {
    const id = this.keys.get(key);
    return id ? this.executions.get(id) : undefined;
  }

  link(key: string, execution: Execution) {
    this.keys.set(key, execution.id);
    execution.aliases.push(key);
    execution.headerKey = true;
  }

  forget(execution: Execution) {
    for (const key of [execution.key, execution.afterKey, ...execution.aliases]) {
      if (key && this.keys.get(key) === execution.id) {
        this.keys.delete(key);
      }
    }
  }

  full(): boolean {
    return this.executions.size >= this.limits.maxRecords;
  }

  issue(execution?: Execution): string {
    const bytes = randomBytes(10);
    const id = `op_${Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
    this.operations.set(id, {
      issuedAt: this.now(),
      epoch: this.epoch,
      executionId: execution?.id,
      executionOpen: execution !== undefined && !isFinal(execution.state),
    });
    return id;
  }

  valid(operation: string): boolean {
    const entry = this.operations.get(operation);
    if (!entry) {
      return false;
    }
    if (this.bound(entry)) {
      return true;
    }
    return (
      entry.issuedAt >= this.watermark && this.now() - entry.issuedAt < this.limits.operationTtlMs
    );
  }

  relieve() {
    this.removeStale();
    if (!this.full()) {
      return;
    }
    this.watermark = Math.max(this.watermark, this.now() - this.limits.protectedMs);
    for (const [id, operation] of this.operations) {
      if (operation.issuedAt < this.watermark && !this.bound(operation)) {
        this.operations.delete(id);
      }
    }
    this.removeStale();
    if (this.full()) {
      this.removePastKeys();
    }
  }

  epochChangedSince(execution: Execution): boolean {
    const entry = execution.afterOperation;
    if (!entry) {
      return true;
    }
    const owner = entry.executionId ? this.executions.get(entry.executionId) : undefined;
    const expected = entry.epoch + (entry.executionOpen && owner?.bumped ? 1 : 0);
    return this.epoch !== expected;
  }

  bump(execution?: Execution) {
    this.epoch++;
    if (execution) {
      execution.bumped = true;
    }
  }

  changed(execution: Execution) {
    const listeners = this.listeners.get(execution.id);
    if (!listeners) {
      return;
    }
    this.listeners.delete(execution.id);
    for (const listener of listeners) {
      listener();
    }
  }

  waitForChange(execution: Execution, until: number): Promise<void> {
    const remaining = until - this.now();
    if (remaining <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const listeners = this.listeners.get(execution.id) ?? new Set();
      this.listeners.set(execution.id, listeners);
      const done = () => {
        clearTimeout(timer);
        listeners.delete(done);
        if (listeners.size === 0 && this.listeners.get(execution.id) === listeners) {
          this.listeners.delete(execution.id);
        }
        resolve();
      };
      const timer = setTimeout(done, remaining);
      listeners.add(done);
    });
  }

  sweep() {
    const now = this.now();
    this.watermark = Math.max(this.watermark, now - this.limits.operationTtlMs);
    for (const [id, operation] of this.operations) {
      if (operation.issuedAt < this.watermark && !this.bound(operation)) {
        this.operations.delete(id);
      }
    }
    const loose: Execution[] = [];
    for (const execution of this.executions.values()) {
      if (!isFinal(execution.state)) {
        continue;
      }
      const finishedAt = execution.finishedAt ?? execution.createdAt;
      if (!execution.bodyExpired && now - finishedAt > this.limits.bodyTtlMs) {
        this.dropBodies(execution);
      }
      if (this.expired(execution, now, finishedAt)) {
        this.remove(execution);
      } else if (!execution.key || execution.state === "expired") {
        loose.push(execution);
      }
    }
    for (const execution of loose.slice(
      0,
      Math.max(0, loose.length - this.limits.maxLooseRecords),
    )) {
      this.remove(execution);
    }
    let bodies = 0;
    for (const execution of this.executions.values()) {
      if (isFinal(execution.state) && !execution.bodyExpired) {
        execution.bodySize ??= this.measure(execution);
        bodies += execution.bodySize;
      }
    }
    for (const execution of this.executions.values()) {
      if (bodies <= this.limits.maxBodyBytes) {
        break;
      }
      if (isFinal(execution.state) && !execution.bodyExpired) {
        bodies -= execution.bodySize ?? 0;
        this.dropBodies(execution);
      }
    }
    for (const [id, operation] of this.operations) {
      if (this.operations.size <= this.limits.maxOperations) {
        break;
      }
      if (now - operation.issuedAt > this.limits.protectedMs && !this.bound(operation)) {
        this.operations.delete(id);
      }
    }
  }

  private bound(operation: Operation): boolean {
    const owner = operation.executionId ? this.executions.get(operation.executionId) : undefined;
    return owner !== undefined && !isFinal(owner.state);
  }

  private removeStale() {
    for (const execution of this.executions.values()) {
      if (
        isFinal(execution.state) &&
        (!execution.key ||
          execution.state === "expired" ||
          (execution.after !== undefined && !execution.headerKey && !this.valid(execution.after)))
      ) {
        this.remove(execution);
      }
    }
  }

  private removePastKeys() {
    const now = this.now();
    for (const execution of this.executions.values()) {
      if (
        isFinal(execution.state) &&
        execution.headerKey &&
        now - (execution.finishedAt ?? execution.createdAt) > this.limits.keyRecordTtlMs
      ) {
        this.remove(execution);
      }
    }
  }

  private measure(execution: Execution): number {
    let size = 0;
    for (const holder of [...execution.results, execution.observe ?? {}]) {
      for (const field of BODY_FIELDS) {
        const value = (holder as Record<string, unknown>)[field];
        if (typeof value === "string") {
          size += value.length;
        } else if (value !== undefined) {
          size += JSON.stringify(value).length;
        }
      }
    }
    return size;
  }

  private expired(execution: Execution, now: number, finishedAt: number): boolean {
    if (!execution.key || execution.state === "expired") {
      return false;
    }
    const keyDone = now - finishedAt > this.limits.keyRecordTtlMs;
    if (!execution.after) {
      return keyDone;
    }
    const issuedAt = execution.afterIssuedAt ?? execution.createdAt;
    const afterDone = now > issuedAt + this.limits.operationTtlMs + this.limits.afterGraceMs;
    return execution.headerKey ? keyDone && afterDone : afterDone;
  }

  private remove(execution: Execution) {
    this.forget(execution);
    this.executions.delete(execution.id);
  }

  private dropBodies(execution: Execution) {
    for (const result of execution.results) {
      for (const field of BODY_FIELDS) {
        delete result[field];
      }
    }
    if (execution.observe) {
      for (const field of BODY_FIELDS) {
        delete execution.observe[field];
      }
    }
    execution.bodyExpired = true;
  }
}
