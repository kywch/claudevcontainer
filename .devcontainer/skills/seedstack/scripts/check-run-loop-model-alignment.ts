#!/usr/bin/env bun
// Fixture links between the Quint run-loop model and runtime checkers.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { followupCount, readChildResult } from "./child-supervisor.ts";

type JsonObject = Record<string, unknown>;
type Finding = { code?: unknown };
type CaseResult = { name: string; pass: boolean; detail?: unknown };

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SCRIPT_DIR, "..", "..", "..");

function writeJson(path: string, value: unknown): string {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findings(value: unknown): Finding[] {
  return Array.isArray(value) ? (value.filter(isObject) as Finding[]) : [];
}

function hasFinding(result: JsonObject, code: string): boolean {
  return findings(result.blockers).some((finding) => finding.code === code);
}

function runJson(script: string, args: string[]): JsonObject {
  const proc = spawnSync(process.execPath, [join(SCRIPT_DIR, script), "--repo", REPO, ...args, "--pretty"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = proc.stdout.trim();
  if (!stdout) throw new Error(`${script} produced no stdout: ${proc.stderr.trim()}`);
  const parsed = JSON.parse(stdout) as unknown;
  if (!isObject(parsed)) throw new Error(`${script} did not produce JSON object`);
  const expectedStatus = parsed.ok === true ? 0 : 1;
  if (proc.status !== expectedStatus) {
    throw new Error(`${script} exit ${proc.status} did not match ok=${String(parsed.ok)}; expected ${expectedStatus}`);
  }
  return parsed;
}

function ok(value: unknown): boolean {
  return isObject(value) && value.ok === true;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function assertCase(name: string, condition: boolean, detail?: unknown): CaseResult {
  return { name, pass: condition, ...(condition ? {} : { detail }) };
}

function runQuint(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const proc = spawnSync("quint", args, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

function checkQuintTypecheckAndInvariants(): CaseResult {
  const modelPath = join(REPO, "skills", "seedstack", "quint", "run_loop.qnt");
  const typecheck = runQuint(["typecheck", modelPath]);
  const invariants = runQuint([
    "run",
    modelPath,
    "--backend=typescript",
    "--invariant=allInvariants",
    "--max-samples=500",
    "--max-steps=20",
  ]);
  return assertCase("quintTypecheckAndAllInvariants", typecheck.status === 0 && invariants.status === 0, {
    typecheck_status: typecheck.status,
    typecheck_stdout: typecheck.stdout,
    typecheck_stderr: typecheck.stderr,
    invariants_status: invariants.status,
    invariants_stdout: invariants.stdout,
    invariants_stderr: invariants.stderr,
  });
}

function checkDoneRequiresFreshScanAndNoOpen(dir: string): CaseResult {
  const scan = writeJson(join(dir, "scan-open.json"), {
    contract: "seedstack_scan.v1",
    ok: true,
    open_adopted: ["seed-1"],
    adopted_ready_ids: ["seed-1"],
  });
  const result = runJson("check-run-transition.ts", [
    "--current-state",
    "idle",
    "--next-state",
    "done",
    "--scan-file",
    scan,
  ]);
  return assertCase("doneRequiresFreshScanAndNoOpen", !ok(result) && hasFinding(result, "adopted_open_remaining"), result);
}

function checkManageBeforeNextDispatch(): CaseResult {
  const result = runJson("check-run-transition.ts", [
    "--current-state",
    "dispatching",
    "--next-state",
    "idle",
  ]);
  return assertCase("manageBeforeNextDispatch", !ok(result) && result.decision === "blocked_transition", result);
}

function checkFollowupCapsRespected(dir: string): CaseResult {
  const runState = writeJson(join(dir, "run-state-followups.json"), {
    state: "idle",
    loop_iteration: 1,
    loop_cap: 50,
    in_flight_seed_id: "seed-1",
    dispatch_attempts: { "seed-1": 1 },
    baseline_followup_growth_counter: 0,
    followup_growth_checkpoint: 0,
    followup_growth_counter: 6,
    baseline_state_counts: { open: 10 },
  });
  const result = runJson("check-loop-caps.ts", [
    "--run-state",
    runState,
    "--seed",
    "seed-1",
    "--followup-cap",
    "5",
  ]);
  return assertCase("followupCapsRespected", !ok(result) && result.decision === "blocked_followup_growth", result);
}

function checkPerManageFollowupCap(dir: string): CaseResult {
  const resultPath = writeJson(join(dir, "manage-followups-3.json"), {
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "manage",
    seed: "seed-1",
    decision: "continue",
    followups_requested: 3,
    followups_created: [],
    proposed_queue_operations: [
      {
        op_type: "create-follow-up",
        target_seed: "seed-1-follow-up",
        rationale: "fixture follow-up proposal",
        source_artifact_refs: [join(dir, "manage-followups-3.json")],
        expected_preconditions: ["seed-1 is still open"],
        details: {},
      },
    ],
  });
  const result = readChildResult(resultPath, "manage", "seed-1");
  return assertCase("perManageFollowupCap", followupCount(result) > 2, result);
}

function checkAttemptCapMatchesModel(dir: string): CaseResult {
  const runState = writeJson(join(dir, "run-state-attempts.json"), {
    state: "idle",
    loop_iteration: 1,
    loop_cap: 50,
    in_flight_seed_id: "seed-1",
    dispatch_attempts: { "seed-1": 3 },
    consecutive_no_progress: 0,
  });
  const result = runJson("check-loop-caps.ts", ["--run-state", runState, "--seed", "seed-1"]);
  return assertCase("attemptCapMatchesModel", !ok(result) && result.decision === "blocked_attempt_cap", result);
}

function checkAttemptCapSkipMatchesModel(dir: string): CaseResult {
  const model = readFileSync(join(REPO, "skills", "seedstack", "quint", "run_loop.qnt"), "utf8");
  const loop = readFileSync(join(SCRIPT_DIR, "seedstack-loop.ts"), "utf8");
  const fixture = readFileSync(join(REPO, "skills", "seedstack", "test", "loop-scenarios", "attempt-cap-skip-continues.json"), "utf8");
  const reachability = spawnSync("quint", [
    "run",
    join(REPO, "skills", "seedstack", "quint", "run_loop.qnt"),
    "--backend=typescript",
    "--invariant=skipReachabilityProbe",
    "--max-samples=500",
    "--max-steps=10",
  ], { cwd: REPO, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const proc = spawnSync(process.execPath, [
    join(SCRIPT_DIR, "seedstack-loop-fixture.ts"),
    "--repo",
    REPO,
    "--scenario",
    join(REPO, "skills", "seedstack", "test", "loop-scenarios", "attempt-cap-skip-continues.json"),
    "--keep",
    "--pretty",
  ], { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const fixtureResult = JSON.parse(proc.stdout.trim()) as unknown;
  const scenario = isObject(fixtureResult) && Array.isArray(fixtureResult.scenarios) && isObject(fixtureResult.scenarios[0])
    ? fixtureResult.scenarios[0]
    : null;
  const stdoutPath = stringField(scenario?.stdout_path);
  const events = stdoutPath
    ? readFileSync(stdoutPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            return isObject(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        })
    : [];
  const tempRepo = isObject(scenario) ? stringField(scenario.repo) : null;
  if (tempRepo) rmSync(tempRepo, { recursive: true, force: true });
  const skipIndex = events.findIndex((event) => event.event === "seed_skipped" && event.seed === "seed-fixture-0004a");
  const dispatchIndex = events.findIndex((event) =>
    event.event === "dispatch_exact_validation" && event.seed === "seed-fixture-0004b" && event.ok === true
  );
  const finalIndex = events.findIndex((event) => event.event === "final" && event.state === "exhausted");
  const pass =
    proc.status === 0 &&
    reachability.status !== 0 &&
    /Invariant violated/.test(`${reachability.stdout}\n${reachability.stderr}`) &&
    isObject(fixtureResult) &&
    fixtureResult.ok === true &&
    skipIndex >= 0 &&
    dispatchIndex > skipIndex &&
    finalIndex > dispatchIndex &&
    model.includes("var skipped: Set[int]") &&
    model.includes("skipAttemptCapped") &&
    model.includes("markExhausted") &&
    model.includes("skippedSeedResolved") &&
    model.includes("skippedSeedsNeverDone") &&
    model.includes("skipReachabilityProbe") &&
    loop.includes('capDecision === "blocked_attempt_cap"') &&
    loop.includes("recordSkippedSeed") &&
    loop.includes('transition(seedstackDir, iteration, "idle", "exhausted"') &&
    fixture.includes("seed_skipped") &&
    fixture.includes('"final_state": "exhausted"');
  return assertCase("attemptCapSkipMatchesModel", pass, {
    fixtureResult,
    skipIndex,
    dispatchIndex,
    finalIndex,
    reachability_status: reachability.status,
  });
}

function checkStoppedIsLoud(): CaseResult {
  const blocked = runJson("check-run-transition.ts", [
    "--current-state",
    "idle",
    "--next-state",
    "blocked",
  ]);
  const allowed = runJson("check-run-transition.ts", [
    "--current-state",
    "dispatching",
    "--next-state",
    "blocked",
    "--stop-reason",
    "dispatch_child_timeout",
    "--allow-unreconciled-stop",
  ]);
  return assertCase("stoppedIsLoud", !ok(blocked) && hasFinding(blocked, "missing_stop_evidence") && ok(allowed), { blocked, allowed });
}

function checkRetryPolicyMatchesModel(): CaseResult {
  const model = readFileSync(join(REPO, "skills", "seedstack", "quint", "run_loop.qnt"), "utf8");
  const childSupervisor = readFileSync(join(SCRIPT_DIR, "child-supervisor.ts"), "utf8");
  const loop = readFileSync(join(SCRIPT_DIR, "seedstack-loop.ts"), "utf8");
  const transition = readFileSync(join(SCRIPT_DIR, "check-run-transition.ts"), "utf8");
  const prompts = readFileSync(join(SCRIPT_DIR, "prompts.ts"), "utf8");
  const concreteDispatchResults = "oneOf(Set(ClosedResult, RetryResult, EscalatedResult, BlockedResult, CrashedResult))";
  const nonClosedManageGuard = "any { result == RetryResult, result == EscalatedResult, result == BlockedResult, result == CrashedResult }";
  const pass =
    model.includes("nextResult != NoResult") &&
    model.includes(concreteDispatchResults) &&
    model.includes("phase == Reconciling,\n    result != NoResult") &&
    model.includes("RetryResult") &&
    model.includes("EscalatedResult") &&
    model.includes("result == ClosedResult") &&
    model.includes(nonClosedManageGuard) &&
    model.includes("manageRetrySameSeed") &&
    model.includes("attempts.get(current) < MAX_ATTEMPTS") &&
    model.includes("manageNonClosedBlockUser") &&
    !model.includes("manageRetryAttemptCapped") &&
    !model.includes("dispatchNonClosedStop") &&
    childSupervisor.includes('result.decision !== "closed"') &&
    childSupervisor.includes('result.decision !== "blocked"') &&
    childSupervisor.includes('result.decision !== "escalated"') &&
    childSupervisor.includes('result.decision !== "crashed"') &&
    childSupervisor.includes('result.decision !== "retry_same_seed"') &&
    transition.includes('managing: ["idle", "dispatching", "done", "blocked", "escalated", "loop_cap"]') &&
    !loop.includes('dispatchResult.decision !== "closed" && dispatchResult.decision !== "escalated"') &&
    loop.includes('childResult.decision === "retry_same_seed"') &&
    prompts.includes("retry_same_seed|continue_other_seeds|blocked|done");
  return assertCase("retryPolicyMatchesModel", pass, {
    model_policy_present: model.includes("result != NoResult") && !model.includes("dispatchNonClosedStop"),
    dispatch_concrete_outcomes_accepted:
      childSupervisor.includes('result.decision !== "closed"') &&
      childSupervisor.includes('result.decision !== "blocked"') &&
      childSupervisor.includes('result.decision !== "escalated"') &&
      childSupervisor.includes('result.decision !== "crashed"'),
    manage_retry_accepted: childSupervisor.includes('result.decision !== "retry_same_seed"'),
    managing_to_dispatching_allowed: transition.includes('managing: ["idle", "dispatching", "done", "blocked", "escalated", "loop_cap"]'),
    dispatch_nonclose_pre_stop_removed: !loop.includes('dispatchResult.decision !== "closed" && dispatchResult.decision !== "escalated"'),
    retry_same_seed_runtime: loop.includes('childResult.decision === "retry_same_seed"'),
    manage_prompt_retry: prompts.includes("retry_same_seed|continue_other_seeds|blocked|done"),
  });
}

function selfTest(pretty: boolean): never {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-run-loop-alignment-"));
  try {
    const cases = [
      checkQuintTypecheckAndInvariants(),
      checkDoneRequiresFreshScanAndNoOpen(dir),
      checkManageBeforeNextDispatch(),
      checkFollowupCapsRespected(dir),
      checkPerManageFollowupCap(dir),
      checkAttemptCapMatchesModel(dir),
      checkAttemptCapSkipMatchesModel(dir),
      checkStoppedIsLoud(),
      checkRetryPolicyMatchesModel(),
    ];
    const result = {
      contract: "seedstack_run_loop_model_alignment.v1",
      ok: cases.every((item) => item.pass),
      cases,
    };
    process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write("Usage: bun skills/seedstack/scripts/check-run-loop-model-alignment.ts --self-test [--pretty]\n");
  process.exit(0);
}
if (!args.includes("--self-test")) {
  process.stderr.write("--self-test required\n");
  process.exit(2);
}
selfTest(args.includes("--pretty"));
