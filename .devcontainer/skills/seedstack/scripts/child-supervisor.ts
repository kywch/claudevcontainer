import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  blocked_reason?: string;
  summary?: JsonObject;
};

export type ChildEmit = (event: string, data?: JsonObject) => void;

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
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
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
  }
  return result;
}

export function followupCount(result: ChildResult): number {
  const created = stringArray(result.followups_created);
  const requested = typeof result.followups_requested === "number" && Number.isFinite(result.followups_requested) ? result.followups_requested : 0;
  return Math.max(created.length, requested);
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
  writeFileSync(pPath, prompt);
  writeFileSync(lPath, "");
  rmSync(resultFile, { force: true });
  emit(`${role}_child_start`, { seed, prompt_path: pPath, log_path: lPath, result_path: resultFile });

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
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      cleanupTimers();
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
    writeFileSync(
      resultReadyCodex,
      `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const result = process.env.SEEDSTACK_RESULT_FILE;
if (!result) process.exit(2);
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
      { ...baseOptions, codexBin: resultReadyCodex, childSilentTimeoutMs: 5000 },
      emit,
    );
    assertSelfTest(resultReadyChild.completedByResult === true, "result-ready child returned");
    assertSelfTest(resultReadyChild.timeout === undefined, "result-ready child did not timeout");
    assertSelfTest(resultReadyChild.result?.blocked_reason === "self_test_done", "result-ready child cached result");

    const legacyManageFile = resultPath(seedstackDir, "manage", "seed-test-legacy", 6);
    writeJson(legacyManageFile, {
      contract: "seedstack_child_result.v1",
      ok: true,
      role: "manage",
      seed: "seed-test-legacy",
      decision: "continue",
      followups_requested: 0,
      followups_created: [],
    });
    assertSelfTest(readChildResult(legacyManageFile, "manage", "seed-test-legacy").decision === "continue_other_seeds", "legacy continue normalized");

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
      { ...baseOptions, codexBin: raceCodex, childSilentTimeoutMs: 50, childSilentProbeMs: 10 },
      emit,
    );
    assertSelfTest(raceChild.completedByResult === true, "valid result wins timeout race");
    assertSelfTest(raceChild.timeout === undefined, "timeout race did not write timeout");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
