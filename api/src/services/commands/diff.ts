type Tag = "equal" | "delete" | "insert";

interface Change {
  tag: Tag;
  line: string;
}

export interface LineDiff {
  diff: string;
  additions: number;
  removals: number;
  unchanged: number;
}

const CONTEXT = 3;

export function diffSnapshots(before: string, after: string, maxEdits = 1000): LineDiff | null {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = myers(a.slice(start, endA), b.slice(start, endB), maxEdits);
  if (!middle) {
    return null;
  }
  const changes = [
    ...a.slice(0, start).map((line) => ({ tag: "equal" as const, line })),
    ...middle,
    ...a.slice(endA).map((line) => ({ tag: "equal" as const, line })),
  ];
  return {
    diff: unified(changes),
    additions: changes.filter((change) => change.tag === "insert").length,
    removals: changes.filter((change) => change.tag === "delete").length,
    unchanged: changes.filter((change) => change.tag === "equal").length,
  };
}

function myers(a: string[], b: string[], maxEdits: number): Change[] | null {
  const n = a.length;
  const m = b.length;
  if (n + m === 0) {
    return [];
  }
  const limit = Math.min(n + m, maxEdits);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])
          ? v[k + 1 + offset]
          : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, a, b, offset);
      }
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number): Change[] {
  const changes: Change[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const previous = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]) ? k + 1 : k - 1;
    const px = v[previous + offset];
    const py = px - previous;
    while (x > px && y > py) {
      changes.push({ tag: "equal", line: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === px) {
        changes.push({ tag: "insert", line: b[y - 1] });
      } else {
        changes.push({ tag: "delete", line: a[x - 1] });
      }
    }
    x = px;
    y = py;
  }
  return changes.reverse();
}

function unified(changes: Change[]): string {
  const rows: Array<Change & { oldLine: number; newLine: number }> = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of changes) {
    rows.push({ ...change, oldLine, newLine });
    if (change.tag !== "insert") {
      oldLine++;
    }
    if (change.tag !== "delete") {
      newLine++;
    }
  }
  const hunks: Array<[number, number]> = [];
  rows.forEach((row, index) => {
    if (row.tag === "equal") {
      return;
    }
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(rows.length, index + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      hunks.push([start, end]);
    }
  });
  if (hunks.length === 0) {
    return "";
  }
  const lines = ["--- before", "+++ after"];
  for (const [start, end] of hunks) {
    const slice = rows.slice(start, end);
    const oldCount = slice.filter((row) => row.tag !== "insert").length;
    const newCount = slice.filter((row) => row.tag !== "delete").length;
    const oldStart = oldCount === 0 ? slice[0].oldLine - 1 : slice[0].oldLine;
    const newStart = newCount === 0 ? slice[0].newLine - 1 : slice[0].newLine;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const row of slice) {
      lines.push(`${row.tag === "equal" ? " " : row.tag === "delete" ? "-" : "+"}${row.line}`);
    }
  }
  return lines.join("\n");
}
