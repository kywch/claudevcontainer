#!/usr/bin/env bun
// Read-only Seedstack recovery advisor. Emits the next safe deterministic command.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { childAttemptsDir } from "./seedstack-paths.ts";

type RunStateName = "idle" | "dispatching" | "managing" | "done" | "exhausted" | "blocked" | "escalated" | "loop_cap";
type Decision =
  | "scan_required"
  | "adoption_check_required"
  | "dirty_check_required"
  | "blocked_dirty"
  | "reconcile_required"
  | "run_transition_required"
  | "commit_ledger_required"
  | "run_state_update_required"
  | "dispatch_allowed"
  | "no_op"
  | "blocked_unknown_child"
  | "blocked_missing_evidence";
type Finding = { code: string; message: string; detail?: unknown };
type JsonObject = Record<string, unknown>;
type Command = { argv: string[]; rationale: string };

type Options = {
  repo: string;
  seedstackDir?: string;
  runState?: string;
  scanFile?: string;
  adoptionSelection?: string;
  adoptionCheck?: string;
  dirtyResult?: string;
  reconcileResult?: string;
  runTransition?: string;
  commitCheck?: string;
  seed?: string;
  seedCli: string;
  pretty: boolean;
  selfTest: boolean;
};

type Result = {
  contract: "recovery_check.v1";
  ok: boolean;
  decision: Decision;
  blockers: Finding[];
  warnings: Finding[];
  state: RunStateName | null;
  seed: string | null;
  next_safe_command: Command | null;
  inputs: Record<string, string | null>;
  summary: JsonObject;
};

const TERMINAL = new Set<RunStateName>(["done", "exhausted", "blocked", "escalated", "loop_cap"]);
const STATES = new Set<RunStateName>(["idle", "dispatching", "managing", "done", "exhausted", "blocked", "escalated", "loop_cap"]);

const HELP = `check-recovery-state.ts recovery_check.v1

Usage:
  bun skills/seedstack/scripts/check-recovery-state.ts --seedstack-dir <path> [args]
  bun skills/seedstack/scripts/check-recovery-state.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root. Default: cwd.
  --seedstack-dir <path>           Seedstack artifact dir.
  --run-state <path>               Default: <seedstack-dir>/run-state.json.
  --scan-file <json>               seedstack_scan.v1 output.
  --adoption-selection <json>      adoption-selection.json path for recommended checker command.
  --adoption-check <json>          adoption_selection_check.v1 output.
  --dirty-result <json>            dirty_state_classification.v1 output.
  --reconcile-result <json>        dispatch_reconcile_check.v1 output.
  --run-transition <json>          run_transition_check.v1 output.
  --commit-check <json>            commit_ledger_check.v1 output.
  --seed <id>                      Override candidate/in-flight seed.
  --seed-cli <path>                Work queue CLI for recommended scan command. Default: sd.
  --pretty                         Pretty-print JSON.
  --self-test                      Run fixture tests.
  --help                           Show this help.
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

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    seedCli: "sd",
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
      case "--repo":
        options.repo = take();
        break;
      case "--seedstack-dir":
        options.seedstackDir = take();
        break;
      case "--run-state":
        options.runState = take();
        break;
      case "--scan-file":
        options.scanFile = take();
        break;
      case "--adoption-selection":
        options.adoptionSelection = take();
        break;
      case "--adoption-check":
        options.adoptionCheck = take();
        break;
      case "--dirty-result":
        options.dirtyResult = take();
        break;
      case "--reconcile-result":
        options.reconcileResult = take();
        break;
      case "--run-transition":
        options.runTransition = take();
        break;
      case "--commit-check":
        options.commitCheck = take();
        break;
      case "--seed":
        options.seed = take();
        break;
      case "--seed-cli":
        options.seedCli = take();
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--seedstack-dir=")) options.seedstackDir = arg.slice("--seedstack-dir=".length);
        else if (arg.startsWith("--run-state=")) options.runState = arg.slice("--run-state=".length);
        else if (arg.startsWith("--scan-file=")) options.scanFile = arg.slice("--scan-file=".length);
        else if (arg.startsWith("--adoption-selection=")) options.adoptionSelection = arg.slice("--adoption-selection=".length);
        else if (arg.startsWith("--adoption-check=")) options.adoptionCheck = arg.slice("--adoption-check=".length);
        else if (arg.startsWith("--dirty-result=")) options.dirtyResult = arg.slice("--dirty-result=".length);
        else if (arg.startsWith("--reconcile-result=")) options.reconcileResult = arg.slice("--reconcile-result=".length);
        else if (arg.startsWith("--run-transition=")) options.runTransition = arg.slice("--run-transition=".length);
        else if (arg.startsWith("--commit-check=")) options.commitCheck = arg.slice("--commit-check=".length);
        else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--seed-cli=")) options.seedCli = arg.slice("--seed-cli=".length);
        else throw new Error(`unknown arg: ${arg}`);
    }
  }
  options.repo = resolve(options.repo);
  if (options.seedstackDir) {
    options.seedstackDir = resolve(options.repo, options.seedstackDir);
    options.runState ??= join(options.seedstackDir, "run-state.json");
  }
  return options;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path?: string): unknown | null {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function boolField(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function objectField(value: unknown, field: string): JsonObject | null {
  return isObject(value) && isObject(value[field]) ? value[field] : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function stateFrom(value: unknown): RunStateName | null {
  const state = isObject(value) ? stringField(value.state) : null;
  return state && STATES.has(state as RunStateName) ? (state as RunStateName) : null;
}

function latestDispatch(runState: unknown): JsonObject | null {
  return objectField(runState, "latest_dispatch");
}

function seedFrom(runState: unknown, scan: unknown, override?: string): string | null {
  if (override) return override;
  if (isObject(runState)) {
    const direct =
      stringField(runState.in_flight_seed_id) ??
      stringField(runState.active_dispatch_seed_id) ??
      stringField(objectField(runState, "active_dispatch")?.seed_id) ??
      stringField(latestDispatch(runState)?.seed_id);
    if (direct) return direct;
  }
  return adoptedReadyIds(scan)[0] ?? null;
}

function ok(value: unknown): boolean | null {
  return isObject(value) ? boolField(value.ok) : null;
}

function decision(value: unknown): string | null {
  return isObject(value) ? stringField(value.decision) : null;
}

function adoptedReadyIds(scan: unknown): string[] {
  if (!isObject(scan)) return [];
  return [
    ...stringArray(scan.adopted_ready_ids),
    ...stringArray(objectField(scan, "ids")?.adopted_ready_ids),
  ];
}

function adoptedOpenIds(scan: unknown): string[] {
  if (!isObject(scan)) return [];
  return [
    ...stringArray(scan.open_adopted),
    ...stringArray(scan.adopted_open_ids),
    ...stringArray(objectField(scan, "ids")?.adopted_open_ids),
  ];
}

function unexpectedDirtyPaths(dirty: unknown): string[] {
  if (!isObject(dirty)) return [];
  const direct = stringArray(dirty.unexpected_paths);
  if (direct.length) return direct;
  const paths = Array.isArray(dirty.paths) ? dirty.paths.filter(isObject) : [];
  return paths.flatMap((item) => {
    const path = stringField(item.path);
    return path && stringField(item.classification) === "unexpected" ? [path] : [];
  });
}

function latestAttempt(seedstackDir: string | undefined, role: string, seed: string | null): JsonObject | null {
  if (!seedstackDir || !seed) return null;
  const dir = childAttemptsDir(seedstackDir);
  if (!existsSync(dir)) return null;
  const suffix = `-${role}-${seed}.json`;
  const files = readdirSync(dir).filter((file) => file.endsWith(suffix) && /^\d{4}-/.test(file)).sort().reverse();
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
      if (isObject(raw) && raw.contract === "seedstack_child_attempt.v1") return { ...raw, __path: join(dir, file) };
    } catch {
      // Ignore malformed attempt ledgers; recovery remains conservative.
    }
  }
  return null;
}

function attemptTerminal(attempt: JsonObject | null): boolean {
  const state = stringField(attempt?.state);
  return state === "completed" || state === "timeout" || state === "failed" || state === "unknown_terminal_state";
}

function commitPolicy(runState: unknown): string | null {
  return isObject(runState) ? stringField(runState.commit_policy) : null;
}

function latestStatus(runState: unknown): string | null {
  return stringField(latestDispatch(runState)?.status);
}

function commitPending(runState: unknown): boolean {
  return boolField(latestDispatch(runState)?.commit_pending) === true;
}

function command(argv: string[], rationale: string): Command {
  return { argv, rationale };
}

function add(blockers: Finding[], code: string, message: string, detail?: unknown): void {
  blockers.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function chooseTransitionTarget(state: RunStateName, runState: unknown, scan: unknown): RunStateName {
  if (state === "dispatching") return "managing";
  if (state === "managing") return adoptedOpenIds(scan).length || adoptedReadyIds(scan).length ? "idle" : "done";
  return "dispatching";
}

function updateCommand(options: Options, state: RunStateName, seed: string | null): Command {
  const argv = [
    "bun",
    "skills/seedstack/scripts/update-run-state.ts",
    "--seedstack-dir",
    options.seedstackDir ?? "tmp/seedstack/<slug>",
    "--state",
    state,
  ];
  if (seed) argv.push("--seed", seed);
  return command(argv, "run-state mutation must go through update-run-state.ts");
}

function check(options: Options): Result {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const runState = readJson(options.runState);
  const scan = readJson(options.scanFile);
  const adoption = readJson(options.adoptionCheck);
  const dirty = readJson(options.dirtyResult);
  const reconcile = readJson(options.reconcileResult);
  const transition = readJson(options.runTransition);
  const commit = readJson(options.commitCheck);
  const state = stateFrom(runState) ?? "idle";
  const seed = seedFrom(runState, scan, options.seed);

  let next: Command | null = null;
  let recoveryDecision: Decision = "blocked_missing_evidence";

  if (!scan) {
    recoveryDecision = "scan_required";
    const argv = [
      "bun",
      "skills/seedstack/scripts/scan-seedspec-cli.ts",
      "--cli",
      options.seedCli,
    ];
    if (options.adoptionSelection) argv.push("--adoption-selection", options.adoptionSelection);
    argv.push("--pretty");
    next = command(
      argv,
      "fresh queue scan is first recovery step",
    );
  } else if (!adoption) {
    recoveryDecision = "adoption_check_required";
    const argv = [
      "bun",
      "skills/seedstack/scripts/check-adoption-selection.ts",
      "--scan-file",
      options.scanFile ?? "<scan.json>",
    ];
    if (options.adoptionSelection) argv.push("--adoption-selection", options.adoptionSelection);
    argv.push("--pretty");
    next = command(argv, "adoption selection must be checked before dispatch or reconciliation");
  } else if (!dirty) {
    recoveryDecision = "dirty_check_required";
    const argv = [
      "bun",
      "skills/seedstack/scripts/classify-dirty-state.ts",
      "--repo",
      options.repo,
      "--dirty-policy",
      state === "managing" ? "commit" : "loop",
    ];
    if (seed) argv.push("--seed", seed);
    if (options.seedstackDir) argv.push("--seedstack-dir", options.seedstackDir);
    argv.push("--pretty");
    next = command(argv, "dirty state classification gates all recovery actions");
  } else if (ok(dirty) === false || unexpectedDirtyPaths(dirty).length > 0) {
    recoveryDecision = "blocked_dirty";
    add(blockers, "unexpected_dirty", "unexpected dirty paths block recovery", { unexpected_paths: unexpectedDirtyPaths(dirty) });
  } else if (state === "dispatching" && latestAttempt(options.seedstackDir, "dispatch", seed) && !attemptTerminal(latestAttempt(options.seedstackDir, "dispatch", seed))) {
    recoveryDecision = "blocked_unknown_child";
    add(blockers, "unknown_child_state", "in-flight dispatch has nonterminal attempt ledger; do not redispatch over unknown child state", {
      attempt: latestAttempt(options.seedstackDir, "dispatch", seed)?.__path,
    });
  } else if (TERMINAL.has(state)) {
    recoveryDecision = "no_op";
  } else if (state === "dispatching" && !reconcile) {
    recoveryDecision = "reconcile_required";
    const argv = ["bun", "skills/seedstack/scripts/check-dispatch-reconcile.ts"];
    if (seed) argv.push("--seed", seed);
    if (options.seedstackDir) argv.push("--seedstack-dir", options.seedstackDir);
    argv.push("--commit-policy", "none", "--pretty");
    next = command(argv, "in-flight dispatch must be reconciled before any new dispatch");
  } else if (state === "managing" && commitPolicy(runState) === "per_seed" && latestStatus(runState) === "closed_clean" && commitPending(runState) && !commit) {
    recoveryDecision = "commit_ledger_required";
    const argv = ["bun", "skills/seedstack/scripts/check-commit-ledger.ts"];
    if (options.seedstackDir) argv.push("--seedstack-dir", options.seedstackDir);
    if (seed) argv.push("--seed", seed);
    argv.push("--pretty");
    next = command(argv, "per-seed closed_clean recovery needs commit ledger check");
  } else if (!transition) {
    recoveryDecision = "run_transition_required";
    const target = chooseTransitionTarget(state, runState, scan);
    const argv = [
      "bun",
      "skills/seedstack/scripts/check-run-transition.ts",
      "--next-state",
      target,
      "--scan-file",
      options.scanFile ?? "<scan.json>",
      "--adoption-check",
      options.adoptionCheck ?? "<adoption-check.json>",
      "--dirty-result",
      options.dirtyResult ?? "<dirty-result.json>",
    ];
    if (options.runState) argv.push("--run-state", options.runState);
    if (seed) argv.push("--seed", seed);
    if (options.reconcileResult) argv.push("--reconcile-result", options.reconcileResult);
    if (options.commitCheck) argv.push("--commit-check", options.commitCheck);
    argv.push("--pretty");
    next = command(argv, "run transition checker must approve next state");
  } else if (ok(transition) !== true) {
    recoveryDecision = "blocked_missing_evidence";
    add(blockers, "transition_not_ready", "run-transition check did not approve recovery transition", {
      ok: ok(transition),
      decision: decision(transition),
    });
  } else if (state === "idle") {
    recoveryDecision = "dispatch_allowed";
    next = updateCommand(options, "dispatching", seed);
  } else {
    recoveryDecision = "run_state_update_required";
    next = updateCommand(options, chooseTransitionTarget(state, runState, scan), seed);
  }

  if (ok(scan) === false) add(blockers, "scan_failed", "scan output ok false");
  if (ok(adoption) === false) add(blockers, "adoption_check_failed", "adoption check output ok false");
  if (!runState) warnings.push({ code: "missing_run_state", message: "run-state missing; assuming idle for recovery advice" });

  return {
    contract: "recovery_check.v1",
    ok: blockers.length === 0,
    decision: blockers.length === 0
      ? recoveryDecision
      : recoveryDecision === "blocked_dirty" || recoveryDecision === "blocked_unknown_child"
        ? recoveryDecision
        : "blocked_missing_evidence",
    blockers,
    warnings,
    state,
    seed,
    next_safe_command: blockers.length === 0 ? next : null,
    inputs: {
      seedstack_dir: options.seedstackDir ?? null,
      run_state: options.runState ?? null,
      scan_file: options.scanFile ?? null,
      adoption_check: options.adoptionCheck ?? null,
      dirty_result: options.dirtyResult ?? null,
      reconcile_result: options.reconcileResult ?? null,
      run_transition: options.runTransition ?? null,
      commit_check: options.commitCheck ?? null,
    },
    summary: {
      adopted_ready_ids: adoptedReadyIds(scan),
      adopted_open_ids: adoptedOpenIds(scan),
      dirty_unexpected_paths: unexpectedDirtyPaths(dirty),
      transition_decision: decision(transition),
      reconcile_decision: decision(reconcile),
      commit_decision: decision(commit),
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeJson(path, value);
  return path;
}

function assertCase(name: string, result: Result, expected: Decision, okValue: boolean): void {
  if (result.decision !== expected || result.ok !== okValue) {
    throw new Error(`${name}: expected ${expected}/${okValue}, got ${result.decision}/${result.ok}`);
  }
}

function selfTest(): void {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-recovery-"));
  try {
    const idle = fixture(dir, "idle.json", { state: "idle", commit_policy: "per_seed" });
    const dispatching = fixture(dir, "dispatching.json", { state: "dispatching", in_flight_seed_id: "S-1" });
    const done = fixture(dir, "done.json", { state: "done" });
    const scanReady = fixture(dir, "scan-ready.json", {
      contract: "seedstack_scan.v1",
      ok: true,
      ids: { adopted_ready_ids: ["S-1"], adopted_open_ids: ["S-1"] },
    });
    const adoption = fixture(dir, "adoption.json", {
      contract: "adoption_selection_check.v1",
      ok: true,
      explicit_candidate_ids: ["S-1"],
    });
    const clean = fixture(dir, "dirty-clean.json", {
      contract: "dirty_state_classification.v1",
      ok: true,
      unexpected_paths: [],
      paths: [],
    });
    const dirty = fixture(dir, "dirty-unexpected.json", {
      contract: "dirty_state_classification.v1",
      ok: false,
      unexpected_paths: ["src/unexpected.ts"],
      paths: [{ path: "src/unexpected.ts", classification: "unexpected" }],
    });
    const transition = fixture(dir, "transition.json", {
      contract: "run_transition_check.v1",
      ok: true,
      decision: "transition_ready",
    });
    const attemptDir = childAttemptsDir(dir);
    mkdirSync(attemptDir, { recursive: true });
    writeFileSync(join(attemptDir, "0001-dispatch-S-1.json"), "", { flag: "a" });

    assertCase(
      "idle clean dispatch allowed",
      check({ repo: dir, seedstackDir: dir, runState: idle, scanFile: scanReady, adoptionCheck: adoption, dirtyResult: clean, runTransition: transition, seedCli: "sd", pretty: false, selfTest: false }),
      "dispatch_allowed",
      true,
    );
    assertCase(
      "dispatching unreconciled reconcile required",
      check({ repo: dir, seedstackDir: dir, runState: dispatching, scanFile: scanReady, adoptionCheck: adoption, dirtyResult: clean, seedCli: "sd", pretty: false, selfTest: false }),
      "reconcile_required",
      true,
    );
    writeFileSync(join(attemptDir, "0002-dispatch-S-1.json"), JSON.stringify({
      contract: "seedstack_child_attempt.v1",
      role: "dispatch",
      seed: "S-1",
      iteration: 2,
      state: "running",
    }) + "\n");
    assertCase(
      "dispatching running attempt blocks redispatch",
      check({ repo: dir, seedstackDir: dir, runState: dispatching, scanFile: scanReady, adoptionCheck: adoption, dirtyResult: clean, seedCli: "sd", pretty: false, selfTest: false }),
      "blocked_unknown_child",
      false,
    );
    writeFileSync(join(attemptDir, "0003-dispatch-S-1.json"), JSON.stringify({
      contract: "seedstack_child_attempt.v1",
      role: "dispatch",
      seed: "S-1",
      iteration: 3,
      state: "failed",
    }) + "\n");
    assertCase(
      "unexpected dirty blocked",
      check({ repo: dir, seedstackDir: dir, runState: idle, scanFile: scanReady, adoptionCheck: adoption, dirtyResult: dirty, seedCli: "sd", pretty: false, selfTest: false }),
      "blocked_dirty",
      false,
    );
    assertCase(
      "done no-op",
      check({ repo: dir, seedstackDir: dir, runState: done, scanFile: scanReady, adoptionCheck: adoption, dirtyResult: clean, seedCli: "sd", pretty: false, selfTest: false }),
      "no_op",
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTest) {
      selfTest();
      process.stdout.write("check-recovery-state self-test passed\n");
      return;
    }
    const result = check(options);
    process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

main();
