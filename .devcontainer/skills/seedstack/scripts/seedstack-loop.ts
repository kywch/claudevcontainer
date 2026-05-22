#!/usr/bin/env bun
// Seedstack outer loop supervisor.
//
// This script owns loop progress for run/auto mode. It keeps the LLM bounded to
// one dispatch or manage step, then enforces the outer state machine with the
// existing deterministic Seedstack checkers.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  followupCount,
  readChildResult,
  runChild,
  type ChildExit,
  type ChildResult,
  type ChildRole,
  type ChildAttemptRecord,
} from "./child-supervisor.ts";
import { buildDispatchPrompt, buildManagePrompt } from "./prompts.ts";
import {
  runStatePath as statePath,
  loopStatePath,
  eventsPath,
  loopDir,
  childAttemptsDir,
  childAttemptPath,
  childFailureCapsulePath,
  allocateRecoveryAttempt,
  recoveryAttemptDir,
  commitLedgerPath,
  dashboardPath,
  stopAfterSeedPath,
  iterationArtifactPath,
  iterationResultPath,
} from "./seedstack-paths.ts";
import type { WorktreeMetadata } from "./worktree-preflight.ts";

// ── Re-exports from modules ─────────────────────────────────────────────────

import {
  type JsonObject,
  type RunStateName,
  type Options,
  type EventRecord,
  type LoopState,
  type QueueOperation,
  type QueueOperationCommand,
  type PerSeedCommitMetadata,
  type SeedTiming,
  SCRIPT_DIR,
  DISPATCH_SEED_DIR,
  readJson,
  writeJson,
  isObject,
  stringField,
  numberField,
  stringArray,
  pathEntries,
  unexpectedPaths,
  markdownCell,
} from "./seedstack-loop/types.ts";

import {
  parseArgs,
  ensureInputs,
  persistedRepoFromRunState,
} from "./seedstack-loop/cli.ts";

import {
  knowledgeCapturePath as knowledgeCapturePathFn,
  knowledgeStorePath as knowledgeStorePathFn,
  knowledgeStoreLineCount,
  knowledgeStoreGitState,
  baseKnowledgeCaptureCheck,
  recordKnowledgeCandidates,
  knowledgeCaptureBlocksRequired,
} from "./seedstack-loop/knowledge-capture.ts";

import {
  queueDirtyPathsFromStatus,
  queueDirtyPaths as queueDirtyPathsFn,
  proposedQueueOperations,
  normalizeQueueOperation,
  scanIssueById,
  validateQueueOperationPreconditions,
  buildQueueOperationArgv,
  runQueueOperationCommand,
  applyManageQueueOperations as applyManageQueueOperationsFn,
} from "./seedstack-loop/queue-operations.ts";

import {
  selfTest as selfTestFn,
} from "./seedstack-loop/self-tests.ts";

// ── Module-level mutable state ───────────────────────────────────────────────

let optionsGlobal: Options & { seedstackDir: string; adoptionSelection: string };

// ── Dashboard state ──────────────────────────────────────────────────────────

let dashboardTimings: SeedTiming[] = [];
let dashboardLoopStartedAt = 0;
let dashboardPhaseStartedAt = 0;
let dashboardCurrentSeed: string | null = null;
let dashboardCurrentPhase: "idle" | "dispatch" | "manage" | "commit" | "scan" = "idle";
let dashboardIteration = 0;
let dashboardState = "idle";
let dashboardCurrentTiming: SeedTiming | null = null;

// ── Wrapper functions that close over optionsGlobal ─────────────────────────

function knowledgeCapturePath(seed: string): string {
  return knowledgeCapturePathFn(optionsGlobal.repo, seed);
}

function knowledgeStorePath(): string {
  return knowledgeStorePathFn(optionsGlobal.repo);
}

function queueDirtyPaths(): string[] {
  return queueDirtyPathsFn(optionsGlobal.repo);
}

function applyManageQueueOperations(
  seedstackDir: string,
  iteration: number,
  seed: string,
  childPreScan: JsonObject,
  reconcilePath: string,
  proposals: JsonObject[],
): JsonObject {
  return applyManageQueueOperationsFn(
    seedstackDir, iteration, seed, childPreScan, reconcilePath, proposals,
    optionsGlobal.repo, optionsGlobal.seedCli,
    runScan, ok, latestArtifactPath, scanListIds,
  );
}

// ── Orchestrator functions ───────────────────────────────────────────────────

function beforeFirstDispatch(runState: JsonObject): boolean {
  if ((numberField(runState.loop_iteration) ?? 0) > 0) return false;
  const attempts = isObject(runState.dispatch_attempts) ? Object.keys(runState.dispatch_attempts).length : 0;
  if (attempts > 0) return false;
  const latest = isObject(runState.latest_dispatch) ? runState.latest_dispatch : {};
  return Object.keys(latest).length === 0;
}

function stopOnPreexistingQueueDirtyBeforeAutoRun(seedstackDir: string, iteration: number, runState: JsonObject): void {
  if (optionsGlobal.mode !== "auto" || !beforeFirstDispatch(runState)) return;
  const dirtyPaths = queueDirtyPaths();
  emit(seedstackDir, "queue_baseline_preflight", {
    ok: dirtyPaths.length === 0,
    queue_dirty_paths: dirtyPaths,
    excluded_paths: [".seeds/knowledge.jsonl"],
    remedy: "commit seed creation/queue baseline first",
  });
  if (dirtyPaths.length > 0) {
    stop(seedstackDir, iteration, "blocked", "preexisting_queue_dirty_before_auto_run", {
      queue_dirty_paths: dirtyPaths,
      remedy: "commit seed creation/queue baseline first",
    });
  }
}

function stopOnUnexpectedDirty(seedstackDir: string, iteration: number, seed: string, dirty: JsonObject, reason: string): void {
  const unexpected = unexpectedPaths(dirty);
  if (unexpected.length > 0) {
    stop(seedstackDir, iteration, "blocked", reason, {
      seed,
      dirty: latestArtifactPath(dirty),
      unexpected_paths: unexpected,
    });
  }
}

function parseGateExpectedSeedPaths(text: string): string[] {
  const section = [
    text.match(/## Dirty Guard[\s\S]*?(?:\n## |\n# |$)/)?.[0] ?? "",
    dirtyGuardBlock(text),
  ].join("\n");
  const paths = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!bullet) continue;
    for (const match of bullet[1].matchAll(/`([^`]+)`/g)) {
      const path = match[1]?.trim();
      if (isExpectedSeedPath(path)) paths.add(path);
    }
    for (const match of bullet[1].matchAll(/[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+/g)) {
      const path = cleanExpectedSeedPath(match[0]);
      if (isExpectedSeedPath(path)) paths.add(path);
    }
  }
  for (const arrayMatch of text.matchAll(/"actual_impl_paths"\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const pathMatch of arrayMatch[1].matchAll(/"([^"]+)"/g)) {
      const path = cleanExpectedSeedPath(pathMatch[1]?.trim() ?? "");
      if (isExpectedSeedPath(path)) paths.add(path);
    }
  }
  return [...paths];
}

function dirtyGuardBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^dirty_guard:[ \t]*$/.test(line));
  if (start < 0) return "";
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^[a-z][a-z0-9_]*:[ \t]*$/.test(line) || /^# /.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

function cleanExpectedSeedPath(path: string): string {
  const cleaned = path.replace(/[),.;:]+$/g, "");
  if (cleaned.startsWith(".")) return cleaned;
  const repoName = (optionsGlobal?.repo ?? process.cwd()).split(/[\\/]/).filter(Boolean).at(-1);
  if (repoName && cleaned.startsWith(`${repoName}/`)) return cleaned.slice(repoName.length + 1);
  const slash = cleaned.indexOf("/");
  if (slash > 0) {
    const relative = cleaned.slice(slash + 1);
    if (/^(?:docs|impl|impl_v2|skills|spec)\//.test(relative)) return relative;
  }
  return cleaned;
}

function isExpectedSeedPath(path: string | undefined): path is string {
  if (!path || path.startsWith(".seeds/") || path.startsWith("tmp/") || path.startsWith("/") || /\s/.test(path)) return false;
  return /^(?:[A-Za-z0-9._+-]+\/)+[A-Za-z0-9._+-]+$/.test(path) || /^[A-Za-z0-9._+-]+\.[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(path);
}

function reconcileArtifactPath(runState: JsonObject, seed: string): string | null {
  const latest = isObject(runState.latest_dispatch) ? runState.latest_dispatch : {};
  const direct = stringField(latest.reconcile_result_path);
  if (direct) return direct;
  const latestReconciliation = isObject(latest.reconciliation) ? latest.reconciliation : {};
  const latestPath = stringField(latestReconciliation.path);
  if (latestPath) return latestPath;
  const stateReconciliation = isObject(runState.reconciliation) ? runState.reconciliation : {};
  if (stringField(stateReconciliation.seed) === seed) return stringField(stateReconciliation.path);
  return null;
}

// statePath, loopStatePath, eventsPath, loopDir — imported from seedstack-paths.ts

function loadRunState(seedstackDir: string): JsonObject {
  const path = statePath(seedstackDir);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (error) {
    throw new Error(`invalid_run_state_json: ${(error as Error).message}`);
  }
  if (!isObject(raw)) throw new Error("invalid_run_state_object");
  return raw;
}

function adoptedCountFromManifest(path: string): number {
  const raw = readJson(path);
  if (!isObject(raw)) return 0;
  const direct = stringArray(raw.adopted_seed_ids);
  if (direct.length) return direct.length;
  const adoption = isObject(raw.adoption) ? raw.adoption : null;
  return adoption ? stringArray(adoption.adopted_seed_ids).length : 0;
}

function loadLoopState(seedstackDir: string): LoopState {
  const path = loopStatePath(seedstackDir);
  const baselineSeedCount = adoptedCountFromManifest(optionsGlobal.adoptionSelection);
  const existingLoopIteration = maxExistingLoopArtifactIteration(seedstackDir);
  const fallback = (): LoopState => ({
    contract: "seedstack_loop_state.v1",
    loop_iteration: existingLoopIteration,
    scan_epoch: 0,
    manage_epoch: 0,
    total_followups: 0,
    baseline_seed_count: baselineSeedCount,
    skipped_seeds: [],
  });
  if (!existsSync(path)) {
    return fallback();
  }
  const raw = readJson(path);
  if (!isObject(raw)) return fallback();
  const skipped = Array.isArray(raw.skipped_seeds)
    ? raw.skipped_seeds.filter(isObject).flatMap((item) => {
        const seed = stringField(item.seed);
        const reason = stringField(item.reason);
        const at = stringField(item.at);
        const loopCap = stringField(item.loop_cap);
        return seed && reason && at ? [{ seed, reason, at, ...(loopCap ? { loop_cap: loopCap } : {}) }] : [];
      })
    : [];
  return {
    contract: "seedstack_loop_state.v1",
    loop_iteration: Math.max(numberField(raw.loop_iteration) ?? 0, existingLoopIteration),
    scan_epoch: numberField(raw.scan_epoch) ?? 0,
    manage_epoch: numberField(raw.manage_epoch) ?? 0,
    total_followups: numberField(raw.total_followups) ?? 0,
    baseline_seed_count: numberField(raw.baseline_seed_count) ?? baselineSeedCount,
    skipped_seeds: skipped,
  };
}

function saveLoopState(seedstackDir: string, state: LoopState): void {
  writeJson(loopStatePath(seedstackDir), state);
}

function maxExistingLoopArtifactIteration(seedstackDir: string): number {
  const dir = loopDir(seedstackDir);
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    const match = /^(\d+)-/.exec(entry);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > max) max = value;
  }
  return max;
}

function allocateSupervisorIteration(seedstackDir: string): { iteration: number; loopState: LoopState } {
  const loopState = loadLoopState(seedstackDir);
  const iteration = Math.max(loopState.loop_iteration, maxExistingLoopArtifactIteration(seedstackDir)) + 1;
  const allocated = { ...loopState, loop_iteration: iteration };
  saveLoopState(seedstackDir, allocated);
  return { iteration, loopState: allocated };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function stopAfterSeedReason(seedstackDir: string): string | null {
  const path = stopAfterSeedPath(seedstackDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readJson(path);
    if (isObject(raw)) return stringField(raw.reason) ?? "stop-after-seed requested";
  } catch {
    // Presence is the operator signal. Bad JSON should not turn a safe pause into a blocker.
  }
  return "stop-after-seed requested";
}

function exitAfterSeedStop(seedstackDir: string, iteration: number, seed: string, reason: string): never {
  const controlPath = stopAfterSeedPath(seedstackDir);
  updateRunState(seedstackDir, iteration, "idle", [
    "--decision",
    "stop_after_seed",
    "--rationale",
    reason,
    "--event",
    `stop:seed ${seed} ${reason}`,
  ]);
  emit(seedstackDir, "post_seed_stop_requested", { seed, reason, control_path: controlPath });
  finalEvent(seedstackDir, true, "idle", { reason: "stop_after_seed_requested", seed, control_path: controlPath });
}

function stopIfRequestedWhileIdle(seedstackDir: string, iteration: number): void {
  const reason = stopAfterSeedReason(seedstackDir);
  if (!reason) return;
  exitAfterSeedStop(seedstackDir, iteration, "none", reason);
}

async function postSeedCheckpoint(seedstackDir: string, iteration: number, seed: string): Promise<void> {
  const delayMs = optionsGlobal.postSeedDelayMs;
  const controlPath = stopAfterSeedPath(seedstackDir);
  let interruptRequested = false;
  const onInterrupt = () => {
    interruptRequested = true;
  };
  process.once("SIGINT", onInterrupt);
  try {
    emit(seedstackDir, "post_seed_checkpoint", { seed, delay_ms: delayMs, control_path: controlPath });
    const started = Date.now();
    while (Date.now() - started < delayMs) {
      const reason = stopAfterSeedReason(seedstackDir);
      if (reason || interruptRequested) {
        exitAfterSeedStop(seedstackDir, iteration, seed, interruptRequested ? "interrupt_at_post_seed_checkpoint" : (reason as string));
      }
      await sleep(Math.min(250, Math.max(0, delayMs - (Date.now() - started))));
    }
    const reason = stopAfterSeedReason(seedstackDir);
    if (reason || interruptRequested) {
      exitAfterSeedStop(seedstackDir, iteration, seed, interruptRequested ? "interrupt_at_post_seed_checkpoint" : (reason as string));
    }
  } finally {
    process.removeListener("SIGINT", onInterrupt);
  }
}

function runStateName(runState: JsonObject): RunStateName {
  const state = stringField(runState.state);
  if (
    state === "idle" ||
    state === "dispatching" ||
    state === "managing" ||
    state === "done" ||
    state === "exhausted" ||
    state === "blocked" ||
    state === "escalated" ||
    state === "loop_cap"
  ) {
    return state;
  }
  if (state) throw new Error(`invalid_run_state: ${state}`);
  return "idle";
}

function currentSeed(runState: JsonObject): string | null {
  const direct = stringField(runState.seed) ?? stringField(runState.in_flight_seed_id);
  if (direct) return direct;
  const latest = isObject(runState.latest_dispatch) ? runState.latest_dispatch : null;
  return latest ? stringField(latest.seed_id) : null;
}

function canRecoverDispatchChildEscalation(runState: JsonObject): string | null {
  const reason = stringField(runState.stop_reason) ?? stringField(runState.blocked_reason);
  if (reason !== "dispatch_child_escalated") return null;
  return currentSeed(runState);
}

function emit(seedstackDir: string, event: string, data: JsonObject = {}): void {
  const record: EventRecord = { ts: new Date().toISOString(), event, ...data };
  const line = `${JSON.stringify(record)}\n`;
  process.stdout.write(line);
  writeFileSync(eventsPath(seedstackDir), line, { flag: "a" });
  // Update dashboard tracking from structured events
  if (event === "loop_start") dashboardLoopStartedAt = Date.now();
  if (event === "loop_iteration") {
    dashboardIteration = (data.iteration as number) ?? dashboardIteration;
    dashboardState = (data.state as string) ?? dashboardState;
  }
  try { writeDashboard(seedstackDir, dashboardState, dashboardIteration); } catch { /* best-effort */ }
}

function finalEvent(seedstackDir: string, okValue: boolean, state: string, data: JsonObject = {}): never {
  emit(seedstackDir, "final", { ok: okValue, state, ...data });
  process.exit(okValue ? 0 : 1);
}

function artifact(seedstackDir: string, label: string, iteration: number): string {
  mkdirSync(loopDir(seedstackDir), { recursive: true });
  return iterationArtifactPath(seedstackDir, iteration, label);
}

function resultPath(seedstackDir: string, label: string, seed: string, iteration: number): string {
  mkdirSync(loopDir(seedstackDir), { recursive: true });
  return iterationResultPath(seedstackDir, iteration, label, seed);
}

function runJson(seedstackDir: string, iteration: number, label: string, script: string, args: string[], allowFailure = false): JsonObject {
  const outPath = artifact(seedstackDir, label, iteration);
  const command = [process.execPath, script, ...args];
  const proc = spawnSync(command[0], command.slice(1), {
    cwd: optionsGlobal.repo,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = proc.stdout.trim();
  const stderr = proc.stderr.trim();
  if (stdout) writeFileSync(outPath, `${stdout}\n`);
  if (stderr) writeFileSync(`${outPath}.stderr`, `${stderr}\n`);
  if (proc.status !== 0 && !allowFailure) {
    throw new Error(`${label} failed exit=${proc.status}; stderr=${stderr || "(none)"}`);
  }
  if (!stdout) throw new Error(`${label} produced no stdout`);
  const parsed = JSON.parse(stdout) as unknown;
  if (!isObject(parsed)) throw new Error(`${label} did not produce JSON object`);
  return { ...parsed, __path: outPath };
}

// ── Dashboard rendering ──────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function writeDashboard(seedstackDir: string, state: string, iteration: number): void {
  if (!seedstackDir) return;
  const now = Date.now();
  const elapsed = dashboardLoopStartedAt ? fmtDuration(now - dashboardLoopStartedAt) : "—";
  const phaseElapsed = dashboardPhaseStartedAt ? fmtDuration(now - dashboardPhaseStartedAt) : "";

  let current = `State: **${state}** | Repo: \`${optionsGlobal.repo}\` | Worktree: ${worktreeSummary(optionsGlobal.worktree)}`;
  if (dashboardCurrentSeed) {
    current += ` | Work order: \`${dashboardCurrentSeed}\``;
    if (dashboardCurrentPhase !== "idle") current += ` | Phase: ${dashboardCurrentPhase}`;
    if (phaseElapsed) current += ` (${phaseElapsed})`;
  }

  const ok = dashboardTimings.filter((t) => t.result === "ok");
  const bad = dashboardTimings.filter((t) => t.result !== "ok");

  let completedTable = "";
  if (ok.length > 0) {
    completedTable = "\n## Completed\n| Seed | Dispatch | Manage | Commit | Total |\n| --- | --- | --- | --- | --- |\n";
    for (const t of ok) {
      const d = t.dispatch_ms != null ? fmtDuration(t.dispatch_ms) : "—";
      const m = t.manage_ms != null ? fmtDuration(t.manage_ms) : "—";
      const c = t.commit_ms != null ? fmtDuration(t.commit_ms) : "—";
      const total = fmtDuration((t.dispatch_ms ?? 0) + (t.manage_ms ?? 0) + (t.commit_ms ?? 0));
      completedTable += `| ${markdownCell(t.seed)} | ${d} | ${m} | ${c} | ${total} |\n`;
    }
  }

  let failedTable = "";
  if (bad.length > 0) {
    failedTable = "\n## Skipped / Failed\n| Seed | Result | Reason |\n| --- | --- | --- |\n";
    for (const t of bad) {
      failedTable += `| ${markdownCell(t.seed)} | ${t.result} | ${markdownCell(t.reason ?? "—")} |\n`;
    }
  }

  const done = ok.length;
  const failed = bad.length;
  const ts = new Date().toISOString().slice(0, 19) + "Z";

  const md = `# Seedstack Dashboard
Updated: ${ts} | Iter: ${iteration} | Elapsed: ${elapsed}

## Current
${current}
${completedTable}${failedTable}
## Summary
Seeds: ${done} done${failed > 0 ? `, ${failed} failed/skipped` : ""} of ${done + failed} processed
`;
  writeFileSync(dashboardPath(seedstackDir), md);
}

function worktreeSummary(worktree: WorktreeMetadata): string {
  const kind = worktree.linked ? "linked" : "main";
  const branch = worktree.branch || "detached";
  const head = worktree.head ? worktree.head.slice(0, 12) : "no-head";
  return `${kind} ${branch} ${head} policy=${worktree.policy}`;
}

function checkerPath(name: string): string {
  return join(SCRIPT_DIR, name);
}

function dispatchValidatorPath(): string {
  return join(DISPATCH_SEED_DIR, "scripts", "validate-dispatch-work.ts");
}

function latestArtifactPath(result: JsonObject): string {
  const path = stringField(result.__path);
  if (!path) throw new Error("internal checker result missing __path");
  return path;
}

function ok(result: JsonObject): boolean {
  return result.ok === true;
}

function decision(result: JsonObject): string | null {
  return stringField(result.decision);
}

function transition(
  seedstackDir: string,
  iteration: number,
  current: RunStateName,
  next: RunStateName,
  args: string[],
  allowFailure = false,
): JsonObject {
  return runJson(seedstackDir, iteration, `transition-${current}-to-${next}`, checkerPath("check-run-transition.ts"), [
    "--repo",
    optionsGlobal.repo,
    "--run-state",
    statePath(seedstackDir),
    "--current-state",
    current,
    "--next-state",
    next,
    ...args,
    "--pretty",
  ], allowFailure);
}

function updateRunState(seedstackDir: string, iteration: number, next: RunStateName, args: string[]): JsonObject {
  const worktreeMetadataPath = writeLoopJson(seedstackDir, iteration, `worktree-metadata-${next}`, optionsGlobal.worktree);
  return runJson(seedstackDir, iteration, `update-${next}`, checkerPath("update-run-state.ts"), [
    "--repo",
    optionsGlobal.repo,
    "--original-repo",
    optionsGlobal.originalRepo,
    "--worktree-policy",
    optionsGlobal.worktreePolicy,
    "--worktree-metadata-file",
    worktreeMetadataPath,
    "--seedstack-dir",
    seedstackDir,
    "--state",
    next,
    "--commit-policy",
    optionsGlobal.commitPolicy,
    ...args,
    "--pretty",
  ]);
}

function runGit(args: string[], allowFailure = false): { status: number; stdout: string; stderr: string } {
  const proc = spawnSync("git", args, {
    cwd: optionsGlobal.repo,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const status = proc.status ?? 1;
  const stdout = proc.stdout.trim();
  const stderr = proc.stderr.trim();
  if (status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} failed exit=${status}; stderr=${stderr || "(none)"}`);
  }
  return { status, stdout, stderr };
}

function stagedPaths(): string[] {
  const out = runGit(["diff", "--cached", "--name-only"], true);
  return out.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function commitCandidatePaths(dirty: JsonObject): string[] {
  const allowed = new Set(["dispatcher_owned", "expected_queue_mutation", "expected_seed"]);
  return [...new Set(pathEntries(dirty.paths)
    .filter((item) => allowed.has(item.classification))
    .map((item) => item.path)
    .filter((path) => path && !path.startsWith("tmp/") && path !== ".seeds/knowledge.jsonl"))]
    .sort();
}

function ledgerHeaderColumns(): string[] {
  return [
    "timestamp",
    "seed",
    "commit",
    "subject",
    "gates",
    "dirty snapshot",
    "policy",
    "worktree root",
    "branch",
    "head before",
    "head after",
    "git common dir",
    "changed path allowlist",
  ];
}

function currentWorktreeRoot(): string | null {
  const root = runGit(["rev-parse", "--show-toplevel"], true).stdout;
  return root || optionsGlobal.worktree.worktree_root;
}

function currentGitCommonDir(): string | null {
  const dir = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], true).stdout;
  return dir || optionsGlobal.worktree.git_common_dir;
}

function currentBranch(): string | null {
  const branch = runGit(["branch", "--show-current"], true).stdout;
  return branch || optionsGlobal.worktree.branch;
}

function currentHead(): string {
  return runGit(["rev-parse", "HEAD"]).stdout;
}

function expectedCommitHead(seedstackDir: string, seed: string): string | null {
  const state = loadRunState(seedstackDir);
  const latest = isObject(state.latest_dispatch) ? state.latest_dispatch : {};
  if (stringField(latest.seed_id) !== seed) return null;
  return stringField(latest.head_before) ?? stringField(latest.head_after) ?? stringField(latest.commit);
}

function appendCommitLedger(seedstackDir: string, seed: string, dirtyPath: string, metadata: PerSeedCommitMetadata): void {
  const path = commitLedgerPath(seedstackDir);
  if (!existsSync(path)) {
    const header = ledgerHeaderColumns();
    writeFileSync(path, `| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n`);
  }
  const subject = runGit(["show", "-s", "--format=%s", metadata.commit]).stdout;
  const row = [
    new Date().toISOString(),
    seed,
    metadata.commit,
    subject,
    "dispatch-close",
    dirtyPath,
    "per_seed",
    metadata.worktreeRoot ?? "",
    metadata.branch ?? "",
    metadata.headBefore,
    metadata.headAfter,
    metadata.gitCommonDir ?? "",
    metadata.changedPathAllowlist.join(","),
  ].map(markdownCell).join(" | ");
  writeFileSync(path, `| ${row} |\n`, { flag: "a" });
}

function writeLoopJson(seedstackDir: string, iteration: number, label: string, value: unknown): string {
  const path = artifact(seedstackDir, label, iteration);
  writeJson(path, value);
  return path;
}

function syntheticChildReconcile(seedstackDir: string, iteration: number, seed: string, childResult: ChildResult, childResultPath?: string): string {
  return writeLoopJson(seedstackDir, iteration, `reconcile-${seed}`, {
    contract: "dispatch_reconcile_check.v1",
    ok: true,
    decision: "manage_reconcile",
    blockers: [],
    warnings: [
      {
        code: `dispatch_child_${childResult.decision ?? "unknown"}`,
        message: "dispatch child returned concrete non-closed result; manage must triage retry or block",
      },
    ],
    seed,
    validation: {
      ok: true,
      summary: { child_result: childResult },
      blockers: [],
      hard_blockers: [],
      soft_blockers: [],
      warnings: [],
    },
    commands: [],
    inputs: { seed, child_result_path: childResultPath ?? "seedstack_child_result.v1" },
  });
}

function reconcileHasNonclosedDispatch(reconcile: JsonObject): boolean {
  const warnings = Array.isArray(reconcile.warnings) ? reconcile.warnings.filter(isObject) : [];
  return warnings.some((finding) => {
    const code = stringField(finding.code) ?? "";
    return code === "gate_retry" || code === "gate_escalation" || code.startsWith("dispatch_child_");
  });
}

function latestDispatchNonclosed(runState: JsonObject): boolean {
  const latest = isObject(runState.latest_dispatch) ? runState.latest_dispatch : {};
  const status = stringField(latest.status);
  return status === "nonclosed_reconciled";
}

function latestDispatchClosedClean(runState: JsonObject): boolean {
  const latest = isObject(runState.latest_dispatch) ? runState.latest_dispatch : {};
  return stringField(latest.status) === "closed_clean";
}

function hasCloseCurrentProposal(proposals: JsonObject[], seed: string): boolean {
  return proposals.some((proposal) =>
    stringField(proposal.op_type) === "close-current" &&
    stringField(proposal.target_seed) === seed,
  );
}

function scanProvesSeedClosed(scan: JsonObject, seed: string): boolean {
  const issue = scanIssueById(scan, seed);
  if (issue) return stringField(issue.status) === "closed";
  if (stringArray(scan.closed_adopted).includes(seed)) return true;
  if (stringArray(isObject(scan.ids) ? scan.ids.adopted_closed_ids : undefined).includes(seed)) return true;

  // Some seed CLI versions omit closed issues from list/ready/blocked output.
  // In that shape, an adopted seed absent from every nonterminal scan bucket is
  // the only observable closed state.
  const adopted = stringArray(isObject(scan.adopted) ? scan.adopted.adopted_seed_ids : undefined);
  if (!adopted.includes(seed)) return false;
  const open = stringArray(scan.open_adopted);
  const ready = stringArray(isObject(scan.ids) ? scan.ids.adopted_ready_ids : undefined);
  const blocked = stringArray(isObject(scan.ids) ? scan.ids.adopted_blocked_ids : undefined);
  const listed = stringArray(isObject(scan.ids) ? scan.ids.list_ids : undefined);
  return !open.includes(seed) && !ready.includes(seed) && !blocked.includes(seed) && !listed.includes(seed);
}

function writeCloseCurrentInvariantArtifact(
  seedstackDir: string,
  iteration: number,
  seed: string,
  reason: string,
  detail: JsonObject,
): string {
  return writeLoopJson(seedstackDir, iteration, `manage-close-current-invariant-${seed}`, {
    contract: "manage_close_current_invariant.v1",
    ok: false,
    seed,
    reason,
    required_when: "latest_dispatch.status=closed_clean and manage decision is continue_other_seeds or done",
    ...detail,
  });
}

function writePerSeedCommitRecoveryArtifact(
  seedstackDir: string,
  iteration: number,
  seed: string,
  phase: string,
  metadata: PerSeedCommitMetadata,
  detail: JsonObject,
): string {
  const attempt = allocateRecoveryAttempt(seedstackDir);
  const dir = recoveryAttemptDir(seedstackDir, attempt);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "per-seed-commit-recovery.json");
  writeJson(path, {
    contract: "per_seed_commit_recovery.v1",
    recoverable: true,
    seed,
    phase,
    iteration,
    commit: metadata.commit,
    head_before: metadata.headBefore,
    head_after: metadata.headAfter,
    changed_path_allowlist: metadata.changedPathAllowlist,
    worktree_root: metadata.worktreeRoot,
    branch: metadata.branch,
    git_common_dir: metadata.gitCommonDir,
    run_state: statePath(seedstackDir),
    commit_ledger: commitLedgerPath(seedstackDir),
    recovery: {
      next_step: "resume supervisor or repair ledger/run-state from this artifact; git commit already succeeded",
      expected_latest_dispatch: {
        seed_id: seed,
        status: "closed_clean",
        commit_pending: false,
        commit: metadata.commit,
        head_before: metadata.headBefore,
        head_after: metadata.headAfter,
        changed_path_allowlist: metadata.changedPathAllowlist,
      },
    },
    detail,
  });
  return path;
}

function createPerSeedCommit(seedstackDir: string, iteration: number, seed: string, dirtyPath: string, dirty: JsonObject): PerSeedCommitMetadata {
  const beforeStaged = stagedPaths();
  if (beforeStaged.length > 0) {
    stop(seedstackDir, iteration, "blocked", "preexisting_staged_changes_before_auto_commit", {
      seed,
      staged_paths: beforeStaged,
    });
  }
  const headBefore = currentHead();
  const expectedHead = expectedCommitHead(seedstackDir, seed);
  if (expectedHead && expectedHead !== headBefore) {
    stop(seedstackDir, iteration, "blocked", "commit_head_mismatch_before_auto_commit", {
      seed,
      expected_head: expectedHead,
      actual_head: headBefore,
    });
  }
  const paths = commitCandidatePaths(dirty);
  if (paths.length === 0) {
    stop(seedstackDir, iteration, "blocked", "no_seed_owned_paths_to_commit", { seed, dirty: dirtyPath });
  }
  let metadata: PerSeedCommitMetadata | null = null;
  try {
    runGit(["add", "-A", "-f", "--", ...paths]);
    const diff = runGit(["diff", "--cached", "--quiet"], true);
    if (diff.status === 0) {
      stop(seedstackDir, iteration, "blocked", "no_staged_seed_changes_to_commit", { seed, paths });
    }
    runGit(["commit", "-m", `seedstack: close ${seed}`]);
    const commit = runGit(["rev-parse", "HEAD"]).stdout;
    metadata = {
      commit,
      worktreeRoot: currentWorktreeRoot(),
      branch: currentBranch(),
      headBefore,
      headAfter: commit,
      gitCommonDir: currentGitCommonDir(),
      changedPathAllowlist: paths,
    };
  } catch (error) {
    runGit(["reset", "-q", "--", ...paths], true);
    stop(seedstackDir, iteration, "blocked", "auto_commit_failed", {
      seed,
      paths,
      error: (error as Error).message,
    });
  }
  if (!metadata) throw new Error("internal_error_missing_commit_metadata");
  try {
    appendCommitLedger(seedstackDir, seed, dirtyPath, metadata);
    return metadata;
  } catch (error) {
    const recovery = writePerSeedCommitRecoveryArtifact(seedstackDir, iteration, seed, "commit_ledger_append", metadata, {
      dirty_path: dirtyPath,
      error: (error as Error).message,
    });
    emit(seedstackDir, "per_seed_commit_recovery", { seed, phase: "commit_ledger_append", commit: metadata.commit, recovery });
    stop(seedstackDir, iteration, "blocked", "per_seed_commit_recovery_required", {
      seed,
      commit: metadata.commit,
      recovery,
      error: (error as Error).message,
    });
  }
}

function stop(seedstackDir: string, iteration: number, state: RunStateName, reason: string, detail: JsonObject = {}): never {
  if (dashboardCurrentTiming) {
    dashboardCurrentTiming.result = "failed";
    dashboardCurrentTiming.reason = reason;
    dashboardTimings.push(dashboardCurrentTiming);
    dashboardCurrentTiming = null;
  } else if (dashboardCurrentSeed) {
    dashboardTimings.push({ seed: dashboardCurrentSeed, result: "failed", reason });
  }
  dashboardCurrentSeed = null;
  dashboardCurrentPhase = "idle";
  const current = runStateName(loadRunState(seedstackDir));
  const next: RunStateName = state;
  try {
    const stopArgs = ["--stop-reason", reason];
    if (current === "dispatching" && (next === "blocked" || next === "escalated")) {
      const reconcile = stringField(detail.reconcile);
      if (reconcile) stopArgs.push("--reconcile-result", reconcile);
      else stopArgs.push("--allow-unreconciled-stop");
    }
    const check = transition(seedstackDir, iteration, current, next, stopArgs, true);
    emit(seedstackDir, "transition", { from: current, to: next, ok: ok(check), decision: decision(check), reason });
    if (ok(check)) {
      const boundaryHealth = stringField(detail.boundary_health);
      updateRunState(seedstackDir, iteration, next, [
        "--stop-reason",
        reason,
        "--blocked-reason",
        reason,
        ...(boundaryHealth ? ["--boundary-health-file", boundaryHealth] : []),
      ]);
    } else {
      emit(seedstackDir, "terminal_state_not_written", { reason, transition: latestArtifactPath(check) });
    }
  } catch (error) {
    emit(seedstackDir, "stop_state_update_failed", { reason, error: String((error as Error).message) });
  }
  finalEvent(seedstackDir, false, next, { reason, ...detail });
}

async function runCheckedChildStep(
  seedstackDir: string,
  iteration: number,
  role: ChildRole,
  seed: string,
  prompt: string,
  resultFile: string,
): Promise<ChildResult> {
  let child: ChildExit;
  try {
    child = await runChild(seedstackDir, iteration, role, seed, prompt, resultFile, optionsGlobal, (event, data = {}) =>
      emit(seedstackDir, event, data),
    );
  } catch (error) {
    stop(seedstackDir, iteration, "blocked", `${role}_child_launch_failed`, { seed, error: String((error as Error).message) });
  }
  if (child.timeout) {
    stop(seedstackDir, iteration, "blocked", `${role}_child_${child.timeout}_timeout`, {
      seed,
      exit_code: child.exitCode,
      signal: child.signal ?? null,
      elapsed_ms: child.elapsedMs ?? null,
      silent_ms: child.silentMs ?? null,
      result_path: resultFile,
    });
  }
  if (child.completedByResult) {
    try {
      return child.result ?? readChildResult(resultFile, role, seed);
    } catch (error) {
      stop(seedstackDir, iteration, "blocked", `${role}_child_missing_result`, { seed, error: String((error as Error).message) });
    }
  }
  if (child.exitCode !== 0) {
    try {
      const result = readChildResult(resultFile, role, seed);
      emit(seedstackDir, `${role}_child_result_after_nonzero_exit`, { seed, exit_code: child.exitCode, result_path: resultFile });
      return result;
    } catch (error) {
      stop(seedstackDir, iteration, "blocked", `${role}_child_failed`, {
        seed,
        exit_code: child.exitCode,
        result_path: resultFile,
        result_error: String((error as Error).message),
      });
    }
  }
  try {
    return readChildResult(resultFile, role, seed);
  } catch (error) {
    stop(seedstackDir, iteration, "blocked", `${role}_child_missing_result`, { seed, error: String((error as Error).message) });
  }
}

function discoverPriorDispatchChildResult(seedstackDir: string, seed: string, runState: JsonObject): { path: string; result: ChildResult } | null {
  const latest = isObject(runState.latest_dispatch) ? runState.latest_dispatch : {};
  const direct = stringField(latest.child_result_path);
  const candidates: string[] = [];
  if (direct) candidates.push(direct);
  const dir = loopDir(seedstackDir);
  if (existsSync(dir)) {
    const prefix = "-dispatch-";
    const suffix = ".result.json";
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(suffix)) continue;
      const prefixIndex = file.indexOf(prefix);
      if (prefixIndex < 0 || !/^\d+$/.test(file.slice(0, prefixIndex))) continue;
      const candidateSeed = file.slice(prefixIndex + prefix.length, -suffix.length);
      if (candidateSeed === seed) candidates.push(join(dir, file));
    }
  }
  const unique = [...new Set(candidates)].sort().reverse();
  for (const path of unique) {
    try {
      return { path, result: readChildResult(path, "dispatch", seed) };
    } catch {
      // Ignore stale or partial files; resume can still fall back to artifact reconciliation.
    }
  }
  return null;
}

function readAttemptRecord(path: string): ChildAttemptRecord | null {
  try {
    const raw = readJson(path);
    if (!isObject(raw) || raw.contract !== "seedstack_child_attempt.v1") return null;
    return raw as ChildAttemptRecord;
  } catch {
    return null;
  }
}

function discoverLatestChildAttempt(seedstackDir: string, role: ChildRole, seed: string): { path: string; record: ChildAttemptRecord } | null {
  const dir = childAttemptsDir(seedstackDir);
  if (!existsSync(dir)) return null;
  const suffix = `-${role}-${seed}.json`;
  const attempts = readdirSync(dir)
    .filter((file) => file.endsWith(suffix) && /^\d{4}-/.test(file))
    .sort()
    .reverse();
  for (const file of attempts) {
    const path = join(dir, file);
    const record = readAttemptRecord(path);
    if (record) return { path, record };
  }
  return null;
}

function dirtySnapshotImplPaths(snapshot: JsonObject): string[] {
  const direct = stringArray(snapshot.actual_impl_paths);
  if (direct.length) return direct;
  const paths = Array.isArray(snapshot.paths) ? snapshot.paths.filter(isObject) : [];
  return paths
    .map((entry) => stringField(entry.path))
    .filter((path): path is string => !!path && !path.startsWith("tmp/") && !path.startsWith(".seeds/"));
}

function validationHasCloseGate(validation: JsonObject): boolean {
  if (!ok(validation)) return false;
  const summary = isObject(validation.summary) ? validation.summary : {};
  const gate = isObject(summary.gate) ? summary.gate : {};
  return stringField(gate.decision)?.toLowerCase() === "close";
}

function writeFailureCapsule(
  seedstackDir: string,
  iteration: number,
  role: ChildRole,
  seed: string,
  reason: string,
  detail: JsonObject,
): string {
  const path = childFailureCapsulePath(seedstackDir, iteration, role, seed);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    `# ${role} child failure capsule`,
    "",
    `reason: ${reason}`,
    `seed: ${seed}`,
    `iteration: ${iteration}`,
    "",
    "```json",
    JSON.stringify(detail, null, 2),
    "```",
    "",
  ].join("\n"));
  return path;
}

function writeRecoveredChildResult(path: string, seed: string, roundPath: string, summary: JsonObject): ChildResult {
  const result: ChildResult = {
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "dispatch",
    seed,
    decision: "closed",
    round_path: roundPath,
    followups_requested: 0,
    followups_created: [],
    summary: { recovered_missing_result: true, ...summary },
  };
  const tmp = `${path}.tmp-${process.pid}`;
  writeJson(tmp, result);
  renameSync(tmp, path);
  return result;
}

function recoverMissingDispatchChildResult(
  seedstackDir: string,
  iteration: number,
  seed: string,
): { path: string; result: ChildResult } | null {
  const attempt = discoverLatestChildAttempt(seedstackDir, "dispatch", seed);
  if (!attempt) return null;
  const resultPathValue = attempt.record.result_path;
  try {
    return { path: resultPathValue, result: readChildResult(resultPathValue, "dispatch", seed) };
  } catch {
    // Missing or invalid result; reconcile via strict artifacts only when clean.
  }
  const dirtySnapshot = snapshotDirtyState(seedstackDir, iteration, `dispatch-missing-result-dirty-snapshot-${seed}`);
  emit(seedstackDir, "dispatch_missing_result_dirty_snapshot", { seed, path: latestArtifactPath(dirtySnapshot), attempt_path: attempt.path });
  const roundPath = join("tmp", "dispatch-work", seed, "round-1");
  const validation = dispatchWorkValidate(seedstackDir, iteration, seed, roundPath, latestArtifactPath(dirtySnapshot));
  emit(seedstackDir, "dispatch_missing_result_validation", { seed, ok: ok(validation), path: latestArtifactPath(validation), attempt_path: attempt.path });
  const implPaths = dirtySnapshotImplPaths(dirtySnapshot);
  if (validationHasCloseGate(validation) && implPaths.length === 0) {
    const recovered = writeRecoveredChildResult(resultPathValue, seed, roundPath, {
      attempt_path: attempt.path,
      validation_path: latestArtifactPath(validation),
      dirty_snapshot_path: latestArtifactPath(dirtySnapshot),
    });
    emit(seedstackDir, "dispatch_missing_result_recovered", { seed, result_path: resultPathValue, attempt_path: attempt.path });
    return { path: resultPathValue, result: recovered };
  }
  const capsule = writeFailureCapsule(seedstackDir, iteration, "dispatch", seed, "dispatch_child_missing_result", {
    attempt_path: attempt.path,
    result_path: resultPathValue,
    validation: latestArtifactPath(validation),
    dirty_snapshot: latestArtifactPath(dirtySnapshot),
    dirty_impl_paths: implPaths,
  });
  writeJson(resultPathValue, {
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "dispatch",
    seed,
    decision: "crashed",
    followups_requested: 0,
    followups_created: [],
    blocked_reason: "dispatch_child_missing_result",
    summary: {
      attempt_path: attempt.path,
      failure_capsule: capsule,
      validation: latestArtifactPath(validation),
      dirty_snapshot: latestArtifactPath(dirtySnapshot),
      dirty_impl_paths: implPaths,
    },
  });
  stop(seedstackDir, iteration, "blocked", implPaths.length > 0 ? "dispatch_missing_result_dirty_repo" : "dispatch_missing_result_incomplete_artifacts", {
    seed,
    attempt: attempt.path,
    result_path: resultPathValue,
    validation: latestArtifactPath(validation),
    dirty_snapshot: latestArtifactPath(dirtySnapshot),
    failure_capsule: capsule,
  });
}

function reconcileDispatchToManage(seedstackDir: string, iteration: number, seed: string, childResult?: ChildResult, childResultPath?: string): void {
  const roundPath = stringField(childResult?.round_path) ?? undefined;
  const nonclosedWithoutRound = childResult && childResult.decision !== "closed" && !roundPath;
  const dirtySnapshot = nonclosedWithoutRound ? null : snapshotDirtyState(seedstackDir, iteration, `dispatch-dirty-snapshot-${seed}`);
  if (dirtySnapshot) emit(seedstackDir, "dispatch_dirty_snapshot", { seed, path: latestArtifactPath(dirtySnapshot) });
  const exactValidation = nonclosedWithoutRound ? null : dispatchWorkValidate(seedstackDir, iteration, seed, roundPath, dirtySnapshot ? latestArtifactPath(dirtySnapshot) : undefined);
  if (exactValidation) emit(seedstackDir, "dispatch_exact_validation", { seed, ok: ok(exactValidation), path: latestArtifactPath(exactValidation) });
  const reconcile = nonclosedWithoutRound
    ? { ...readJson(syntheticChildReconcile(seedstackDir, iteration, seed, childResult, childResultPath)), __path: artifact(seedstackDir, `reconcile-${seed}`, iteration) } as JsonObject
    : runJson(seedstackDir, iteration, `reconcile-${seed}`, checkerPath("check-dispatch-reconcile.ts"), [
      "--repo",
      optionsGlobal.repo,
      "--worktree-policy",
      optionsGlobal.worktreePolicy,
      "--seed",
      seed,
      "--commit-policy",
      "none",
      "--seedstack-dir",
      seedstackDir,
      "--validation-policy",
      "loop",
      "--validation-file",
      latestArtifactPath(exactValidation as JsonObject),
      ...(dirtySnapshot ? ["--dirty-snapshot", latestArtifactPath(dirtySnapshot)] : []),
      "--pretty",
    ], true);
  emit(seedstackDir, "reconcile_result", { seed, ok: ok(reconcile), decision: decision(reconcile), path: latestArtifactPath(reconcile) });
  if (!ok(reconcile) || decision(reconcile) !== "manage_reconcile") {
    const reason = exactValidation && !ok(exactValidation) ? "dispatch_exact_validation_failed" : "dispatch_reconcile_blocked";
    stop(seedstackDir, iteration, decision(reconcile) === "blocked_escalation" ? "escalated" : "blocked", reason, {
      seed,
      validation: exactValidation ? latestArtifactPath(exactValidation) : null,
      reconcile: latestArtifactPath(reconcile),
    });
  }
  const check = transition(seedstackDir, iteration, "dispatching", "managing", [
    "--seed",
    seed,
    "--reconcile-result",
    latestArtifactPath(reconcile),
  ]);
  emit(seedstackDir, "transition", { from: "dispatching", to: "managing", ok: ok(check), decision: decision(check), seed });
  if (!ok(check)) stop(seedstackDir, iteration, "blocked", "dispatch_manage_transition_failed", { seed, transition: latestArtifactPath(check) });
  const latestDispatchPath = writeLoopJson(seedstackDir, iteration, `latest-dispatch-reconciled-${seed}`, {
    status: reconcileHasNonclosedDispatch(reconcile) ? "nonclosed_reconciled" : "closed_clean",
    child_decision: childResult?.decision ?? null,
    child_result_path: childResultPath ?? null,
  });
  updateRunState(seedstackDir, iteration, "managing", [
    "--seed",
    seed,
    "--decision",
    "manage_reconcile",
    "--rationale",
    "dispatch artifacts reconciled; entering manage",
    "--reconcile-result",
    latestArtifactPath(reconcile),
    "--latest-dispatch-file",
    latestDispatchPath,
  ]);
}

function skippedSeedIds(loopState: LoopState): Set<string> {
  return new Set(loopState.skipped_seeds.map((item) => item.seed));
}

function skippedSeedEvidenceArgs(loopState: LoopState): string[] {
  return loopState.skipped_seeds.flatMap((item) => ["--skipped-seed", `${item.seed}:${item.reason}`]);
}

function chooseCandidate(adoption: JsonObject, skipped: Set<string>): string | null {
  return stringArray(adoption.explicit_candidate_ids).find((seed) => !skipped.has(seed)) ?? null;
}

function recordSkippedSeed(seedstackDir: string, seed: string, reason: string, detail: JsonObject = {}): void {
  const loopState = loadLoopState(seedstackDir);
  if (!skippedSeedIds(loopState).has(seed)) {
    saveLoopState(seedstackDir, {
      ...loopState,
      skipped_seeds: [
        ...loopState.skipped_seeds,
        {
          seed,
          reason,
          at: new Date().toISOString(),
          ...(typeof detail.loop_cap === "string" ? { loop_cap: detail.loop_cap } : {}),
        },
      ],
    });
  }
  dashboardTimings.push({ seed, result: "skipped", reason });
  dashboardCurrentTiming = null;
  dashboardCurrentSeed = null;
  dashboardCurrentPhase = "idle";
  emit(seedstackDir, "seed_skipped", { seed, reason, ...detail });
}

function snapshotDirtyState(seedstackDir: string, iteration: number, label: string): JsonObject {
  return runJson(seedstackDir, iteration, label, checkerPath("snapshot-dirty-state.ts"), [
    "--repo",
    optionsGlobal.repo,
    "--worktree-policy",
    optionsGlobal.worktreePolicy,
    "--pretty",
  ], true);
}

function dispatchWorkValidate(
  seedstackDir: string,
  iteration: number,
  seed: string,
  roundPath?: string,
  dirtySnapshotPath?: string,
  queueMutationContext?: "dispatch" | "manager",
): JsonObject {
  const args = [
    "--repo",
    optionsGlobal.repo,
    "--seed",
    seed,
    "--dispatch-root",
    join(optionsGlobal.repo, "tmp", "dispatch-work"),
    "--validation-policy",
    "loop",
  ];
  if (roundPath) args.push("--round-path", roundPath);
  if (dirtySnapshotPath) args.push("--dirty-snapshot", dirtySnapshotPath);
  if (queueMutationContext) args.push("--queue-mutation-context", queueMutationContext);
  args.push("--pretty");
  return runJson(seedstackDir, iteration, `dispatch-work-validation-${seed}`, dispatchValidatorPath(), args, true);
}

function prepareFreshDispatchWorkspace(seedstackDir: string, seed: string): void {
  const dispatchRoot = join(optionsGlobal.repo, "tmp", "dispatch-work");
  const current = join(dispatchRoot, seed);
  if (!existsSync(current)) return;
  mkdirSync(dispatchRoot, { recursive: true });
  const archive = nextDispatchArchivePath(dispatchRoot, seed);
  renameSync(current, archive);
  emit(seedstackDir, "dispatch_workspace_archived", {
    seed,
    from: toRepoRel(current),
    to: toRepoRel(archive),
    reason: "fresh_dispatch_requires_empty_workdir",
  });
}

function nextDispatchArchivePath(dispatchRoot: string, seed: string): string {
  const prefix = `${seed}.archived-`;
  const used = new Set(
    existsSync(dispatchRoot)
      ? readdirSync(dispatchRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
        .map((entry) => entry.name)
      : [],
  );
  for (let index = 1; ; index += 1) {
    const name = `${prefix}${index}`;
    if (!used.has(name)) return join(dispatchRoot, name);
  }
}

function toRepoRel(path: string): string {
  return path.startsWith(`${optionsGlobal.repo}/`) ? path.slice(optionsGlobal.repo.length + 1) : path;
}

function expectedSeedPathsFromGate(seed: string): string[] {
  const gatePath = join(optionsGlobal.repo, "tmp", "dispatch-work", seed, "gate.md");
  if (!existsSync(gatePath)) return [];
  return parseGateExpectedSeedPaths(readFileSync(gatePath, "utf8"));
}

function runScan(seedstackDir: string, iteration: number, label: string): JsonObject {
  return runJson(seedstackDir, iteration, label, checkerPath("scan-seedspec-cli.ts"), [
    "--repo",
    optionsGlobal.repo,
    "--worktree-policy",
    optionsGlobal.worktreePolicy,
    ...(optionsGlobal.requireWorktree ? ["--require-worktree"] : []),
    "--cli",
    optionsGlobal.seedCli,
    "--adoption-selection",
    optionsGlobal.adoptionSelection,
    "--pretty",
  ], true);
}

function planPathFromState(runState: JsonObject): string | null {
  const plan = stringField(runState.plan);
  if (!plan) return null;
  return resolve(optionsGlobal.repo, plan);
}

function maybeRunBoundaryHealth(seedstackDir: string, iteration: number, seed: string, runState: JsonObject): JsonObject | null {
  if (optionsGlobal.boundaryHealth === "off") return null;
  const planPath = planPathFromState(runState);
  if (!planPath || !existsSync(planPath)) return null;
  let result: JsonObject;
  try {
    result = runJson(seedstackDir, iteration, `boundary-health-${seed}`, checkerPath("check-boundaries.ts"), [
      planPath,
      "--repo",
      optionsGlobal.repo,
      "--seed",
      seed,
      "--max-seed-target",
      String(optionsGlobal.maxSeedTarget),
      "--hot-file",
      String(optionsGlobal.hotFile),
      "--split-candidate",
      String(optionsGlobal.splitCandidate),
      "--pretty",
    ], true);
  } catch (error) {
    const message = (error as Error).message;
    emit(seedstackDir, "boundary_health_error", { seed, error: message });
    if (optionsGlobal.boundaryHealth === "block") {
      stop(seedstackDir, iteration, "blocked", "boundary_health_failed", { seed, error: message });
    }
    return null;
  }
  emit(seedstackDir, "boundary_health", {
    ok: ok(result),
    decision: decision(result),
    seed,
    path: latestArtifactPath(result),
  });
  if (decision(result) === "block" && optionsGlobal.boundaryHealth === "block") {
    stop(seedstackDir, iteration, "blocked", "boundary_health_blocked", {
      seed,
      boundary_health: latestArtifactPath(result),
    });
  }
  return result;
}

function scanListIds(scan: JsonObject): string[] {
  const ids = isObject(scan.ids) ? scan.ids : {};
  return stringArray(ids.list_ids);
}

function setDifference(after: string[], before: string[]): string[] {
  const seen = new Set(before);
  return after.filter((item) => !seen.has(item));
}

function verifyExistingDone(seedstackDir: string, iteration: number, loopState: LoopState): never {
  const scan = runScan(seedstackDir, iteration, "done-resume-scan");
  const nextLoopState = { ...loopState, scan_epoch: loopState.scan_epoch + 1 };
  saveLoopState(seedstackDir, nextLoopState);
  const open = stringArray(scan.open_adopted);
  const ready = stringArray(scan.adopted_ready_ids);
  emit(seedstackDir, "done_resume_scan", { ok: ok(scan), open_adopted: open, adopted_ready_ids: ready, path: latestArtifactPath(scan) });
  if (!ok(scan) || open.length > 0 || ready.length > 0 || nextLoopState.scan_epoch <= nextLoopState.manage_epoch) {
    finalEvent(seedstackDir, false, "blocked", {
      reason: "done_resume_not_proven",
      scan: latestArtifactPath(scan),
      scan_epoch: nextLoopState.scan_epoch,
      manage_epoch: nextLoopState.manage_epoch,
    });
  }
  finalEvent(seedstackDir, true, "done", { reason: "existing_done_revalidated", scan: latestArtifactPath(scan) });
}

function verifyExistingExhausted(seedstackDir: string, iteration: number, loopState: LoopState): never {
  const scan = runScan(seedstackDir, iteration, "exhausted-resume-scan");
  const nextLoopState = { ...loopState, scan_epoch: loopState.scan_epoch + 1 };
  saveLoopState(seedstackDir, nextLoopState);
  const remaining = [...new Set([...stringArray(scan.open_adopted), ...stringArray(scan.adopted_ready_ids)])];
  const skipped = new Map(nextLoopState.skipped_seeds.map((item) => [item.seed, item.reason]));
  const unproven = remaining.filter((id) => skipped.get(id) !== "blocked_attempt_cap");
  emit(seedstackDir, "exhausted_resume_scan", { ok: ok(scan), remaining, skipped_seeds: [...skipped.keys()], path: latestArtifactPath(scan) });
  if (!ok(scan) || remaining.length === 0 || unproven.length > 0 || nextLoopState.scan_epoch <= nextLoopState.manage_epoch) {
    finalEvent(seedstackDir, false, "blocked", {
      reason: "exhausted_resume_not_proven",
      scan: latestArtifactPath(scan),
      unproven,
      scan_epoch: nextLoopState.scan_epoch,
      manage_epoch: nextLoopState.manage_epoch,
    });
  }
  finalEvent(seedstackDir, true, "exhausted", { reason: "existing_exhausted_revalidated", scan: latestArtifactPath(scan) });
}

// ── Knowledge capture orchestration (wrappers) ──────────────────────────────

function runKnowledgeCaptureStep(seedstackDir: string, iteration: number, seed: string): void {
  const mode = optionsGlobal.knowledgeCapture;
  if (mode === "off") {
    emit(seedstackDir, "knowledge_capture", { seed, mode, ok: true, state: "off" });
    return;
  }
  let check = baseKnowledgeCaptureCheck(optionsGlobal.repo, seed, mode, runGit);
  if (mode === "record") check = recordKnowledgeCandidates(optionsGlobal.repo, check);
  const path = writeLoopJson(seedstackDir, iteration, `knowledge-capture-${seed}`, check);
  emit(seedstackDir, "knowledge_capture", {
    seed,
    mode,
    ok: ok(check),
    state: stringField(check.state) ?? null,
    path,
  });
  if (knowledgeCaptureBlocksRequired(check, optionsGlobal.knowledgeRequired)) {
    stop(seedstackDir, iteration, "blocked", "knowledge_capture_required_failed", {
      seed,
      knowledge_capture: path,
      state: stringField(check.state) ?? null,
    });
  }
}

function runRequiredKnowledgeCaptureAudit(seedstackDir: string, iteration: number, seed: string): void {
  if (!optionsGlobal.knowledgeRequired) return;
  const check = baseKnowledgeCaptureCheck(optionsGlobal.repo, seed, "audit", runGit);
  const path = writeLoopJson(seedstackDir, iteration, `knowledge-capture-required-${seed}`, check);
  emit(seedstackDir, "knowledge_capture_required", {
    seed,
    ok: ok(check),
    state: stringField(check.state) ?? null,
    path,
  });
  if (knowledgeCaptureBlocksRequired(check, optionsGlobal.knowledgeRequired)) {
    stop(seedstackDir, iteration, "blocked", "knowledge_capture_required_failed", {
      seed,
      knowledge_capture: path,
      state: stringField(check.state) ?? null,
    });
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function runLoop(): Promise<never> {
  const { seedstackDir, adoptionSelection } = optionsGlobal;
  mkdirSync(seedstackDir, { recursive: true });
  mkdirSync(loopDir(seedstackDir), { recursive: true });
  if (!existsSync(statePath(seedstackDir))) {
    updateRunState(seedstackDir, 0, "idle", ["--decision", "start", "--rationale", "seedstack-loop initialized"]);
  }

  emit(seedstackDir, "loop_start", {
    mode: optionsGlobal.mode,
    commit_policy: optionsGlobal.commitPolicy,
    knowledge_capture: optionsGlobal.knowledgeCapture,
    knowledge_required: optionsGlobal.knowledgeRequired,
    seedstack_dir: seedstackDir,
    adoption_selection: adoptionSelection,
    worktree_preflight: optionsGlobal.worktree,
    codex_reasoning_effort: optionsGlobal.codexReasoningEffort,
    followup_cap: optionsGlobal.followupCap,
    followups_per_manage: optionsGlobal.followupsPerManage,
  });

  for (let supervisorPass = 1; supervisorPass <= optionsGlobal.maxIterations; supervisorPass += 1) {
    const { iteration, loopState } = allocateSupervisorIteration(seedstackDir);
    const runState = loadRunState(seedstackDir);
    const current = runStateName(runState);
    emit(seedstackDir, "loop_iteration", {
      iteration,
      supervisor_pass: supervisorPass,
      state: current,
      loop_iteration: loopState.loop_iteration,
      scan_epoch: loopState.scan_epoch,
      manage_epoch: loopState.manage_epoch,
      total_followups: loopState.total_followups,
    });

    if (current === "done") {
      verifyExistingDone(seedstackDir, iteration, loopState);
    }
    if (current === "exhausted") {
      verifyExistingExhausted(seedstackDir, iteration, loopState);
    }
    if (current === "escalated") {
      const seed = canRecoverDispatchChildEscalation(runState);
      if (seed) {
        emit(seedstackDir, "recover_dispatch_child_escalation", { seed, reason: "dispatch_child_escalated" });
        updateRunState(seedstackDir, iteration, "dispatching", [
          "--seed",
          seed,
          "--decision",
          "continue",
          "--rationale",
          "recovering prior dispatch child escalation for manage reconciliation",
        ]);
        continue;
      }
    }

    if (current === "blocked" || current === "escalated" || current === "loop_cap") {
      finalEvent(seedstackDir, false, current, { reason: stringField(runState.stop_reason) ?? current });
    }

    if (current === "idle") {
      stopIfRequestedWhileIdle(seedstackDir, iteration);
    }

    if (current === "dispatching") {
      const seed = currentSeed(runState);
      if (!seed) stop(seedstackDir, iteration, "blocked", "missing_in_flight_seed");
      dashboardCurrentSeed = seed;
      dashboardCurrentPhase = "dispatch";
      dashboardPhaseStartedAt = Date.now();
      const priorChild = discoverPriorDispatchChildResult(seedstackDir, seed, runState);
      if (priorChild) {
        emit(seedstackDir, "recovered_dispatch_child_result", {
          seed,
          decision: priorChild.result.decision ?? null,
          result_path: priorChild.path,
        });
      }
      const recoveredChild = priorChild ?? recoverMissingDispatchChildResult(seedstackDir, iteration, seed);
      reconcileDispatchToManage(seedstackDir, iteration, seed, recoveredChild?.result, recoveredChild?.path);
      continue;
    }

    if (current === "managing") {
      const seed = currentSeed(runState);
      if (!seed) stop(seedstackDir, iteration, "blocked", "missing_manage_seed");
      dashboardCurrentSeed = seed;
      dashboardCurrentPhase = "manage";
      dashboardPhaseStartedAt = Date.now();
      if (!dashboardCurrentTiming) dashboardCurrentTiming = { seed, result: "ok" };
      const expectedSeedPaths = expectedSeedPathsFromGate(seed);
      const preDirty = runJson(seedstackDir, iteration, `pre-manage-dirty-${seed}`, checkerPath("classify-dirty-state.ts"), [
        "--repo",
        optionsGlobal.repo,
        "--worktree-policy",
        optionsGlobal.worktreePolicy,
        "--seedstack-dir",
        seedstackDir,
        "--dispatch-dir",
        "tmp/dispatch-work",
        "--seed",
        seed,
        ...expectedSeedPaths.flatMap((path) => ["--expected-seed", path]),
        "--dirty-policy",
        "loop",
        "--pretty",
      ], true);
      emit(seedstackDir, "pre_manage_dirty_check", { ok: ok(preDirty), seed, path: latestArtifactPath(preDirty), expected_seed_paths: expectedSeedPaths });
      if (!ok(preDirty)) stop(seedstackDir, iteration, "blocked", "unexpected_dirty_before_manage", { seed, dirty: latestArtifactPath(preDirty) });
      stopOnUnexpectedDirty(seedstackDir, iteration, seed, preDirty, "unexpected_dirty_before_manage");
      const preScan = runScan(seedstackDir, iteration, `pre-manage-scan-${seed}`);
      if (!ok(preScan)) stop(seedstackDir, iteration, "blocked", "scan_failed_before_manage", { seed, scan: latestArtifactPath(preScan) });
      const reconcilePath = reconcileArtifactPath(runState, seed);
      if (!reconcilePath || !existsSync(reconcilePath)) {
        stop(seedstackDir, iteration, "blocked", "missing_reconcile_result_path", { seed, reconcile: reconcilePath ?? null });
      }
      const resultFile = resultPath(seedstackDir, "manage", seed, iteration);
      const remaining = Math.max(0, optionsGlobal.followupCap - loopState.total_followups);
      const prompt = buildManagePrompt({
        repo: optionsGlobal.repo,
        seedstackDir,
        followupsPerManage: optionsGlobal.followupsPerManage,
        seed,
        reconcileFile: reconcilePath,
        resultFile,
        remainingFollowups: remaining,
      });
      dashboardCurrentSeed = seed;
      dashboardCurrentPhase = "manage";
      dashboardPhaseStartedAt = Date.now();
      const childResult = await runCheckedChildStep(seedstackDir, iteration, "manage", seed, prompt, resultFile);
      if (dashboardCurrentTiming) dashboardCurrentTiming.manage_ms = Date.now() - dashboardPhaseStartedAt;
      const proposedOps = proposedQueueOperations(childResult);
      emit(seedstackDir, "manage_queue_proposals", {
        seed,
        count: proposedOps.length,
        op_types: proposedOps.map((proposal) => stringField(proposal.op_type) ?? "unknown"),
        result_path: resultFile,
      });
      const postManageQueueDirtyPaths = queueDirtyPaths();
      if (postManageQueueDirtyPaths.length > 0) {
        const dirtyPath = writeLoopJson(seedstackDir, iteration, `post-manage-queue-dirty-${seed}`, {
          contract: "manage_queue_mutation_guard.v1",
          ok: false,
          seed,
          queue_dirty_paths: postManageQueueDirtyPaths,
          result_path: resultFile,
          message: "manage child must propose queue operations, not mutate .seeds/** directly",
        });
        stop(seedstackDir, iteration, "blocked", "manage_child_direct_queue_mutation", {
          seed,
          dirty: dirtyPath,
          queue_dirty_paths: postManageQueueDirtyPaths,
        });
      }
      if (childResult.decision === "blocked") {
        emit(seedstackDir, "manage_result", {
          seed,
          decision: childResult.decision,
          requested_followups: Math.max(followupCount(childResult), 0),
          observed_creates: 0,
          adopted_growth: Math.max(0, adoptedCountFromManifest(optionsGlobal.adoptionSelection) - loopState.baseline_seed_count),
          result_path: resultFile,
        });
        stop(seedstackDir, iteration, "blocked", stringField(childResult.blocked_reason) ?? "manage_blocked", { seed });
      }
      const proposedRequested = followupCount(childResult);
      if (proposedRequested > optionsGlobal.followupsPerManage) {
        emit(seedstackDir, "manage_result", {
          seed,
          decision: childResult.decision ?? null,
          requested_followups: proposedRequested,
          observed_creates: 0,
          adopted_growth: Math.max(0, adoptedCountFromManifest(optionsGlobal.adoptionSelection) - loopState.baseline_seed_count),
          result_path: resultFile,
        });
        stop(seedstackDir, iteration, "loop_cap", "followups_per_manage_cap", {
          seed,
          requested: proposedRequested,
          cap: optionsGlobal.followupsPerManage,
        });
      }
      if (loopState.total_followups + proposedRequested > optionsGlobal.followupCap) {
        emit(seedstackDir, "manage_result", {
          seed,
          decision: childResult.decision ?? null,
          requested_followups: proposedRequested,
          observed_creates: 0,
          adopted_growth: Math.max(0, adoptedCountFromManifest(optionsGlobal.adoptionSelection) - loopState.baseline_seed_count),
          result_path: resultFile,
        });
        stop(seedstackDir, iteration, "loop_cap", "followup_growth_cap", {
          seed,
          requested: proposedRequested,
          total_followups: loopState.total_followups,
          cap: optionsGlobal.followupCap,
        });
      }
      if (latestDispatchNonclosed(runState) && childResult.decision !== "retry_same_seed") {
        emit(seedstackDir, "manage_result", {
          seed,
          decision: childResult.decision ?? null,
          requested_followups: proposedRequested,
          observed_creates: 0,
          adopted_growth: Math.max(0, adoptedCountFromManifest(optionsGlobal.adoptionSelection) - loopState.baseline_seed_count),
          result_path: resultFile,
        });
        stop(seedstackDir, iteration, "blocked", "manage_nonclosed_continue_blocked", {
          seed,
          manage_decision: childResult.decision ?? null,
        });
      }
      const shouldApplyQueueOps = childResult.decision === "continue_other_seeds" || childResult.decision === "done";
      const requireClosedCurrent = shouldApplyQueueOps && latestDispatchClosedClean(runState);
      const hasNonNoopProposal = proposedOps.some((proposal) => stringField(proposal.op_type) !== "no-op");
      if (requireClosedCurrent && !hasCloseCurrentProposal(proposedOps, seed)) {
        const invariant = writeCloseCurrentInvariantArtifact(seedstackDir, iteration, seed, "missing_close_current_proposal", {
          decision: childResult.decision ?? null,
          proposal_count: proposedOps.length,
          op_types: proposedOps.map((proposal) => stringField(proposal.op_type) ?? "unknown"),
          result_path: resultFile,
        });
        stop(seedstackDir, iteration, "blocked", "manage_missing_close_current_proposal", {
          seed,
          invariant,
          manage_decision: childResult.decision ?? null,
        });
      }
      if (shouldApplyQueueOps) runRequiredKnowledgeCaptureAudit(seedstackDir, iteration, seed);
      if (shouldApplyQueueOps) {
        const queueOps = applyManageQueueOperations(seedstackDir, iteration, seed, preScan, reconcilePath, proposedOps);
        const queueOpsPath = writeLoopJson(seedstackDir, iteration, `manage-queue-ops-${seed}`, queueOps);
        emit(seedstackDir, "manage_queue_operations", {
          seed,
          ok: ok(queueOps),
          applied_count: typeof queueOps.applied_count === "number" ? queueOps.applied_count : 0,
          path: queueOpsPath,
        });
        if (!ok(queueOps)) {
          stop(seedstackDir, iteration, "blocked", "manage_queue_operation_precondition_failed", {
            seed,
            queue_operations: queueOpsPath,
            blockers: stringArray(queueOps.blockers),
          });
        }
      } else if (hasNonNoopProposal) {
        const queueOpsPath = writeLoopJson(seedstackDir, iteration, `manage-queue-ops-${seed}`, {
          contract: "manage_queue_operations.v1",
          ok: false,
          seed,
          proposal_count: proposedOps.length,
          applied_count: 0,
          blockers: [`manage decision ${String(childResult.decision)} cannot apply queue mutations`],
          before_seed_ids: scanListIds(preScan),
          after_seed_ids: scanListIds(preScan),
          queue_dirty_paths: queueDirtyPaths(),
          planned_commands: [],
          commands: [],
        });
        stop(seedstackDir, iteration, "blocked", "manage_queue_operation_precondition_failed", {
          seed,
          queue_operations: queueOpsPath,
          blockers: [`manage decision ${String(childResult.decision)} cannot apply queue mutations`],
        });
      }
      const postScan = runScan(seedstackDir, iteration, `post-manage-scan-${seed}`);
      if (!ok(postScan)) stop(seedstackDir, iteration, "blocked", "scan_failed_after_manage", { seed, scan: latestArtifactPath(postScan) });
      if (requireClosedCurrent && !scanProvesSeedClosed(postScan, seed)) {
        const invariant = writeCloseCurrentInvariantArtifact(seedstackDir, iteration, seed, "post_queue_scan_seed_not_closed", {
          decision: childResult.decision ?? null,
          post_scan: latestArtifactPath(postScan),
          issue: scanIssueById(postScan, seed),
          closed_adopted: stringArray(postScan.closed_adopted),
          open_adopted: stringArray(postScan.open_adopted),
        });
        stop(seedstackDir, iteration, "blocked", "manage_current_seed_not_closed", {
          seed,
          invariant,
          scan: latestArtifactPath(postScan),
        });
      }
      const observedCreates = setDifference(scanListIds(postScan), scanListIds(preScan)).length;
      const adoptedGrowth = Math.max(0, adoptedCountFromManifest(optionsGlobal.adoptionSelection) - loopState.baseline_seed_count);
      const requested = Math.max(followupCount(childResult), observedCreates, adoptedGrowth - loopState.total_followups);
      emit(seedstackDir, "manage_result", {
        seed,
        decision: childResult.decision ?? null,
        requested_followups: requested,
        observed_creates: observedCreates,
        adopted_growth: adoptedGrowth,
        result_path: resultFile,
      });
      if (requested > optionsGlobal.followupsPerManage) {
        stop(seedstackDir, iteration, "loop_cap", "followups_per_manage_cap", { seed, requested, cap: optionsGlobal.followupsPerManage });
      }
      if (loopState.total_followups + requested > optionsGlobal.followupCap) {
        stop(seedstackDir, iteration, "loop_cap", "followup_growth_cap", {
          seed,
          requested,
          total_followups: loopState.total_followups,
          cap: optionsGlobal.followupCap,
        });
      }
      const nextLoopState: LoopState = {
        ...loopState,
        manage_epoch: loopState.manage_epoch + 1,
        total_followups: Math.max(loopState.total_followups + requested, adoptedGrowth),
      };
      saveLoopState(seedstackDir, nextLoopState);
      if (childResult.decision === "retry_same_seed") {
        const retryAllocation = allocateSupervisorIteration(seedstackDir);
        const retryIteration = retryAllocation.iteration;
        const retryDirty = runJson(seedstackDir, retryIteration, `retry-dirty-${seed}`, checkerPath("classify-dirty-state.ts"), [
          "--repo",
          optionsGlobal.repo,
          "--worktree-policy",
          optionsGlobal.worktreePolicy,
          "--seedstack-dir",
          seedstackDir,
          "--dispatch-dir",
          "tmp/dispatch-work",
          "--seed",
          seed,
          ...expectedSeedPaths.flatMap((path) => ["--expected-seed", path]),
          "--dirty-policy",
          "loop",
          "--pretty",
        ], true);
        emit(seedstackDir, "retry_dirty_check", { ok: ok(retryDirty), seed, path: latestArtifactPath(retryDirty) });
        if (!ok(retryDirty)) stop(seedstackDir, retryIteration, "blocked", "unexpected_dirty_before_retry", { seed, dirty: latestArtifactPath(retryDirty) });
        stopOnUnexpectedDirty(seedstackDir, retryIteration, seed, retryDirty, "unexpected_dirty_before_retry");
        const retryCap = runJson(seedstackDir, retryIteration, `retry-loop-cap-${seed}`, checkerPath("check-loop-caps.ts"), [
          "--repo",
          optionsGlobal.repo,
          "--run-state",
          statePath(seedstackDir),
          "--seed",
          seed,
          "--followup-cap",
          String(optionsGlobal.followupCap),
          "--current-followups",
          String(nextLoopState.total_followups),
          "--pretty",
        ], true);
        emit(seedstackDir, "retry_loop_cap_check", { ok: ok(retryCap), decision: decision(retryCap), seed, path: latestArtifactPath(retryCap) });
        if (!ok(retryCap)) stop(seedstackDir, retryIteration, "blocked", decision(retryCap) ?? "retry_attempt_cap", { seed, loop_cap: latestArtifactPath(retryCap) });
        const retryCheck = transition(seedstackDir, retryIteration, "managing", "dispatching", [
          "--seed",
          seed,
          "--dirty-result",
          latestArtifactPath(retryDirty),
          "--loop-cap-result",
          latestArtifactPath(retryCap),
        ]);
        emit(seedstackDir, "transition", { from: "managing", to: "dispatching", ok: ok(retryCheck), decision: decision(retryCheck), seed, reason: "retry_same_seed" });
        if (!ok(retryCheck)) stop(seedstackDir, retryIteration, "blocked", "retry_transition_failed", { seed, transition: latestArtifactPath(retryCheck) });
        prepareFreshDispatchWorkspace(seedstackDir, seed);
        updateRunState(seedstackDir, retryIteration, "dispatching", [
          "--seed",
          seed,
          "--decision",
          "retry_same_seed",
          "--rationale",
          `manage requested same-seed retry for ${seed}`,
          "--dirty-result",
          latestArtifactPath(retryDirty),
        ]);
        const retryResultFile = resultPath(seedstackDir, "dispatch", seed, retryIteration);
        const retryPrompt = buildDispatchPrompt(optionsGlobal.repo, seed, retryResultFile);
        dashboardCurrentSeed = seed;
        dashboardCurrentPhase = "dispatch";
        dashboardPhaseStartedAt = Date.now();
        const retryDispatchResult = await runCheckedChildStep(seedstackDir, retryIteration, "dispatch", seed, retryPrompt, retryResultFile);
        if (dashboardCurrentTiming) dashboardCurrentTiming.dispatch_ms = Date.now() - dashboardPhaseStartedAt;
        reconcileDispatchToManage(seedstackDir, retryIteration, seed, retryDispatchResult, retryResultFile);
        continue;
      }
      let commitCheckPath: string | null = null;
      if (optionsGlobal.commitPolicy === "per_seed") {
        dashboardCurrentPhase = "commit";
        dashboardPhaseStartedAt = Date.now();
        const commitDirtySnapshot = snapshotDirtyState(seedstackDir, iteration, `commit-dirty-snapshot-${seed}`);
        emit(seedstackDir, "commit_dirty_snapshot", { seed, path: latestArtifactPath(commitDirtySnapshot) });
        const commitValidation = dispatchWorkValidate(seedstackDir, iteration, seed, undefined, latestArtifactPath(commitDirtySnapshot), "manager");
        const commitReconcile = runJson(seedstackDir, iteration, `commit-reconcile-${seed}`, checkerPath("check-dispatch-reconcile.ts"), [
          "--repo",
          optionsGlobal.repo,
          "--worktree-policy",
          optionsGlobal.worktreePolicy,
          "--seed",
          seed,
          "--commit-policy",
          "per_seed",
          "--seedstack-dir",
          seedstackDir,
          "--validation-policy",
          "loop",
          "--validation-file",
          latestArtifactPath(commitValidation),
          "--dirty-snapshot",
          latestArtifactPath(commitDirtySnapshot),
          ...expectedSeedPaths.flatMap((path) => ["--expected-seed", path]),
          "--pretty",
        ], true);
        emit(seedstackDir, "commit_reconcile_result", {
          seed,
          ok: ok(commitReconcile),
          decision: decision(commitReconcile),
          path: latestArtifactPath(commitReconcile),
        });
        if (!ok(commitReconcile) || decision(commitReconcile) !== "commit_ready") {
          stop(seedstackDir, iteration, "blocked", "commit_reconcile_blocked", {
            seed,
            reconcile: latestArtifactPath(commitReconcile),
          });
        }
        const dirty = isObject(commitReconcile.dirty) ? commitReconcile.dirty : null;
        if (!dirty) stop(seedstackDir, iteration, "blocked", "commit_reconcile_missing_dirty", { seed, reconcile: latestArtifactPath(commitReconcile) });
        const dirtyPath = writeLoopJson(seedstackDir, iteration, `commit-dirty-${seed}`, dirty);
        stopOnUnexpectedDirty(seedstackDir, iteration, seed, { ...dirty, __path: dirtyPath }, "unexpected_dirty_before_commit");
        const headBeforeCommit = currentHead();
        const pendingPath = writeLoopJson(seedstackDir, iteration, `latest-dispatch-pending-${seed}`, {
          status: "closed_clean",
          commit_pending: true,
          head_before: headBeforeCommit,
        });
        updateRunState(seedstackDir, iteration, "managing", [
          "--seed",
          seed,
          "--decision",
          "commit_ready",
          "--rationale",
          "per-seed commit ready; committing before next selection",
          "--dirty-result",
          dirtyPath,
          "--latest-dispatch-file",
          pendingPath,
        ]);
        const commitMetadata = createPerSeedCommit(seedstackDir, iteration, seed, dirtyPath, dirty);
        const committedPath = writeLoopJson(seedstackDir, iteration, `latest-dispatch-committed-${seed}`, {
          status: "closed_clean",
          commit_pending: false,
          head_before: commitMetadata.headBefore,
          head_after: commitMetadata.headAfter,
          changed_path_allowlist: commitMetadata.changedPathAllowlist,
        });
        try {
          updateRunState(seedstackDir, iteration, "managing", [
            "--seed",
            seed,
            "--decision",
            "committed",
            "--rationale",
            `per-seed commit ${commitMetadata.commit} recorded`,
            "--latest-dispatch-file",
            committedPath,
            "--commit",
            commitMetadata.commit,
          ]);
        } catch (error) {
          const recovery = writePerSeedCommitRecoveryArtifact(seedstackDir, iteration, seed, "run_state_update", commitMetadata, {
            latest_dispatch_file: committedPath,
            error: (error as Error).message,
          });
          emit(seedstackDir, "per_seed_commit_recovery", { seed, phase: "run_state_update", commit: commitMetadata.commit, recovery });
          stop(seedstackDir, iteration, "blocked", "per_seed_commit_recovery_required", {
            seed,
            commit: commitMetadata.commit,
            recovery,
            error: (error as Error).message,
          });
        }
        const ledger = runJson(seedstackDir, iteration, `commit-ledger-${seed}`, checkerPath("check-commit-ledger.ts"), [
          "--repo",
          optionsGlobal.repo,
          "--seedstack-dir",
          seedstackDir,
          "--run-state",
          statePath(seedstackDir),
          "--seed",
          seed,
          "--commit",
          commitMetadata.commit,
          "--commit-policy",
          "per_seed",
          ...expectedSeedPaths.flatMap((path) => ["--expected-path", path]),
          "--pretty",
        ], true);
        emit(seedstackDir, "commit_ledger_check", { seed, ok: ok(ledger), decision: decision(ledger), commit: commitMetadata.commit, path: latestArtifactPath(ledger) });
        if (!ok(ledger) || decision(ledger) !== "ledger_ready") {
          stop(seedstackDir, iteration, "blocked", "commit_ledger_blocked", { seed, commit: commitMetadata.commit, ledger: latestArtifactPath(ledger) });
        }
        commitCheckPath = latestArtifactPath(ledger);
        if (dashboardCurrentTiming) dashboardCurrentTiming.commit_ms = Date.now() - dashboardPhaseStartedAt;
      }
      runKnowledgeCaptureStep(seedstackDir, iteration, seed);
      if (dashboardCurrentTiming) { dashboardTimings.push(dashboardCurrentTiming); dashboardCurrentTiming = null; }
      dashboardCurrentSeed = null;
      dashboardCurrentPhase = "idle";
      const check = transition(seedstackDir, iteration, "managing", "idle", commitCheckPath ? ["--commit-check", commitCheckPath] : []);
      emit(seedstackDir, "transition", { from: "managing", to: "idle", ok: ok(check), decision: decision(check), seed });
      if (!ok(check)) stop(seedstackDir, iteration, "blocked", "manage_idle_transition_failed", { seed, transition: latestArtifactPath(check) });
      updateRunState(seedstackDir, iteration, "idle", [
        "--decision",
        "continue",
        "--rationale",
        "manage completed; returning to selection",
        "--event",
        `manage:seed ${seed} requested ${requested} followups`,
      ]);
      await postSeedCheckpoint(seedstackDir, iteration, seed);
      continue;
    }

    const scan = runScan(seedstackDir, iteration, "scan");
    const nextLoopState = { ...loopState, scan_epoch: loopState.scan_epoch + 1 };
    saveLoopState(seedstackDir, nextLoopState);
    emit(seedstackDir, "scan", {
      ok: ok(scan),
      health: stringField(scan.health),
      adopted_ready_ids: stringArray(scan.adopted_ready_ids),
      open_adopted: stringArray(scan.open_adopted),
      path: latestArtifactPath(scan),
    });
    if (!ok(scan)) stop(seedstackDir, iteration, "blocked", "scan_failed", { scan: latestArtifactPath(scan) });

    const adoption = runJson(seedstackDir, iteration, "adoption", checkerPath("check-adoption-selection.ts"), [
      "--repo",
      optionsGlobal.repo,
      "--adoption-selection",
      adoptionSelection,
      "--scan-file",
      latestArtifactPath(scan),
      "--pretty",
    ], true);
    emit(seedstackDir, "adoption_check", {
      ok: ok(adoption),
      candidates: stringArray(adoption.explicit_candidate_ids),
      path: latestArtifactPath(adoption),
    });
    if (!ok(adoption)) stop(seedstackDir, iteration, "blocked", "adoption_check_failed", { adoption: latestArtifactPath(adoption) });

    const skipped = skippedSeedIds(nextLoopState);
    const seed = chooseCandidate(adoption, skipped);
    if (!seed) {
      const openAdopted = stringArray(scan.open_adopted);
      const readyAdopted = stringArray(scan.adopted_ready_ids);
      const unskippedOpenAdopted = openAdopted.filter((id) => !skipped.has(id));
      const unskippedReadyAdopted = readyAdopted.filter((id) => !skipped.has(id));
      if ((openAdopted.length > 0 || readyAdopted.length > 0) && unskippedOpenAdopted.length === 0 && unskippedReadyAdopted.length === 0) {
        if (nextLoopState.scan_epoch <= nextLoopState.manage_epoch) {
          stop(seedstackDir, iteration, "blocked", "exhausted_without_post_manage_scan", {
            scan: latestArtifactPath(scan),
            skipped_seeds: [...skipped],
          });
        }
        const check = transition(seedstackDir, iteration, "idle", "exhausted", [
          "--scan-file",
          latestArtifactPath(scan),
          ...skippedSeedEvidenceArgs(nextLoopState),
        ]);
        emit(seedstackDir, "transition", { from: "idle", to: "exhausted", ok: ok(check), decision: decision(check), skipped_seeds: [...skipped] });
        if (!ok(check)) stop(seedstackDir, iteration, "blocked", "exhausted_transition_failed", { scan: latestArtifactPath(scan), skipped_seeds: [...skipped] });
        updateRunState(seedstackDir, iteration, "exhausted", [
          "--done-reason",
          "fresh scan found only skipped adopted ready/open seeds",
          "--event",
          `exhausted:skipped ${[...skipped].join(",")}`,
        ]);
        emit(seedstackDir, "exhausted", { scan_epoch: nextLoopState.scan_epoch, manage_epoch: nextLoopState.manage_epoch, skipped_seeds: [...skipped] });
        finalEvent(seedstackDir, true, "exhausted", { skipped_seeds: [...skipped] });
      }
      if (unskippedOpenAdopted.length > 0 || unskippedReadyAdopted.length > 0) {
        stop(seedstackDir, iteration, "blocked", "no_adopted_ready_with_open_adopted", {
          scan: latestArtifactPath(scan),
          open_adopted: unskippedOpenAdopted,
          adopted_ready_ids: unskippedReadyAdopted,
        });
      }
      if (nextLoopState.scan_epoch <= nextLoopState.manage_epoch) {
        stop(seedstackDir, iteration, "blocked", "done_without_post_manage_scan");
      }
      const check = transition(seedstackDir, iteration, "idle", "done", ["--scan-file", latestArtifactPath(scan)]);
      emit(seedstackDir, "transition", { from: "idle", to: "done", ok: ok(check), decision: decision(check) });
      if (!ok(check)) stop(seedstackDir, iteration, "blocked", "done_transition_failed", { scan: latestArtifactPath(scan) });
      updateRunState(seedstackDir, iteration, "done", ["--done-reason", "fresh scan found no adopted ready/open seeds"]);
      emit(seedstackDir, "done", { scan_epoch: nextLoopState.scan_epoch, manage_epoch: nextLoopState.manage_epoch });
      finalEvent(seedstackDir, true, "done");
    }

    stopOnPreexistingQueueDirtyBeforeAutoRun(seedstackDir, iteration, runState);

    const dirty = runJson(seedstackDir, iteration, "dirty", checkerPath("classify-dirty-state.ts"), [
      "--repo",
      optionsGlobal.repo,
      "--worktree-policy",
      optionsGlobal.worktreePolicy,
      "--seedstack-dir",
      seedstackDir,
      "--dispatch-dir",
      "tmp/dispatch-work",
      "--seed",
      seed,
      "--dirty-policy",
      "loop",
      "--pretty",
    ], true);
    emit(seedstackDir, "dirty_check", { ok: ok(dirty), seed, path: latestArtifactPath(dirty) });
    if (!ok(dirty)) stop(seedstackDir, iteration, "blocked", "unexpected_dirty", { seed, dirty: latestArtifactPath(dirty) });
    stopOnUnexpectedDirty(seedstackDir, iteration, seed, dirty, "unexpected_dirty");

    const loopCap = runJson(seedstackDir, iteration, "loop-cap", checkerPath("check-loop-caps.ts"), [
      "--repo",
      optionsGlobal.repo,
      "--run-state",
      statePath(seedstackDir),
      "--adoption-selection",
      adoptionSelection,
      "--scan-file",
      latestArtifactPath(scan),
      "--seed",
      seed,
      "--followup-cap",
      String(optionsGlobal.followupCap),
      "--current-followups",
      String(nextLoopState.total_followups),
      "--increment-loop",
      "--pretty",
    ], true);
    emit(seedstackDir, "loop_cap_check", { ok: ok(loopCap), decision: decision(loopCap), seed, path: latestArtifactPath(loopCap) });
    if (!ok(loopCap)) {
      const capDecision = decision(loopCap) ?? "loop_cap";
      if (optionsGlobal.mode === "auto" && capDecision === "blocked_attempt_cap") {
        const skipCheck = transition(seedstackDir, iteration, "idle", "idle", [
          "--seed",
          seed,
          "--scan-file",
          latestArtifactPath(scan),
          "--adoption-check",
          latestArtifactPath(adoption),
          "--dirty-result",
          latestArtifactPath(dirty),
          "--loop-cap-result",
          latestArtifactPath(loopCap),
        ]);
        emit(seedstackDir, "transition", { from: "idle", to: "idle", ok: ok(skipCheck), decision: decision(skipCheck), seed, reason: capDecision });
        if (!ok(skipCheck)) stop(seedstackDir, iteration, "blocked", "skip_transition_failed", { seed, loop_cap: latestArtifactPath(loopCap) });
        recordSkippedSeed(seedstackDir, seed, capDecision, { loop_cap: latestArtifactPath(loopCap) });
        updateRunState(seedstackDir, iteration, "idle", [
          "--decision",
          "continue",
          "--rationale",
          `skipped seed ${seed}: ${capDecision}`,
          "--event",
          `skip:seed ${seed} reason ${capDecision}`,
        ]);
        continue;
      }
      stop(seedstackDir, iteration, "loop_cap", capDecision, { seed, loop_cap: latestArtifactPath(loopCap) });
    }
    const loopCounts = isObject(loopCap.counts) ? loopCap.counts : {};
    const effectiveLoopIteration =
      numberField(loopCounts.effective_loop_iteration) ?? (numberField(runState.loop_iteration) ?? 0) + 1;
    const boundaryHealth = maybeRunBoundaryHealth(seedstackDir, iteration, seed, runState);
    const lateStopReason = stopAfterSeedReason(seedstackDir);
    if (lateStopReason) exitAfterSeedStop(seedstackDir, iteration, seed, lateStopReason);

    const check = transition(seedstackDir, iteration, "idle", "dispatching", [
      "--seed",
      seed,
      "--scan-file",
      latestArtifactPath(scan),
      "--adoption-check",
      latestArtifactPath(adoption),
      "--dirty-result",
      latestArtifactPath(dirty),
    ]);
    emit(seedstackDir, "transition", { from: "idle", to: "dispatching", ok: ok(check), decision: decision(check), seed });
    if (!ok(check)) stop(seedstackDir, iteration, "blocked", "idle_dispatch_transition_failed", { seed, transition: latestArtifactPath(check) });
    prepareFreshDispatchWorkspace(seedstackDir, seed);
    updateRunState(seedstackDir, iteration, "dispatching", [
      "--seed",
      seed,
      "--candidates-file",
      latestArtifactPath(adoption),
      "--decision",
      "continue",
      "--rationale",
      `selected explicit adopted ready seed ${seed}`,
      "--dirty-result",
      latestArtifactPath(dirty),
      ...(boundaryHealth ? ["--boundary-health-file", latestArtifactPath(boundaryHealth)] : []),
      ...(effectiveLoopIteration !== null ? ["--loop-iteration", String(effectiveLoopIteration)] : []),
    ]);

    const resultFile = resultPath(seedstackDir, "dispatch", seed, iteration);
    const prompt = buildDispatchPrompt(optionsGlobal.repo, seed, resultFile);
    dashboardCurrentSeed = seed;
    dashboardCurrentPhase = "dispatch";
    dashboardPhaseStartedAt = Date.now();
    dashboardCurrentTiming = { seed, result: "ok" };
    const dispatchResult = await runCheckedChildStep(seedstackDir, iteration, "dispatch", seed, prompt, resultFile);
    dashboardCurrentTiming.dispatch_ms = Date.now() - dashboardPhaseStartedAt;
    reconcileDispatchToManage(seedstackDir, iteration, seed, dispatchResult, resultFile);
    continue;
  }

  const { iteration } = allocateSupervisorIteration(optionsGlobal.seedstackDir);
  stop(optionsGlobal.seedstackDir, iteration, "loop_cap", "max_supervisor_iterations");
}

// ── Self-test adapter: export orchestrator functions for self-tests ──────────

export function getOptionsGlobal(): Options & { seedstackDir: string; adoptionSelection: string } {
  return optionsGlobal;
}

export function setOptionsForTest(opts: Options & { seedstackDir: string; adoptionSelection: string }): void {
  optionsGlobal = opts;
}

// ── Entry point ──────────────────────────────────────────────────────────────

let options: Options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await selfTestFn(options.pretty, {
      getOptionsGlobal,
      setOptionsForTest,
      loadLoopState,
      allocateSupervisorIteration,
      artifact,
      resultPath,
      runScan,
      ok,
      applyManageQueueOperations,
      recoverMissingDispatchChildResult,
      writePerSeedCommitRecoveryArtifact,
      runGit,
      commitCandidatePaths,
      parseGateExpectedSeedPaths,
      beforeFirstDispatch,
      runStateName,
      dispatchValidatorPath,
      snapshotDirtyState,
      dispatchWorkValidate,
    });
  }
  ensureInputs(options);
  optionsGlobal = options;
  await runLoop();
} catch (error) {
  const message = String((error as Error).message);
  const result = {
    contract: "seedstack_loop.v1",
    ok: false,
    state: "blocked",
    reason: message.includes("invalid_run_state") ? "invalid_run_state" : "tool_error",
    error: message,
  };
  if (optionsGlobal?.seedstackDir) {
    emit(optionsGlobal.seedstackDir, "final", result);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  process.exit(2);
}
