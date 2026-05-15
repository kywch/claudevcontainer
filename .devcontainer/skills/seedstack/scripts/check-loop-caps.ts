#!/usr/bin/env bun
// Deterministic Seedstack loop/attempt/no-progress/follow-up cap checker.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Decision =
  | "continue"
  | "blocked_loop_cap"
  | "blocked_attempt_cap"
  | "blocked_no_progress"
  | "blocked_followup_growth"
  | "blocked_cap_config";
type Finding = { code: string; message: string; detail?: unknown };
type JsonObject = Record<string, unknown>;

type Options = {
  repo: string;
  runState?: string;
  seed?: string;
  loopCap?: number;
  attemptCap: number;
  noProgressCap: number;
  followupCap?: number;
  adoptionSelection?: string;
  scanFile?: string;
  createdMap?: string;
  currentFollowups?: number;
  incrementLoop: boolean;
  pretty: boolean;
  selfTest: boolean;
};

type Result = {
  contract: "loop_cap_check.v1";
  ok: boolean;
  decision: Decision;
  blockers: Finding[];
  warnings: Finding[];
  seed: string | null;
  severity: "ok" | "skippable" | "terminal";
  recommended_action: "continue" | "skip_seed" | "stop";
  caps: {
    loop: number | null;
    attempt: number;
    no_progress: number;
    followup_growth: number | null;
  };
  counts: {
    loop_iteration: number | null;
    effective_loop_iteration: number | null;
    dispatch_attempts_for_seed: number | null;
    consecutive_no_progress: number | null;
    baseline_followup_growth_counter: number | null;
    current_followup_growth_counter: number | null;
    followup_growth: number | null;
    initial_open: number | null;
  };
  summary: JsonObject;
};

const HELP = `check-loop-caps.ts loop_cap_check.v1

Usage:
  bun skills/seedstack/scripts/check-loop-caps.ts --run-state <path> [args]
  bun skills/seedstack/scripts/check-loop-caps.ts --self-test [--pretty]

Args:
  --repo <path>                  Repo root. Default: cwd.
  --run-state <path>             run-state.json. Required unless --self-test.
  --seed <id>                    Candidate/current work order id.
  --loop-cap <n>                 Override loop cap. Default: run-state.loop_cap or 50.
  --attempt-cap <n>              Per-seed dispatch attempt cap. Default: 3.
  --no-progress-cap <n>          Consecutive no-progress cap. Default: 3.
  --followup-cap <n>             Follow-up growth cap override.
  --adoption-selection <path>    adoption-selection.json baseline/checkpoint source.
  --scan-file <json>             seedstack_scan.v1/current scan JSON.
  --created-map <json>           Manager-created seed map/count source.
  --current-followups <n>        Override current follow-up growth counter.
  --increment-loop               Check run-state.loop_iteration + 1.
  --pretty                       Pretty-print JSON.
  --self-test                    Run fixture tests.
  --help                         Show this help.
`;

function usage(exitCode: 0 | 2): never {
  (exitCode === 0 ? process.stdout : process.stderr).write(HELP);
  process.exit(exitCode);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

function parseNonnegativeInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a nonnegative integer`);
  return Number(value);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = parseNonnegativeInt(value, flag);
  if (parsed <= 0) throw new Error(`${flag} must be positive`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    attemptCap: 3,
    noProgressCap: 3,
    incrementLoop: false,
    pretty: false,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = requireValue(argv, index, arg);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        usage(0);
      case "--pretty":
        options.pretty = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      case "--increment-loop":
        options.incrementLoop = true;
        break;
      case "--repo":
        options.repo = take();
        break;
      case "--run-state":
        options.runState = take();
        break;
      case "--seed":
        options.seed = take();
        break;
      case "--loop-cap":
        options.loopCap = parsePositiveInt(take(), arg);
        break;
      case "--attempt-cap":
        options.attemptCap = parsePositiveInt(take(), arg);
        break;
      case "--no-progress-cap":
        options.noProgressCap = parsePositiveInt(take(), arg);
        break;
      case "--followup-cap":
        options.followupCap = parsePositiveInt(take(), arg);
        break;
      case "--adoption-selection":
        options.adoptionSelection = take();
        break;
      case "--scan-file":
        options.scanFile = take();
        break;
      case "--created-map":
        options.createdMap = take();
        break;
      case "--current-followups":
        options.currentFollowups = parseNonnegativeInt(take(), arg);
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--run-state=")) options.runState = arg.slice("--run-state=".length);
        else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--loop-cap=")) options.loopCap = parsePositiveInt(arg.slice("--loop-cap=".length), "--loop-cap");
        else if (arg.startsWith("--attempt-cap=")) {
          options.attemptCap = parsePositiveInt(arg.slice("--attempt-cap=".length), "--attempt-cap");
        } else if (arg.startsWith("--no-progress-cap=")) {
          options.noProgressCap = parsePositiveInt(arg.slice("--no-progress-cap=".length), "--no-progress-cap");
        } else if (arg.startsWith("--followup-cap=")) {
          options.followupCap = parsePositiveInt(arg.slice("--followup-cap=".length), "--followup-cap");
        } else if (arg.startsWith("--adoption-selection=")) {
          options.adoptionSelection = arg.slice("--adoption-selection=".length);
        } else if (arg.startsWith("--scan-file=")) options.scanFile = arg.slice("--scan-file=".length);
        else if (arg.startsWith("--created-map=")) options.createdMap = arg.slice("--created-map=".length);
        else if (arg.startsWith("--current-followups=")) {
          options.currentFollowups = parseNonnegativeInt(arg.slice("--current-followups=".length), "--current-followups");
        } else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  return options;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadJson(path?: string): unknown | null {
  return path ? readJson(path) : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function objectField(value: unknown, field: string): JsonObject | null {
  return isObject(value) && isObject(value[field]) ? value[field] : null;
}

function arrayField(value: unknown, field: string): unknown[] | null {
  return isObject(value) && Array.isArray(value[field]) ? value[field] : null;
}

function nestedNumber(value: unknown, path: string[]): number | null {
  let cursor = value;
  for (const part of path) {
    if (!isObject(cursor)) return null;
    cursor = cursor[part];
  }
  return numberField(cursor);
}

function firstNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number") return value;
  }
  return null;
}

function firstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function add(blockers: Finding[], code: string, message: string, detail?: unknown): void {
  blockers.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function warn(warnings: Finding[], code: string, message: string, detail?: unknown): void {
  warnings.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function validatePositive(value: number | null, code: string, label: string, blockers: Finding[]): void {
  if (value === null || value <= 0) add(blockers, code, `${label} must be positive`, { value });
}

function validateNonnegative(value: number | null, code: string, label: string, blockers: Finding[]): void {
  if (value !== null && value < 0) add(blockers, code, `${label} must be nonnegative`, { value });
}

function resolveSeed(options: Options, runState: unknown): string | null {
  const latestDispatch = objectField(runState, "latest_dispatch");
  const selection = objectField(runState, "selection");
  return firstString(
    options.seed ?? null,
    stringField(isObject(runState) ? runState.in_flight_seed_id : null),
    stringField(selection?.chosen_seed_id),
    stringField(latestDispatch?.seed_id),
    stringField(latestDispatch?.seed),
  );
}

function dispatchAttemptsForSeed(runState: unknown, seed: string | null): number | null {
  if (!seed) return null;
  const attempts = objectField(runState, "dispatch_attempts");
  if (!attempts) return 0;
  return numberField(attempts[seed]) ?? 0;
}

function initialOpenCount(adoption: unknown, runState: unknown, scan: unknown): number | null {
  return firstNumber(
    nestedNumber(adoption, ["baseline_state_counts", "open"]),
    nestedNumber(adoption, ["baseline_counts", "open"]),
    numberField(isObject(adoption) ? adoption.baseline_open_count : null),
    nestedNumber(runState, ["baseline_state_counts", "open"]),
    nestedNumber(runState, ["state_counts", "open"]),
    numberField(isObject(runState) ? runState.initial_open : null),
    nestedNumber(scan, ["counts", "open"]),
  );
}

function textIncludesFollowupSource(value: unknown): boolean {
  return typeof value === "string" && /\b(follow[-_ ]?up|manager)\b/i.test(value);
}

function createdMapCountFromGenericFields(createdMap: JsonObject): number | null {
  const direct = firstNumber(numberField(createdMap.count), numberField(createdMap.created_count));
  if (direct !== null) return direct;
  for (const key of ["created", "seeds", "seed_ids", "created_seed_ids", "created_ids"]) {
    const value = createdMap[key];
    if (Array.isArray(value)) return value.length;
  }
  const mapping = objectField(createdMap, "mapping") ?? objectField(createdMap, "created_map");
  return mapping ? Object.keys(mapping).length : null;
}

function createdMapFollowupCount(createdMap: unknown, warnings: Finding[]): number | null {
  if (!isObject(createdMap)) return null;
  const direct = firstNumber(
    numberField(createdMap.manager_created_count),
    numberField(createdMap.followup_growth_counter),
  );
  if (direct !== null) return direct;
  for (const key of ["followups", "followup_ids"]) {
    const value = createdMap[key];
    if (Array.isArray(value)) return value.length;
  }

  const explicitSource = ["scope", "reason", "source", "origin", "type", "purpose"].some((key) => textIncludesFollowupSource(createdMap[key]));
  if (explicitSource) {
    const sourcedCount = createdMapCountFromGenericFields(createdMap);
    if (sourcedCount !== null) return sourcedCount;
  }

  warn(warnings, "created_map_not_followup_source", "created-map lacks explicit follow-up source fields; ignoring for follow-up growth", {
    recognized_fields: ["manager_created_count", "followup_growth_counter", "followups", "followup_ids"],
  });
  return null;
}

function baselineFollowups(adoption: unknown, runState: unknown): number | null {
  return firstNumber(
    numberField(isObject(adoption) ? adoption.baseline_followup_growth_counter : null),
    nestedNumber(adoption, ["adoption", "baseline_followup_growth_counter"]),
    numberField(isObject(runState) ? runState.baseline_followup_growth_counter : null),
    nestedNumber(runState, ["adoption", "baseline_followup_growth_counter"]),
  );
}

function followupCheckpoint(adoption: unknown, runState: unknown): number | null {
  return firstNumber(
    numberField(isObject(adoption) ? adoption.followup_growth_checkpoint : null),
    nestedNumber(adoption, ["adoption", "followup_growth_checkpoint"]),
    numberField(isObject(runState) ? runState.followup_growth_checkpoint : null),
    nestedNumber(runState, ["adoption", "followup_growth_checkpoint"]),
  );
}

function currentFollowups(options: Options, runState: unknown, createdMap: unknown, warnings: Finding[]): number | null {
  if (options.currentFollowups !== undefined) return options.currentFollowups;
  const runStateCounter = numberField(isObject(runState) ? runState.followup_growth_counter : null);
  if (runStateCounter !== null) return runStateCounter;
  const runStateFollowups = arrayField(runState, "followups")?.length ?? null;
  if (runStateFollowups !== null) return runStateFollowups;
  return createdMapFollowupCount(createdMap, warnings);
}

function decisionFor(blockers: Finding[]): Decision {
  const onlyAttemptCap = blockers.length === 1 && blockers[0]?.code === "attempt_cap_exceeded";
  if (onlyAttemptCap) return "blocked_attempt_cap";
  const priority: Array<[string, Decision]> = [
    ["cap_config_invalid", "blocked_cap_config"],
    ["loop_cap_exceeded", "blocked_loop_cap"],
    ["no_progress_cap_exceeded", "blocked_no_progress"],
    ["followup_growth_cap_exceeded", "blocked_followup_growth"],
    ["missing_followup_cap", "blocked_followup_growth"],
    ["attempt_cap_exceeded", "blocked_attempt_cap"],
  ];
  for (const [code, decision] of priority) {
    if (blockers.some((finding) => finding.code === code)) return decision;
  }
  return blockers.length > 0 ? "blocked_cap_config" : "continue";
}

function check(options: Options): Result {
  if (!options.runState) throw new Error("--run-state required unless --self-test");

  const runState = loadJson(options.runState);
  const adoption = loadJson(options.adoptionSelection);
  const scan = loadJson(options.scanFile);
  const createdMap = loadJson(options.createdMap);
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const seed = resolveSeed(options, runState);

  const loopIteration = numberField(isObject(runState) ? runState.loop_iteration : null);
  const loopCap = options.loopCap ?? numberField(isObject(runState) ? runState.loop_cap : null) ?? 50;
  const effectiveLoopIteration = loopIteration === null ? null : loopIteration + (options.incrementLoop ? 1 : 0);
  const attempts = dispatchAttemptsForSeed(runState, seed);
  const noProgress = firstNumber(
    numberField(isObject(runState) ? runState.consecutive_no_progress : null),
    numberField(isObject(runState) ? runState.no_progress_iterations : null),
  );
  let baseline = baselineFollowups(adoption, runState);
  const initialOpen = initialOpenCount(adoption, runState, scan);
  const followupCap =
    options.followupCap ?? followupCheckpoint(adoption, runState) ?? (initialOpen !== null ? Math.max(2, Math.floor(initialOpen * 0.2)) : null);
  const current = currentFollowups(options, runState, createdMap, warnings);
  if (current !== null && baseline === null) {
    baseline = 0;
    warn(warnings, "missing_followup_baseline_default_zero", "current follow-up data exists but baseline is missing; defaulting baseline to zero", {
      current,
    });
  }
  const growth = current !== null && baseline !== null ? current - baseline : null;

  validatePositive(loopCap, "cap_config_invalid", "loop cap", blockers);
  validatePositive(options.attemptCap, "cap_config_invalid", "attempt cap", blockers);
  validatePositive(options.noProgressCap, "cap_config_invalid", "no-progress cap", blockers);
  if (followupCap !== null) validatePositive(followupCap, "cap_config_invalid", "follow-up growth cap", blockers);
  validateNonnegative(loopIteration, "cap_config_invalid", "loop iteration", blockers);
  validateNonnegative(attempts, "cap_config_invalid", "dispatch attempts for seed", blockers);
  validateNonnegative(noProgress, "cap_config_invalid", "consecutive no-progress count", blockers);
  validateNonnegative(baseline, "cap_config_invalid", "baseline follow-up growth counter", blockers);
  validateNonnegative(current, "cap_config_invalid", "current follow-up growth counter", blockers);
  if (growth !== null && growth < 0) add(blockers, "cap_config_invalid", "follow-up growth must be nonnegative", { baseline, current, growth });

  if (!blockers.some((finding) => finding.code === "cap_config_invalid")) {
    if (effectiveLoopIteration !== null) {
      if (effectiveLoopIteration > loopCap) {
        add(blockers, "loop_cap_exceeded", "effective loop iteration exceeds loop cap", { effectiveLoopIteration, loopCap });
      } else if (effectiveLoopIteration === loopCap) {
        warn(warnings, "at_loop_cap", "effective loop iteration is at loop cap", { effectiveLoopIteration, loopCap });
      }
    }

    if (!seed) {
      warn(warnings, "missing_seed_for_attempt_check", "no seed available for dispatch attempt cap check");
    } else if (attempts !== null) {
      if (attempts >= options.attemptCap) {
        add(blockers, "attempt_cap_exceeded", "dispatch attempts for seed reached attempt cap", { seed, attempts, attemptCap: options.attemptCap });
      } else if (attempts === options.attemptCap - 1) {
        warn(warnings, "last_attempt", "next dispatch is final allowed attempt for seed", { seed, attempts, attemptCap: options.attemptCap });
      }
    }

    if (noProgress !== null) {
      if (noProgress > options.noProgressCap) {
        add(blockers, "no_progress_cap_exceeded", "consecutive no-progress count exceeds cap", { noProgress, noProgressCap: options.noProgressCap });
      } else if (noProgress === options.noProgressCap) {
        warn(warnings, "at_no_progress_cap", "consecutive no-progress count is at cap", { noProgress, noProgressCap: options.noProgressCap });
      } else if (noProgress === options.noProgressCap - 1) {
        warn(warnings, "last_no_progress_iteration", "next no-progress iteration reaches cap", { noProgress, noProgressCap: options.noProgressCap });
      }
    }

    if (current !== null && followupCap === null) {
      const detail = { baseline, current, growth, followupCap };
      if (current > 0) add(blockers, "missing_followup_cap", "current follow-up data exists but follow-up cap is missing", detail);
      else warn(warnings, "missing_followup_cap", "current follow-up data exists but follow-up cap is missing; skipping follow-up growth check", detail);
    } else if (growth !== null && followupCap !== null) {
      if (growth > followupCap) {
        add(blockers, "followup_growth_cap_exceeded", "follow-up growth exceeds cap", { baseline, current, growth, followupCap });
      } else if (growth === followupCap) {
        warn(warnings, "at_followup_growth_cap", "follow-up growth is at cap", { baseline, current, growth, followupCap });
      }
    }
  }

  const decision = decisionFor(blockers);
  const severity = decision === "continue" ? "ok" : decision === "blocked_attempt_cap" ? "skippable" : "terminal";
  return {
    contract: "loop_cap_check.v1",
    ok: blockers.length === 0,
    decision,
    blockers,
    warnings,
    seed,
    severity,
    recommended_action: decision === "continue" ? "continue" : decision === "blocked_attempt_cap" ? "skip_seed" : "stop",
    caps: {
      loop: loopCap,
      attempt: options.attemptCap,
      no_progress: options.noProgressCap,
      followup_growth: followupCap,
    },
    counts: {
      loop_iteration: loopIteration,
      effective_loop_iteration: effectiveLoopIteration,
      dispatch_attempts_for_seed: attempts,
      consecutive_no_progress: noProgress,
      baseline_followup_growth_counter: baseline,
      current_followup_growth_counter: current,
      followup_growth: growth,
      initial_open: initialOpen,
    },
    summary: {
      increment_loop: options.incrementLoop,
      run_state_path: options.runState,
      adoption_selection_path: options.adoptionSelection ?? null,
      scan_file_path: options.scanFile ?? null,
      created_map_path: options.createdMap ?? null,
    },
  };
}

function fixture(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function assertSelf(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) throw new Error(`self-test failed: ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

let fixtureCounter = 0;

function runFixture(dir: string, runState: unknown, extra: Partial<Options> = {}): Result {
  return check({
    repo: dir,
    runState: fixture(dir, `run-state-${fixtureCounter++}.json`, runState),
    attemptCap: 3,
    noProgressCap: 3,
    incrementLoop: false,
    pretty: false,
    selfTest: false,
    ...extra,
  });
}

function selfTest(): Result {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-loop-caps-"));
  try {
    fixtureCounter = 0;
    const base = {
      loop_iteration: 1,
      loop_cap: 5,
      dispatch_attempts: { "seed-1": 1 },
      in_flight_seed_id: "seed-1",
      consecutive_no_progress: 0,
      baseline_followup_growth_counter: 0,
      followup_growth_counter: 1,
      baseline_state_counts: { open: 10 },
    };

    const ok = runFixture(dir, base);
    assertSelf("continue below caps", ok.ok && ok.decision === "continue", ok);

    const loop = runFixture(dir, { ...base, loop_iteration: 6 });
    assertSelf("loop cap exceeded", !loop.ok && loop.decision === "blocked_loop_cap", loop);

    const attempt = runFixture(dir, { ...base, dispatch_attempts: { "seed-1": 3 } });
    assertSelf("attempt cap exceeded", !attempt.ok && attempt.decision === "blocked_attempt_cap", attempt);

    const attemptNoProgress = runFixture(dir, { ...base, dispatch_attempts: { "seed-1": 3 }, consecutive_no_progress: 4 });
    assertSelf("attempt plus no-progress stays terminal", !attemptNoProgress.ok && attemptNoProgress.decision === "blocked_no_progress", attemptNoProgress);

    const noProgress = runFixture(dir, { ...base, consecutive_no_progress: 4 });
    assertSelf("no-progress cap exceeded", !noProgress.ok && noProgress.decision === "blocked_no_progress", noProgress);

    const followup = runFixture(dir, { ...base, followup_growth_counter: 4, followup_growth_checkpoint: 2 });
    assertSelf("followup growth cap exceeded", !followup.ok && followup.decision === "blocked_followup_growth", followup);

    const invalid = runFixture(dir, { ...base, loop_cap: 0 });
    assertSelf("config invalid", !invalid.ok && invalid.decision === "blocked_cap_config", invalid);

    const increment = runFixture(dir, { ...base, loop_iteration: 5 }, { incrementLoop: true });
    assertSelf("increment-loop edge", !increment.ok && increment.decision === "blocked_loop_cap", increment);

    const atLoop = runFixture(dir, { ...base, loop_iteration: 5 });
    assertSelf("loop cap equality warning", atLoop.ok && atLoop.warnings.some((finding) => finding.code === "at_loop_cap"), atLoop);

    const atNoProgress = runFixture(dir, { ...base, consecutive_no_progress: 3 });
    assertSelf(
      "no-progress equality warning",
      atNoProgress.ok && atNoProgress.warnings.some((finding) => finding.code === "at_no_progress_cap"),
      atNoProgress,
    );

    const atFollowup = runFixture(dir, { ...base, followup_growth_counter: 2, followup_growth_checkpoint: 2 });
    assertSelf(
      "followup equality warning",
      atFollowup.ok && atFollowup.warnings.some((finding) => finding.code === "at_followup_growth_cap"),
      atFollowup,
    );

    const lastAttempt = runFixture(dir, { ...base, dispatch_attempts: { "seed-1": 2 } });
    assertSelf("attempt cap minus one warning", lastAttempt.ok && lastAttempt.warnings.some((finding) => finding.code === "last_attempt"), lastAttempt);

    const priority = runFixture(dir, { ...base, loop_iteration: 6, dispatch_attempts: { "seed-1": 3 } });
    assertSelf("decision priority with multiple blockers", !priority.ok && priority.decision === "blocked_loop_cap", priority);

    const missingBaseline = runFixture(dir, {
      loop_iteration: 1,
      loop_cap: 5,
      dispatch_attempts: { "seed-1": 1 },
      in_flight_seed_id: "seed-1",
      consecutive_no_progress: 0,
      followup_growth_counter: 3,
      followup_growth_checkpoint: 2,
    });
    assertSelf(
      "missing baseline defaults zero and enforces",
      !missingBaseline.ok &&
        missingBaseline.decision === "blocked_followup_growth" &&
        missingBaseline.warnings.some((finding) => finding.code === "missing_followup_baseline_default_zero"),
      missingBaseline,
    );

    const missingCap = runFixture(dir, {
      loop_iteration: 1,
      loop_cap: 5,
      dispatch_attempts: { "seed-1": 1 },
      in_flight_seed_id: "seed-1",
      consecutive_no_progress: 0,
      followup_growth_counter: 1,
    });
    assertSelf("missing followup cap blocks current growth", !missingCap.ok && missingCap.decision === "blocked_followup_growth", missingCap);

    const initialCreatedMap = fixture(dir, "created-map-initial.json", {
      scope: "stage1",
      mapping: { n1: "seedspec-a", n2: "seedspec-b" },
      created_ids: ["seedspec-a", "seedspec-b"],
    });
    const createdMapIgnored = runFixture(
      dir,
      {
        loop_iteration: 1,
        loop_cap: 5,
        dispatch_attempts: { "seed-1": 1 },
        in_flight_seed_id: "seed-1",
        consecutive_no_progress: 0,
        baseline_followup_growth_counter: 0,
        followup_growth_checkpoint: 1,
      },
      { createdMap: initialCreatedMap },
    );
    assertSelf(
      "created-map initial seed ignored",
      createdMapIgnored.ok &&
        createdMapIgnored.counts.current_followup_growth_counter === null &&
        createdMapIgnored.warnings.some((finding) => finding.code === "created_map_not_followup_source"),
      createdMapIgnored,
    );

    const explicitFollowupMap = fixture(dir, "created-map-followups.json", {
      scope: "manager followup",
      created_ids: ["seedspec-c", "seedspec-d"],
    });
    const createdMapFollowup = runFixture(
      dir,
      {
        loop_iteration: 1,
        loop_cap: 5,
        dispatch_attempts: { "seed-1": 1 },
        in_flight_seed_id: "seed-1",
        consecutive_no_progress: 0,
        baseline_followup_growth_counter: 0,
        followup_growth_checkpoint: 1,
      },
      { createdMap: explicitFollowupMap },
    );
    assertSelf("explicit followup created-map enforces", !createdMapFollowup.ok && createdMapFollowup.decision === "blocked_followup_growth", createdMapFollowup);

    const missingSeed = runFixture(dir, { ...base, in_flight_seed_id: null, selection: {}, latest_dispatch: {}, dispatch_attempts: {} });
    assertSelf(
      "missing seed warning",
      missingSeed.ok && missingSeed.warnings.some((finding) => finding.code === "missing_seed_for_attempt_check"),
      missingSeed,
    );

    return {
      contract: "loop_cap_check.v1",
      ok: true,
      decision: "continue",
      blockers: [],
      warnings: [],
      seed: null,
      caps: { loop: 50, attempt: 3, no_progress: 3, followup_growth: null },
      counts: {
        loop_iteration: null,
        effective_loop_iteration: null,
        dispatch_attempts_for_seed: null,
        consecutive_no_progress: null,
        baseline_followup_growth_counter: null,
        current_followup_growth_counter: null,
        followup_growth: null,
        initial_open: null,
      },
      summary: { self_tests: 17, status: "passed" },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = options.selfTest ? selfTest() : check(options);
  printJson(result, options.pretty);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  printJson(
    {
      contract: "loop_cap_check.v1",
      ok: false,
      decision: "blocked_cap_config",
      blockers: [{ code: "usage_or_crash", message }],
      warnings: [],
      seed: null,
      caps: { loop: null, attempt: 3, no_progress: 3, followup_growth: null },
      counts: {
        loop_iteration: null,
        effective_loop_iteration: null,
        dispatch_attempts_for_seed: null,
        consecutive_no_progress: null,
        baseline_followup_growth_counter: null,
        current_followup_growth_counter: null,
        followup_growth: null,
        initial_open: null,
      },
      summary: {},
    } satisfies Result,
    false,
  );
  process.exit(2);
}
