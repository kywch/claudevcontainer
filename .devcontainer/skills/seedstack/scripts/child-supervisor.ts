import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { childAttemptPath } from "./seedstack-paths.ts";

export type JsonObject = Record<string, unknown>;
export type ChildRole = "dispatch" | "manage";
export type ChildTimeoutKind = "total" | "silent";

export type ChildSupervisorOptions = {
  repo: string;
  codexBin: string;
  codexReasoningEffort: "low" | "medium" | "high" | "xhigh";
  runner: "codex" | "claude";
  claudeBin: string;
  claudeModel: string;
  pollMs: number;
  childTotalTimeoutMs: number;
  childSilentTimeoutMs: number;
  childSilentProbeMs: number;
};

export type ChildExit = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timeout?: ChildTimeoutKind;
  completedByResult?: boolean;
  result?: ChildResult;
  elapsedMs?: number;
  silentMs?: number;
};

export type ChildResult = {
  contract?: string;
  ok?: boolean;
  role?: string;
  seed?: string;
  decision?: string;
  round_path?: string;
  followups_requested?: number;
  followups_created?: string[];
  proposed_queue_operations?: JsonObject[];
  blocked_reason?: string;
  summary?: JsonObject;
};

export type ChildEmit = (event: string, data?: JsonObject) => void;

export type ChildAttemptRecord = {
  contract: "seedstack_child_attempt.v1";
  attempt_id: string;
  role: ChildRole;
  seed: string;
  iteration: number;
  result_path: string;
  prompt_path: string;
  log_path: string;
  pid: number | null;
  pgid: number | null;
  liveness_handle: string | null;
  process_identity: JsonObject;
  baseline_dirty_snapshot: JsonObject;
  heartbeat: JsonObject;
  state: "reserved" | "running" | "completed" | "timeout" | "failed" | "unknown_terminal_state";
  fencing_token: string;
  started_at: string;
  updated_at: string;
  ended_at?: string;
  exit_code?: number | null;
  signal?: string | null;
  timeout?: ChildTimeoutKind | null;
};

export const DEFAULT_CHILD_TOTAL_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_CHILD_SILENT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_CHILD_SILENT_PROBE_MS = 10 * 60 * 1000;

const CHILD_TERM_GRACE_MS = 10 * 1000;

function loopDir(seedstackDir: string): string {
  return join(seedstackDir, "loop");
}

function promptPath(seedstackDir: string, label: string, seed: string, iteration: number): string {
  mkdirSync(loopDir(seedstackDir), { recursive: true });
  return join(loopDir(seedstackDir), `${String(iteration).padStart(4, "0")}-${label}-${seed}.prompt.md`);
}

function logPath(seedstackDir: string, label: string, seed: string, iteration: number): string {
  mkdirSync(loopDir(seedstackDir), { recursive: true });
  return join(loopDir(seedstackDir), `${String(iteration).padStart(4, "0")}-${label}-${seed}.log`);
}

function resultPath(seedstackDir: string, label: string, seed: string, iteration: number): string {
  mkdirSync(loopDir(seedstackDir), { recursive: true });
  return join(loopDir(seedstackDir), `${String(iteration).padStart(4, "0")}-${label}-${seed}.result.json`);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function gitDirtySnapshot(repo: string): JsonObject {
  const proc = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  const stdout = proc.stdout ?? "";
  return {
    command: "git status --porcelain=v1 --untracked-files=all",
    exit_code: proc.status ?? null,
    stdout,
    paths: stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean),
  };
}

function processIdentity(pid: number | undefined, repo: string): JsonObject {
  if (!pid) return { pid: null, repo };
  const statPath = `/proc/${pid}/stat`;
  const cmdlinePath = `/proc/${pid}/cmdline`;
  const cwdPath = `/proc/${pid}/cwd`;
  let starttime: string | null = null;
  let cmdline: string | null = null;
  let cwd: string | null = null;
  try {
    const stat = readFileSync(statPath, "utf8").trim().split(/\s+/);
    starttime = stat[21] ?? null;
  } catch {
    starttime = null;
  }
  try {
    cmdline = readFileSync(cmdlinePath, "utf8").replace(/\0/g, " ").trim();
  } catch {
    cmdline = null;
  }
  try {
    cwd = readFileSync(cwdPath, "utf8");
  } catch {
    cwd = repo;
  }
  return { pid, starttime, cmdline, cwd };
}

function writeAttempt(path: string, record: ChildAttemptRecord): void {
  writeJson(path, record);
}

function withHeartbeat(record: ChildAttemptRecord, at: string, staleAfterMs: number): ChildAttemptRecord {
  return {
    ...record,
    heartbeat: { at, stale_after_ms: staleAfterMs },
    updated_at: at,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

const PROPOSED_QUEUE_OP_TYPES = new Set(["close-current", "create-follow-up", "add-dependency", "adjust-labels", "no-op"]);
const SUPPORTED_PRECONDITION_FACTS = new Set(["target_seed_open", "reconcile_artifact_exists"]);

function proposedQueueOperations(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function validateManageQueueProposals(result: ChildResult, seed: string): void {
  const proposals = proposedQueueOperations(result.proposed_queue_operations);
  if (!Array.isArray(result.proposed_queue_operations)) throw new Error("manage child result proposed_queue_operations must be array");
  for (const [index, proposal] of proposals.entries()) {
    const opType = stringField(proposal.op_type);
    if (!opType || !PROPOSED_QUEUE_OP_TYPES.has(opType)) throw new Error(`manage child proposal ${index} op_type invalid`);
    if (!stringField(proposal.target_seed)) throw new Error(`manage child proposal ${index} target_seed required`);
    if (!stringField(proposal.rationale)) throw new Error(`manage child proposal ${index} rationale required`);
    if (stringArray(proposal.source_artifact_refs).length === 0) throw new Error(`manage child proposal ${index} source_artifact_refs required`);
    proposal.expected_preconditions = normalizeExpectedPreconditions(proposal, index);
    if (proposal.advisory_notes !== undefined && stringArray(proposal.advisory_notes).length !== (Array.isArray(proposal.advisory_notes) ? proposal.advisory_notes.length : -1)) {
      throw new Error(`manage child proposal ${index} advisory_notes must be string array`);
    }
  }
  const nonNoop = proposals.filter((proposal) => proposal.op_type !== "no-op");
  if (result.decision !== "blocked" && result.decision !== "retry_same_seed" && nonNoop.length === 0) {
    throw new Error("manage child result requires proposed queue operation or blocked decision");
  }
  const closeCurrent = proposals.filter((proposal) => proposal.op_type === "close-current");
  if (closeCurrent.some((proposal) => proposal.target_seed !== seed)) {
    throw new Error("manage close-current proposal target_seed must match current seed");
  }
}

function normalizeExpectedPreconditions(proposal: JsonObject, index: number): string[] {
  if (!Array.isArray(proposal.expected_preconditions) || proposal.expected_preconditions.length === 0) {
    throw new Error(`manage child proposal ${index} expected_preconditions required`);
  }
  return proposal.expected_preconditions.map((precondition, itemIndex) => {
    const normalized = normalizePreconditionFact(precondition, proposal);
    if (!normalized) throw new Error(`manage child proposal ${index} expected_preconditions ${itemIndex} unsupported`);
    return normalized;
  });
}

function normalizePreconditionFact(value: unknown, proposal: JsonObject): string | null {
  const targetSeed = stringField(proposal.target_seed);
  const sourceRefs = stringArray(proposal.source_artifact_refs);
  if (typeof value === "string") {
    if (SUPPORTED_PRECONDITION_FACTS.has(value)) return preconditionFactToLegacy(value, targetSeed, sourceRefs[0]);
    const openMatch = /^\s*seed\s+([A-Za-z0-9._-]+)\s+is\s+still\s+open\s*$/.exec(value);
    if (openMatch) return `seed ${openMatch[1]} is still open`;
    const legacyOpenMatch = /^\s*([A-Za-z0-9._-]+)\s+is\s+still\s+open\s*$/.exec(value);
    if (legacyOpenMatch) return `seed ${legacyOpenMatch[1]} is still open`;
    const reconcileMatch = /^\s*latest dispatch reconcile result still matches\s+(.+?)\s*$/.exec(value);
    if (reconcileMatch) return `latest dispatch reconcile result still matches ${reconcileMatch[1]}`;
    return null;
  }
  if (!isObject(value)) return null;
  const fact = stringField(value.fact) ?? stringField(value.kind);
  if (!fact || !SUPPORTED_PRECONDITION_FACTS.has(fact)) return null;
  if (fact === "target_seed_open") {
    const seed = stringField(value.seed) ?? targetSeed;
    return seed ? `seed ${seed} is still open` : null;
  }
  const path = stringField(value.path) ?? sourceRefs[0];
  return path ? `latest dispatch reconcile result still matches ${path}` : null;
}

function preconditionFactToLegacy(fact: string, targetSeed: string | null, sourceRef: string | undefined): string | null {
  if (fact === "target_seed_open") return targetSeed ? `seed ${targetSeed} is still open` : null;
  if (fact === "reconcile_artifact_exists") return sourceRef ? `latest dispatch reconcile result still matches ${sourceRef}` : null;
  return null;
}

export function readChildResult(path: string, role: ChildRole, seed: string): ChildResult {
  if (!existsSync(path)) throw new Error(`${role} child did not write result file ${path}`);
  const raw = readJson(path);
  if (!isObject(raw)) throw new Error(`${role} child result must be object`);
  const result = raw as ChildResult;
  if (result.contract !== "seedstack_child_result.v1") throw new Error(`${role} child result contract invalid`);
  if (result.ok !== true) throw new Error(`${role} child result ok must be true`);
  if (result.role !== role) throw new Error(`${role} child result role mismatch`);
  if (result.seed !== seed) throw new Error(`${role} child result seed mismatch`);
  if (role === "dispatch") {
    if (result.decision !== "closed" && result.decision !== "blocked" && result.decision !== "escalated" && result.decision !== "crashed") {
      throw new Error("dispatch child result decision invalid");
    }
    if (result.decision === "closed" && !stringField(result.round_path)) {
      throw new Error("dispatch child result closed requires round_path");
    }
  } else {
    if (
      result.decision !== "continue" &&
      result.decision !== "continue_other_seeds" &&
      result.decision !== "retry_same_seed" &&
      result.decision !== "blocked" &&
      result.decision !== "done"
    ) {
      throw new Error("manage child result decision invalid");
    }
    if (result.decision === "continue") result.decision = "continue_other_seeds";
    validateManageQueueProposals(result, seed);
  }
  return result;
}

export function followupCount(result: ChildResult): number {
  const created = stringArray(result.followups_created);
  const requested = typeof result.followups_requested === "number" && Number.isFinite(result.followups_requested) ? result.followups_requested : 0;
  const proposedCreates = proposedQueueOperations(result.proposed_queue_operations).filter((proposal) => proposal.op_type === "create-follow-up").length;
  return Math.max(created.length, requested, proposedCreates);
}

function signalChildTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): JsonObject {
  const pid = child.pid;
  if (pid && process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return { target: "process_group", ok: true };
    } catch (error) {
      const processOk = child.kill(signal);
      return {
        target: "process",
        ok: processOk,
        process_group_error: String((error as Error).message),
      };
    }
  }
  return { target: "process", ok: child.kill(signal) };
}

function writeTimeoutChildResult(
  path: string,
  role: ChildRole,
  seed: string,
  kind: ChildTimeoutKind,
  elapsedMs: number,
  silentMs: number,
): ChildResult {
  if (existsSync(path)) {
    try {
      return readChildResult(path, role, seed);
    } catch {
      // Invalid partial child output must not prevent supervisor-owned timeout evidence.
    }
  }
  const result: ChildResult = {
    contract: "seedstack_child_result.v1",
    ok: true,
    role,
    seed,
    decision: "blocked",
    followups_requested: 0,
    followups_created: [],
    proposed_queue_operations: [
      {
        op_type: "no-op",
        target_seed: seed,
        rationale: `${role} child ${kind} timeout; supervisor should not mutate queue`,
        source_artifact_refs: [path],
        expected_preconditions: ["target_seed_open"],
        advisory_notes: ["timeout result generated by supervisor"],
      },
    ],
    blocked_reason: `${role}_child_${kind}_timeout`,
    summary: {
      timeout_kind: kind,
      elapsed_ms: elapsedMs,
      silent_ms: silentMs,
    },
  };
  writeJson(path, result);
  return result;
}

export async function runChild(
  seedstackDir: string,
  iteration: number,
  role: ChildRole,
  seed: string,
  prompt: string,
  resultFile: string,
  options: ChildSupervisorOptions,
  emit: ChildEmit,
): Promise<ChildExit> {
  const pPath = promptPath(seedstackDir, role, seed, iteration);
  const lPath = logPath(seedstackDir, role, seed, iteration);
  const attemptPath = childAttemptPath(seedstackDir, iteration, role, seed);
  const attemptId = `${String(iteration).padStart(4, "0")}-${role}-${seed}`;
  const startedAt = new Date().toISOString();
  const baseAttempt: ChildAttemptRecord = {
    contract: "seedstack_child_attempt.v1",
    attempt_id: attemptId,
    role,
    seed,
    iteration,
    result_path: resultFile,
    prompt_path: pPath,
    log_path: lPath,
    pid: null,
    pgid: null,
    liveness_handle: null,
    process_identity: { pid: null, repo: options.repo },
    baseline_dirty_snapshot: gitDirtySnapshot(options.repo),
    heartbeat: { at: startedAt, stale_after_ms: Math.max(options.childSilentTimeoutMs, options.pollMs * 2) },
    state: "reserved",
    fencing_token: `${attemptId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    started_at: startedAt,
    updated_at: startedAt,
  };
  writeFileSync(pPath, prompt);
  writeFileSync(lPath, "");
  rmSync(resultFile, { force: true });
  writeAttempt(attemptPath, baseAttempt);
  emit(`${role}_child_start`, { seed, prompt_path: pPath, log_path: lPath, result_path: resultFile, attempt_path: attemptPath });

  return await new Promise((resolvePromise, reject) => {
    const isClaudeRunner = options.runner === "claude";

    const [bin, spawnArgs] = isClaudeRunner
      ? [options.claudeBin, ["--dangerously-skip-permissions", "-p", "--output-format", "stream-json", "--verbose"]]
      : [
          options.codexBin,
          [
            "-c", `model_reasoning_effort="${options.codexReasoningEffort}"`,
            "-C", options.repo,
            "-s", "danger-full-access",
            "-a", "never",
            "exec", "-",
          ],
        ];

    const child = spawn(bin, spawnArgs, {
      cwd: options.repo,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SEEDSTACK_RESULT_FILE: resultFile },
    });
    let currentAttempt: ChildAttemptRecord = {
      ...baseAttempt,
      pid: child.pid ?? null,
      pgid: process.platform !== "win32" ? (child.pid ?? null) : null,
      liveness_handle: child.pid ? `pgid:${child.pid}` : null,
      process_identity: processIdentity(child.pid, options.repo),
      state: "running",
      updated_at: new Date().toISOString(),
    };
    writeAttempt(attemptPath, currentAttempt);
    emit(`${role}_child_launch_provenance`, {
      seed,
      launcher: isClaudeRunner ? "claude_cli_supervisor" : "codex_cli_supervisor",
      pid: child.pid ?? null,
      pgid: process.platform !== "win32" ? (child.pid ?? null) : null,
      session_id: process.platform !== "win32" ? (child.pid ?? null) : null,
      detached: process.platform !== "win32",
      liveness_handle: child.pid ? `pgid:${child.pid}` : null,
      ...(isClaudeRunner
        ? { claude_model: options.claudeModel }
        : { codex_reasoning_effort: options.codexReasoningEffort }),
      result_path: resultFile,
      attempt_path: attemptPath,
      result_is_child_run_status_evidence: false,
    });
    const started = Date.now();
    let lastProgress = started;
    let timeout: ChildTimeoutKind | undefined;
    let completedByResult = false;
    let cachedResult: ChildResult | undefined;
    let timeoutElapsedMs: number | undefined;
    let timeoutSilentMs: number | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const heartbeatTimer = setInterval(() => {
      const now = new Date().toISOString();
      currentAttempt = withHeartbeat(currentAttempt, now, Math.max(options.childSilentTimeoutMs, options.pollMs * 2));
      writeAttempt(attemptPath, currentAttempt);
      emit(`${role}_heartbeat`, { seed, seconds: Math.floor((Date.now() - started) / 1000) });
    }, options.pollMs);
    const totalTimer = setTimeout(() => triggerTimeout("total"), options.childTotalTimeoutMs);
    const probeTimer = setInterval(() => {
      const now = Date.now();
      const silentMs = now - lastProgress;
      emit(`${role}_child_probe`, {
        seed,
        elapsed_ms: now - started,
        silent_ms: silentMs,
        total_timeout_ms: options.childTotalTimeoutMs,
        silent_timeout_ms: options.childSilentTimeoutMs,
      });
      if (silentMs >= options.childSilentTimeoutMs) triggerTimeout("silent");
    }, options.childSilentProbeMs);
    const resultTimer = setInterval(() => {
      if (timeout || completedByResult || !existsSync(resultFile)) return;
      completeByResult("result_ready");
    }, Math.min(5000, Math.max(250, options.pollMs)));

    function cleanupTimers(): void {
      clearInterval(heartbeatTimer);
      clearInterval(probeTimer);
      clearInterval(resultTimer);
      clearTimeout(totalTimer);
      if (killTimer) clearTimeout(killTimer);
    }

    function noteProgress(chunk: Buffer): void {
      lastProgress = Date.now();
      writeFileSync(lPath, chunk, { flag: "a" });
    }

    function triggerTimeout(kind: ChildTimeoutKind): void {
      if (timeout || completedByResult) return;
      if (completeByResult("result_ready_before_timeout")) return;
      const now = Date.now();
      timeout = kind;
      timeoutElapsedMs = now - started;
      timeoutSilentMs = now - lastProgress;
      cachedResult = writeTimeoutChildResult(resultFile, role, seed, kind, timeoutElapsedMs, timeoutSilentMs);
      const endedAt = new Date().toISOString();
      currentAttempt = {
        ...currentAttempt,
        state: "timeout",
        heartbeat: { at: endedAt, stale_after_ms: Math.max(options.childSilentTimeoutMs, options.pollMs * 2) },
        updated_at: endedAt,
        ended_at: endedAt,
        timeout: kind,
        exit_code: null,
        signal: "SIGTERM",
      };
      writeAttempt(attemptPath, currentAttempt);
      emit(`${role}_child_timeout`, {
        seed,
        kind,
        elapsed_ms: timeoutElapsedMs,
        silent_ms: timeoutSilentMs,
        result_path: resultFile,
      });
      emit(`${role}_child_signal`, { seed, signal: "SIGTERM", ...signalChildTree(child, "SIGTERM") });
      killTimer = setTimeout(() => {
        emit(`${role}_child_signal`, { seed, signal: "SIGKILL", ...signalChildTree(child, "SIGKILL") });
      }, CHILD_TERM_GRACE_MS);
    }

    function completeByResult(reason: string): boolean {
      if (completedByResult) return true;
      let result: ChildResult;
      try {
        result = readChildResult(resultFile, role, seed);
      } catch {
        return false;
      }
      cachedResult = result;
      completedByResult = true;
      emit(`${role}_child_result_ready`, { seed, result_path: resultFile });
      emit(`${role}_child_signal`, { seed, signal: "SIGTERM", reason, ...signalChildTree(child, "SIGTERM") });
      killTimer = setTimeout(() => {
        emit(`${role}_child_signal`, { seed, signal: "SIGKILL", reason, ...signalChildTree(child, "SIGKILL") });
      }, CHILD_TERM_GRACE_MS);
      return true;
    }

    child.stdout.on("data", noteProgress);
    child.stderr.on("data", noteProgress);
    child.on("error", (error) => {
      cleanupTimers();
      const endedAt = new Date().toISOString();
      currentAttempt = {
        ...currentAttempt,
        state: "failed",
        heartbeat: { at: endedAt, stale_after_ms: Math.max(options.childSilentTimeoutMs, options.pollMs * 2) },
        updated_at: endedAt,
        ended_at: endedAt,
        exit_code: null,
        signal: null,
        timeout: null,
      };
      writeAttempt(attemptPath, currentAttempt);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      cleanupTimers();
      if (!timeout) {
        const endedAt = new Date().toISOString();
        currentAttempt = {
          ...currentAttempt,
          state: exitCode === 0 ? "completed" : "failed",
          heartbeat: { at: endedAt, stale_after_ms: Math.max(options.childSilentTimeoutMs, options.pollMs * 2) },
          updated_at: endedAt,
          ended_at: endedAt,
          exit_code: exitCode,
          signal: signal ?? null,
          timeout: null,
        };
        writeAttempt(attemptPath, currentAttempt);
      }
      emit(`${role}_child_exit`, {
        seed,
        exit_code: exitCode,
        signal: signal ?? null,
        timeout: timeout ?? null,
        completed_by_result: completedByResult,
        log_path: lPath,
      });
      resolvePromise({ exitCode, signal, timeout, completedByResult, result: cachedResult, elapsedMs: timeoutElapsedMs, silentMs: timeoutSilentMs });
    });
    child.stdin.end(prompt);
  });
}

export async function runChildTimeoutSelfTest(assertSelfTest: (condition: unknown, message: string) => void): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "seedstack-loop-self-test-"));
  try {
    const seedstackDir = join(tmp, "stack");
    const fakeCodex = join(tmp, "fake-codex");
    mkdirSync(seedstackDir, { recursive: true });
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bun
process.stdin.resume();
setInterval(() => {}, 1000);
`,
    );
    chmodSync(fakeCodex, 0o755);

    const baseOptions: ChildSupervisorOptions = {
      repo: tmp,
      codexBin: fakeCodex,
      codexReasoningEffort: "medium",
      claudeBin: "claude",
      claudeModel: "claude-sonnet-4-6",
      runner: "codex",
      pollMs: 10,
      childTotalTimeoutMs: 5000,
      childSilentTimeoutMs: 50,
      childSilentProbeMs: 10,
    };
    const events: Array<{ event: string; data: JsonObject }> = [];
    const emit: ChildEmit = (event, data = {}) => {
      events.push({ event, data });
    };

    const manageResultFile = resultPath(seedstackDir, "manage", "seed-test", 1);
    const child = await runChild(seedstackDir, 1, "manage", "seed-test", "self-test prompt", manageResultFile, baseOptions, emit);
    assertSelfTest(child.timeout === "silent", "silent timeout returned");
    assertSelfTest(child.silentMs !== undefined && child.silentMs >= 50, "silent timeout measured");
    const result = readJson(manageResultFile);
    assertSelfTest(isObject(result) && result.decision === "blocked", "timeout wrote blocked child result");
    assertSelfTest(isObject(result) && result.blocked_reason === "manage_child_silent_timeout", "timeout blocked reason");
    const launchProvenance = events.find((item) => item.event === "manage_child_launch_provenance");
    assertSelfTest(isObject(launchProvenance?.data), "launch provenance emitted");
    assertSelfTest(launchProvenance?.data.launcher === "codex_cli_supervisor", "launch provenance launcher");
    assertSelfTest(launchProvenance?.data.codex_reasoning_effort === "medium", "launch provenance reasoning effort");
    assertSelfTest(typeof launchProvenance?.data.liveness_handle === "string", "launch provenance liveness handle");
    assertSelfTest(launchProvenance?.data.result_is_child_run_status_evidence === false, "result is not child_run_status evidence");

    const totalOptions = {
      ...baseOptions,
      childTotalTimeoutMs: 50,
      childSilentTimeoutMs: 5000,
      childSilentProbeMs: 10,
    };
    const dispatchResultFile = resultPath(seedstackDir, "dispatch", "seed-test-total", 2);
    const totalChild = await runChild(
      seedstackDir,
      2,
      "dispatch",
      "seed-test-total",
      "self-test prompt",
      dispatchResultFile,
      totalOptions,
      emit,
    );
    assertSelfTest(totalChild.timeout === "total", "total timeout returned");
    const totalResult = readJson(dispatchResultFile);
    assertSelfTest(isObject(totalResult) && totalResult.decision === "blocked", "total timeout wrote blocked child result");
    assertSelfTest(isObject(totalResult) && totalResult.blocked_reason === "dispatch_child_total_timeout", "total timeout blocked reason");

    const partialCodex = join(tmp, "partial-codex");
    writeFileSync(
      partialCodex,
      `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const result = process.env.SEEDSTACK_RESULT_FILE;
if (!result) process.exit(2);
writeFileSync(result, "{");
process.stdin.resume();
setInterval(() => {}, 1000);
`,
    );
    chmodSync(partialCodex, 0o755);
    const partialResultFile = resultPath(seedstackDir, "manage", "seed-test-partial", 5);
    const partialChild = await runChild(
      seedstackDir,
      5,
      "manage",
      "seed-test-partial",
      "self-test prompt",
      partialResultFile,
      { ...baseOptions, codexBin: partialCodex },
      emit,
    );
    assertSelfTest(partialChild.timeout === "silent", "partial result timeout returned");
    const partialResult = readJson(partialResultFile);
    assertSelfTest(isObject(partialResult) && partialResult.blocked_reason === "manage_child_silent_timeout", "partial result overwritten by timeout");

    const resultReadyCodex = join(tmp, "result-ready-codex");
    const linkedWorktree = join(tmp, "linked-worktree");
    const launchRecord = join(tmp, "result-ready-launch.json");
    mkdirSync(linkedWorktree, { recursive: true });
    writeFileSync(
      resultReadyCodex,
      `#!/usr/bin/env bun
	import { writeFileSync } from "node:fs";
	const result = process.env.SEEDSTACK_RESULT_FILE;
	if (!result) process.exit(2);
	writeFileSync(${JSON.stringify(launchRecord)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }, null, 2) + "\\n");
	writeFileSync(result, JSON.stringify({
	  contract: "seedstack_child_result.v1",
	  ok: true,
	  role: "dispatch",
  seed: "seed-test-ready",
  decision: "blocked",
  followups_requested: 0,
  followups_created: [],
  blocked_reason: "self_test_done"
}, null, 2) + "\\n");
setInterval(() => {}, 1000);
`,
    );
    chmodSync(resultReadyCodex, 0o755);
    const resultReadyFile = resultPath(seedstackDir, "dispatch", "seed-test-ready", 3);
    const resultReadyChild = await runChild(
      seedstackDir,
      3,
      "dispatch",
      "seed-test-ready",
      "self-test prompt",
      resultReadyFile,
      { ...baseOptions, repo: linkedWorktree, codexBin: resultReadyCodex, childSilentTimeoutMs: 5000 },
      emit,
    );
    assertSelfTest(resultReadyChild.completedByResult === true, "result-ready child returned");
    assertSelfTest(resultReadyChild.timeout === undefined, "result-ready child did not timeout");
    assertSelfTest(resultReadyChild.result?.blocked_reason === "self_test_done", "result-ready child cached result");
    const launchArgs = readJson(launchRecord);
    assertSelfTest(isObject(launchArgs) && launchArgs.cwd === linkedWorktree, "child cwd uses normalized worktree repo");
    assertSelfTest(
      isObject(launchArgs) && Array.isArray(launchArgs.argv) && launchArgs.argv.includes("-C") && launchArgs.argv.includes(linkedWorktree),
      "codex child -C uses normalized worktree repo",
    );

    const legacyManageFile = resultPath(seedstackDir, "manage", "seed-test-legacy", 6);
    writeJson(legacyManageFile, {
      contract: "seedstack_child_result.v1",
      ok: true,
      role: "manage",
      seed: "seed-test-legacy",
      decision: "continue",
      followups_requested: 0,
      followups_created: [],
      proposed_queue_operations: [
        {
          op_type: "close-current",
          target_seed: "seed-test-legacy",
          rationale: "self-test close proposal",
          source_artifact_refs: [legacyManageFile],
          expected_preconditions: ["seed-test-legacy is still open", `latest dispatch reconcile result still matches ${legacyManageFile}`],
          details: {},
        },
      ],
    });
    const legacyResult = readChildResult(legacyManageFile, "manage", "seed-test-legacy");
    assertSelfTest(legacyResult.decision === "continue_other_seeds", "legacy continue normalized");
    assertSelfTest(
      proposedQueueOperations(legacyResult.proposed_queue_operations)[0]?.expected_preconditions?.[0] === "seed seed-test-legacy is still open" &&
        proposedQueueOperations(legacyResult.proposed_queue_operations)[0]?.expected_preconditions?.[1] === `latest dispatch reconcile result still matches ${legacyManageFile}`,
      "legacy free-text precondition migrates to supported fact",
    );

    const objectManageFile = resultPath(seedstackDir, "manage", "seed-test-object", 8);
    writeJson(objectManageFile, {
      contract: "seedstack_child_result.v1",
      ok: true,
      role: "manage",
      seed: "seed-test-object",
      decision: "continue_other_seeds",
      followups_requested: 0,
      followups_created: [],
      proposed_queue_operations: [
        {
          op_type: "close-current",
          target_seed: "seed-test-object",
          rationale: "self-test close proposal",
          source_artifact_refs: [objectManageFile],
          expected_preconditions: [
            { fact: "target_seed_open", seed: "seed-test-object" },
            { fact: "reconcile_artifact_exists", path: objectManageFile },
          ],
          advisory_notes: ["object preconditions are closed schema"],
          details: {},
        },
      ],
    });
    const objectResult = readChildResult(objectManageFile, "manage", "seed-test-object");
    const objectPreconditions = proposedQueueOperations(objectResult.proposed_queue_operations)[0]?.expected_preconditions;
    assertSelfTest(
      Array.isArray(objectPreconditions) &&
        objectPreconditions[0] === "seed seed-test-object is still open" &&
        objectPreconditions[1] === `latest dispatch reconcile result still matches ${objectManageFile}`,
      "object preconditions normalize to supervisor-supported legacy checks",
    );

    const claudeOptions = { ...baseOptions, runner: "claude" as const, claudeBin: fakeCodex };
    const claudeResultFile = resultPath(seedstackDir, "manage", "seed-test-claude", 7);
    await runChild(seedstackDir, 7, "manage", "seed-test-claude", "self-test prompt", claudeResultFile, claudeOptions, emit);
    const claudeProvenance = events.find(
      (e) => e.event === "manage_child_launch_provenance" && e.data.seed === "seed-test-claude"
    );
    assertSelfTest(claudeProvenance?.data.launcher === "claude_cli_supervisor", "claude runner launcher name");
    assertSelfTest("claude_model" in (claudeProvenance?.data ?? {}), "claude runner emits model");
    assertSelfTest(!("codex_reasoning_effort" in (claudeProvenance?.data ?? {})), "claude runner omits codex effort");

    const raceCodex = join(tmp, "race-codex");
    writeFileSync(
      raceCodex,
      `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const result = process.env.SEEDSTACK_RESULT_FILE;
if (!result) process.exit(2);
setTimeout(() => {
  writeFileSync(result, JSON.stringify({
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "manage",
    seed: "seed-test-race",
    decision: "blocked",
    followups_requested: 0,
    followups_created: [],
    proposed_queue_operations: [{
      op_type: "no-op",
      target_seed: "seed-test-race",
      rationale: "self-test blocked result",
      source_artifact_refs: [result],
      expected_preconditions: ["target_seed_open"],
      advisory_notes: ["blocked result is not applied"]
    }],
    blocked_reason: "self_test_done"
  }, null, 2) + "\\n");
}, 20);
setInterval(() => {}, 1000);
`,
    );
    chmodSync(raceCodex, 0o755);
    const raceResultFile = resultPath(seedstackDir, "manage", "seed-test-race", 4);
    const raceChild = await runChild(
      seedstackDir,
      4,
      "manage",
      "seed-test-race",
      "self-test prompt",
      raceResultFile,
      { ...baseOptions, codexBin: raceCodex, childSilentTimeoutMs: 500, childSilentProbeMs: 25 },
      emit,
    );
    assertSelfTest(raceChild.completedByResult === true, "valid result wins timeout race");
    assertSelfTest(raceChild.timeout === undefined, "timeout race did not write timeout");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
