/**
 * seedstack-paths.ts — single source of truth for seedstack loop artifact paths.
 * Pure functions, no filesystem side effects.
 */
import { join } from "node:path";

// ──── Internal helpers ────

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

// ──── Core directories ────

/** Run-level state snapshot. */
export function runStatePath(seedstackDir: string): string {
  return join(seedstackDir, "run-state.json");
}

/** Loop-level state snapshot. */
export function loopStatePath(seedstackDir: string): string {
  return join(seedstackDir, "loop-state.json");
}

/** Append-only event log. */
export function eventsPath(seedstackDir: string): string {
  return join(seedstackDir, "events.jsonl");
}

/** Directory holding per-iteration artifacts. */
export function loopDir(seedstackDir: string): string {
  return join(seedstackDir, "loop");
}

/** Commit ledger markdown. */
export function commitLedgerPath(seedstackDir: string): string {
  return join(seedstackDir, "commit-ledger.md");
}

/** Adoption selection JSON. */
export function adoptionSelectionPath(seedstackDir: string): string {
  return join(seedstackDir, "adoption-selection.json");
}

/** Dashboard markdown. */
export function dashboardPath(seedstackDir: string): string {
  return join(seedstackDir, "dashboard.md");
}

/** Plan markdown. */
export function planPath(seedstackDir: string): string {
  return join(seedstackDir, "plan.md");
}

/** Operator request to stop after the current seed reaches idle. */
export function stopAfterSeedPath(seedstackDir: string): string {
  return join(seedstackDir, "stop-after-seed.json");
}

// ──── Loop iteration artifacts ────

/** Per-iteration artifact (e.g. dispatch, manage). */
export function iterationArtifactPath(seedstackDir: string, iteration: number, label: string): string {
  return join(loopDir(seedstackDir), `${pad4(iteration)}-${label}.json`);
}

/** Per-iteration per-seed result. */
export function iterationResultPath(seedstackDir: string, iteration: number, label: string, seed: string): string {
  return join(loopDir(seedstackDir), `${pad4(iteration)}-${label}-${seed}.result.json`);
}

// ──── Manage cycle artifacts ────

/** Decision markdown for a manage sequence. */
export function decisionPath(seedstackDir: string, seq: number): string {
  return join(seedstackDir, `decision-${pad3(seq)}.md`);
}

/** Result markdown for a manage sequence. */
export function manageResultPath(seedstackDir: string, seq: number): string {
  return join(seedstackDir, `result-${pad3(seq)}.md`);
}

// ──── Self-test ────

if (import.meta.main) {
  const d = "/tmp/seedstack";
  console.log("runStatePath:          ", runStatePath(d));
  console.log("loopStatePath:         ", loopStatePath(d));
  console.log("eventsPath:            ", eventsPath(d));
  console.log("loopDir:               ", loopDir(d));
  console.log("commitLedgerPath:      ", commitLedgerPath(d));
  console.log("adoptionSelectionPath: ", adoptionSelectionPath(d));
  console.log("dashboardPath:         ", dashboardPath(d));
  console.log("planPath:              ", planPath(d));
  console.log("stopAfterSeedPath:     ", stopAfterSeedPath(d));
  console.log("iterationArtifactPath: ", iterationArtifactPath(d, 3, "dispatch"));
  console.log("iterationResultPath:   ", iterationResultPath(d, 12, "dispatch", "abc1"));
  console.log("decisionPath:          ", decisionPath(d, 7));
  console.log("manageResultPath:      ", manageResultPath(d, 42));
}
