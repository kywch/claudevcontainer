// Replay the Quint counter-example (budget.itf.json, produced by budget.neg.qnt)
// against a minimal re-implementation of the budget-race pattern.
//
// Teaches Layer 1 of the quint-loop flow:
//   - parse the ITF
//   - derive the action sequence from state diffs (no ITF action field)
//   - run that sequence against a <30 LoC buggy mirror  → invariant violated
//   - run it against a <30 LoC fixed mirror             → invariant holds
//
// For Layer 1b (stateful PBT over the same mirrors), see
// references/pbt-integration.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

type ItfState = {
  fetched: { "#bigint": string };
  checked: { "#set": string[] };
  completed: { "#set": string[] };
};
type Itf = { states: ItfState[] };

type Action = { kind: "check" | "complete"; actor: string };

function deriveActions(states: ItfState[]): Action[] {
  const out: Action[] = [];
  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1];
    const cur = states[i];
    const newChecked = cur.checked["#set"].find((a) => !prev.checked["#set"].includes(a));
    const newCompleted = cur.completed["#set"].find((a) => !prev.completed["#set"].includes(a));
    if (newChecked && !newCompleted) out.push({ kind: "check", actor: newChecked });
    else if (newCompleted) out.push({ kind: "complete", actor: newCompleted });
  }
  return out;
}

// --- Buggy mirror: gate and mutation split, no reservation. ---
export class BuggyBudget {
  fetched = 0;
  constructor(public budget: number) {}
  check(): boolean {
    return this.fetched < this.budget;
  }
  complete(): void {
    this.fetched++;
  }
}

// --- Fixed mirror: reserve at the gate; release on rollback. ---
export class FixedBudget {
  fetched = 0;
  inFlight = 0;
  constructor(public budget: number) {}
  check(): boolean {
    if (this.fetched + this.inFlight >= this.budget) return false;
    this.inFlight++;
    return true;
  }
  complete(): void {
    this.inFlight--;
    this.fetched++;
  }
  rollback(): void {
    this.inFlight--;
  }
}

describe("budget-race (replay of Quint trace)", () => {
  const trace: Itf = JSON.parse(
    readFileSync(join(here, "budget.itf.json"), "utf-8"),
  );
  const actions = deriveActions(trace.states);
  const BUDGET = 1;

  it("buggy mirror violates budget on the pinned trace", () => {
    const b = new BuggyBudget(BUDGET);
    const passed = new Set<string>();
    for (const a of actions) {
      if (a.kind === "check") {
        if (b.check()) passed.add(a.actor);
      } else if (a.kind === "complete") {
        expect(passed.has(a.actor)).toBe(true);
        b.complete();
      }
    }
    expect(b.fetched).toBeGreaterThan(BUDGET);
  });

  it("fixed mirror honours budget under the same interleaving", () => {
    const b = new FixedBudget(BUDGET);
    const passed = new Set<string>();
    for (const a of actions) {
      if (a.kind === "check") {
        if (b.check()) passed.add(a.actor);
      } else if (a.kind === "complete") {
        if (passed.has(a.actor)) b.complete();
      }
    }
    expect(b.fetched).toBeLessThanOrEqual(BUDGET);
    expect(b.inFlight).toBe(0);
  });
});
