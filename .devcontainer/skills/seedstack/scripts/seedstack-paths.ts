/**
 * seedstack-paths.ts — single source of truth for seedstack loop artifact paths.
 * Pure path functions, plus allocation helpers that inspect existing dirs.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RecoveryArtifactName =
  | "scan"
  | "adoption-check"
  | "dirty"
  | "validation"
  | "reconcile"
  | "transition"
  | "commit-check"
  | "recovery-check"
  | "notes";

export const RECOVERY_ARTIFACT_FILENAMES: Readonly<Record<RecoveryArtifactName, string>> = {
  scan: "scan.json",
  "adoption-check": "adoption-check.json",
  dirty: "dirty.json",
  validation: "validation.json",
  reconcile: "reconcile.json",
  transition: "transition.json",
  "commit-check": "commit-check.json",
  "recovery-check": "recovery-check.json",
  notes: "notes.md",
};

const recoveryAttemptReservations = new Map<string, Set<number>>();

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

// ──── Recovery artifacts ────

/** Directory holding recovery attempt artifacts. */
export function recoveryDir(seedstackDir: string): string {
  return join(seedstackDir, "recovery");
}

/** Recovery attempt directory, e.g. recovery/rec-0001. */
export function recoveryAttemptDir(seedstackDir: string, attempt: number): string {
  return join(recoveryDir(seedstackDir), `rec-${pad4(attempt)}`);
}

/** Recovery attempt manifest. */
export function recoveryManifestPath(seedstackDir: string, attempt: number): string {
  return join(recoveryAttemptDir(seedstackDir, attempt), "manifest.json");
}

/** Fixed recovery artifact path under an attempt directory. */
export function recoveryArtifactPath(seedstackDir: string, attempt: number, artifact: RecoveryArtifactName): string {
  return join(recoveryAttemptDir(seedstackDir, attempt), RECOVERY_ARTIFACT_FILENAMES[artifact]);
}

export function recoveryScanPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "scan");
}

export function recoveryAdoptionCheckPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "adoption-check");
}

export function recoveryDirtyPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "dirty");
}

export function recoveryValidationPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "validation");
}

export function recoveryReconcilePath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "reconcile");
}

export function recoveryTransitionPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "transition");
}

export function recoveryCommitCheckPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "commit-check");
}

export function recoveryCheckPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "recovery-check");
}

export function recoveryNotesPath(seedstackDir: string, attempt: number): string {
  return recoveryArtifactPath(seedstackDir, attempt, "notes");
}

/**
 * Reserve the next available recovery attempt number.
 *
 * Existing rec-#### dirs are skipped, and reservations are kept per recovery
 * root so repeated calls in one wrapper process do not return the same attempt.
 */
export function allocateRecoveryAttempt(seedstackDir: string): number {
  const root = recoveryDir(seedstackDir);
  let reserved = recoveryAttemptReservations.get(root);
  if (!reserved) {
    reserved = new Set<number>();
    recoveryAttemptReservations.set(root, reserved);
  }

  let attempt = 1;
  while (reserved.has(attempt) || existsSync(recoveryAttemptDir(seedstackDir, attempt))) {
    attempt += 1;
  }
  reserved.add(attempt);
  return attempt;
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runSelfTest(pretty: boolean): void {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-paths-"));
  try {
    const first = allocateRecoveryAttempt(dir);
    const second = allocateRecoveryAttempt(dir);
    mkdirSync(recoveryAttemptDir(dir, second), { recursive: true });
    const third = allocateRecoveryAttempt(dir);

    assert(first === 1, "first recovery attempt should be rec-0001");
    assert(second === 2, "second recovery attempt should be rec-0002");
    assert(third === 3, "existing rec-0002 dir should be skipped");
    assert(recoveryManifestPath(dir, 1).endsWith("recovery/rec-0001/manifest.json"), "manifest path mismatch");

    const artifacts = Object.fromEntries(
      (Object.keys(RECOVERY_ARTIFACT_FILENAMES) as RecoveryArtifactName[]).map((name) => [
        name,
        recoveryArtifactPath(dir, 1, name),
      ]),
    );
    assert(Object.keys(artifacts).length === 9, "all fixed recovery artifacts should be listed");
    assert(recoveryScanPath(dir, 1).endsWith("recovery/rec-0001/scan.json"), "scan path mismatch");
    assert(recoveryAdoptionCheckPath(dir, 1).endsWith("recovery/rec-0001/adoption-check.json"), "adoption check path mismatch");
    assert(recoveryDirtyPath(dir, 1).endsWith("recovery/rec-0001/dirty.json"), "dirty path mismatch");
    assert(recoveryValidationPath(dir, 1).endsWith("recovery/rec-0001/validation.json"), "validation path mismatch");
    assert(recoveryReconcilePath(dir, 1).endsWith("recovery/rec-0001/reconcile.json"), "reconcile path mismatch");
    assert(recoveryTransitionPath(dir, 1).endsWith("recovery/rec-0001/transition.json"), "transition path mismatch");
    assert(recoveryCommitCheckPath(dir, 1).endsWith("recovery/rec-0001/commit-check.json"), "commit check path mismatch");
    assert(recoveryCheckPath(dir, 1).endsWith("recovery/rec-0001/recovery-check.json"), "recovery check path mismatch");
    assert(recoveryNotesPath(dir, 1).endsWith("recovery/rec-0001/notes.md"), "notes path mismatch");

    const result = {
      contract: "seedstack_paths_self_test.v1",
      ok: true,
      recovery_attempts: [first, second, third],
      manifest: recoveryManifestPath(dir, 1),
      artifacts,
    };
    process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ──── Self-test ────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pretty = args.includes("--pretty");
  if (args.includes("--self-test")) {
    runSelfTest(pretty);
  } else {
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
    console.log("recoveryDir:           ", recoveryDir(d));
    console.log("recoveryAttemptDir:    ", recoveryAttemptDir(d, 1));
    console.log("recoveryManifestPath:  ", recoveryManifestPath(d, 1));
    console.log("recoveryScanPath:      ", recoveryScanPath(d, 1));
    console.log("recoveryAdoptionCheckPath:", recoveryAdoptionCheckPath(d, 1));
    console.log("recoveryDirtyPath:     ", recoveryDirtyPath(d, 1));
    console.log("recoveryValidationPath:", recoveryValidationPath(d, 1));
    console.log("recoveryReconcilePath: ", recoveryReconcilePath(d, 1));
    console.log("recoveryTransitionPath:", recoveryTransitionPath(d, 1));
    console.log("recoveryCommitCheckPath:", recoveryCommitCheckPath(d, 1));
    console.log("recoveryCheckPath:     ", recoveryCheckPath(d, 1));
    console.log("recoveryNotesPath:     ", recoveryNotesPath(d, 1));
    console.log("iterationArtifactPath: ", iterationArtifactPath(d, 3, "dispatch"));
    console.log("iterationResultPath:   ", iterationResultPath(d, 12, "dispatch", "abc1"));
    console.log("decisionPath:          ", decisionPath(d, 7));
    console.log("manageResultPath:      ", manageResultPath(d, 42));
  }
}
