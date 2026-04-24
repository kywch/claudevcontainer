// Replay the Quint counter-example (session.itf.json, produced by session.neg.qnt)
// against a minimal re-implementation of two persistence patterns:
//
//   Buggy:  truncate the canonical path, then write in-place.  A crash
//           between truncate and write leaves disk empty — data loss.
//   Fixed:  write to a sibling tmp file, then rename.  The canonical path
//           is never in an intermediate state.
//
// For Layer 2 idioms (`vi.mock('node:fs/promises', ...)` to force a
// mid-write crash against real code), see SKILL.md step 7.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

type ItfState = {
  memVersion: { "#bigint": string };
  diskVersion: { "#bigint": string };
  writeInProgress: boolean;
  committedOnce: boolean;
};
type Itf = { states: ItfState[] };

type Action =
  | { kind: "writeNew" }
  | { kind: "beginSave" }
  | { kind: "finishSave" }
  | { kind: "crash" };

function num(b: { "#bigint": string }): number {
  return Number(b["#bigint"]);
}

// Derive actions from state diffs. Quint ITFs don't record the action name,
// so we infer from which vars changed.
function deriveActions(states: ItfState[]): Action[] {
  const out: Action[] = [];
  for (let i = 1; i < states.length; i++) {
    const p = states[i - 1];
    const c = states[i];
    const memDelta = num(c.memVersion) - num(p.memVersion);
    const wipOn = !p.writeInProgress && c.writeInProgress;
    const wipOff = p.writeInProgress && !c.writeInProgress;
    const diskRose = num(c.diskVersion) > num(p.diskVersion);
    if (memDelta > 0) out.push({ kind: "writeNew" });
    else if (wipOn) out.push({ kind: "beginSave" });
    else if (wipOff && diskRose) out.push({ kind: "finishSave" });
    else if (wipOff) out.push({ kind: "crash" });
  }
  return out;
}

// --- Buggy mirror: in-place truncate-then-write. ---
export class BuggyStore {
  diskVersion = 0; // 0 = empty
  memVersion = 0;
  writeInProgress = false;
  committedOnce = false;

  writeNew() {
    this.memVersion++;
  }
  beginSave() {
    this.writeInProgress = true;
    this.diskVersion = 0; // the bug: truncate in place
  }
  finishSave() {
    this.diskVersion = this.memVersion;
    this.writeInProgress = false;
    this.committedOnce = true;
  }
  crash() {
    this.writeInProgress = false;
    // disk unchanged — stays at whatever beginSave left
  }
  load(): number {
    return this.diskVersion;
  }
}

// --- Fixed mirror: tmp+rename. ---
export class FixedStore {
  diskVersion = 0;
  memVersion = 0;
  private tmpVersion: number | null = null;
  committedOnce = false;

  writeNew() {
    this.memVersion++;
  }
  beginSave() {
    this.tmpVersion = this.memVersion; // write to tmp; disk untouched
  }
  finishSave() {
    if (this.tmpVersion === null) throw new Error("no tmp staged");
    this.diskVersion = this.tmpVersion; // atomic rename
    this.tmpVersion = null;
    this.committedOnce = true;
  }
  crash() {
    this.tmpVersion = null; // abandon tmp
  }
  load(): number {
    return this.diskVersion;
  }
  get writeInProgress(): boolean {
    return this.tmpVersion !== null;
  }
}

describe("crash-durability (replay of Quint trace)", () => {
  const trace: Itf = JSON.parse(
    readFileSync(join(here, "session.itf.json"), "utf-8"),
  );
  const actions = deriveActions(trace.states);

  it("buggy mirror loses committed data on the pinned trace", () => {
    const s = new BuggyStore();
    for (const a of actions) {
      if (a.kind === "writeNew") s.writeNew();
      else if (a.kind === "beginSave") s.beginSave();
      else if (a.kind === "finishSave") s.finishSave();
      else if (a.kind === "crash") s.crash();
    }
    // Trace reaches state 6: committedOnce=true, diskVersion=0. Data loss.
    expect(s.committedOnce).toBe(true);
    expect(s.load()).toBe(0);
  });

  it("fixed mirror preserves committed data under the same trace", () => {
    const s = new FixedStore();
    for (const a of actions) {
      if (a.kind === "writeNew") s.writeNew();
      else if (a.kind === "beginSave") s.beginSave();
      else if (a.kind === "finishSave") s.finishSave();
      else if (a.kind === "crash") s.crash();
    }
    // committedOnce implies load() > 0 — the invariant holds.
    if (s.committedOnce) expect(s.load()).toBeGreaterThan(0);
  });
});
