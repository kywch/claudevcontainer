#!/usr/bin/env bun
// Deterministic Seedstack run-state transition checker.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type RunStateName = "idle" | "dispatching" | "managing" | "done" | "exhausted" | "blocked" | "escalated" | "loop_cap";
type Decision =
  | "transition_ready"
  | "blocked_transition"
  | "blocked_missing_evidence"
  | "blocked_dirty"
  | "blocked_terminal";
type Finding = { code: string; message: string; detail?: unknown };
type JsonObject = Record<string, unknown>;

type Options = {
  repo: string;
  runState?: string;
  currentState?: RunStateName;
  nextState?: RunStateName;
  seed?: string;
  reconcileResult?: string;
  commitCheck?: string;
  scanFile?: string;
  adoptionCheck?: string;
  dirtyResult?: string;
  loopCapResult?: string;
  skippedSeeds: string[];
  stopReason?: string;
  allowUnreconciledStop: boolean;
  pretty: boolean;
  selfTest: boolean;
};

type Result = {
  contract: "run_transition_check.v1";
  ok: boolean;
  decision: Decision;
  blockers: Finding[];
  warnings: Finding[];
  current_state: RunStateName | null;
  next_state: RunStateName | null;
  seed: string | null;
  summary: JsonObject;
};

const STATES = ["idle", "dispatching", "managing", "done", "exhausted", "blocked", "escalated", "loop_cap"] as const;
const TERMINAL = new Set<RunStateName>(["done", "exhausted", "blocked", "escalated", "loop_cap"]);
const GRAPH: Record<RunStateName, RunStateName[]> = {
  idle: ["idle", "dispatching", "done", "exhausted", "blocked", "loop_cap"],
  dispatching: ["managing", "blocked", "escalated"],
  managing: ["idle", "dispatching", "done", "blocked", "escalated", "loop_cap"],
  done: [],
  exhausted: [],
  blocked: [],
  escalated: [],
  loop_cap: [],
};

const HELP = `check-run-transition.ts run_transition_check.v1

Usage:
  bun skills/seedstack/scripts/check-run-transition.ts --next-state <state> [args]
  bun skills/seedstack/scripts/check-run-transition.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root. Default: cwd.
  --run-state <path>               Current run-state JSON.
  --current-state <state>          Current state when no run-state is supplied.
  --next-state <state>             idle|dispatching|managing|done|exhausted|blocked|escalated|loop_cap.
  --seed <id>                      Proposed in-flight seed.
  --reconcile-result <json>        check-dispatch-reconcile output.
  --commit-check <json>            check-commit-ledger output.
  --scan-file <json>               seedstack_scan.v1 output.
  --adoption-check <json>          adoption_selection_check.v1 output.
  --dirty-result <json>            classify-dirty-state output.
  --loop-cap-result <json>         check-loop-caps output; required for guarded skip.
  --skipped-seed <id>              Seed proven skipped in loop-state. Repeatable.
  --stop-reason <text>             Explicit proposed evidence for blocked/escalated/loop_cap.
  --allow-unreconciled-stop        Allow dispatching -> blocked/escalated without reconcile.
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

function parseState(value: string, flag: string): RunStateName {
  if ((STATES as readonly string[]).includes(value)) return value as RunStateName;
  throw new Error(`${flag} must be one of ${STATES.join(", ")}`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    allowUnreconciledStop: false,
    skippedSeeds: [],
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
      case "--allow-unreconciled-stop":
        options.allowUnreconciledStop = true;
        break;
      case "--repo":
        options.repo = take();
        break;
      case "--run-state":
        options.runState = take();
        break;
      case "--current-state":
        options.currentState = parseState(take(), arg);
        break;
      case "--next-state":
        options.nextState = parseState(take(), arg);
        break;
      case "--seed":
        options.seed = take();
        break;
      case "--reconcile-result":
        options.reconcileResult = take();
        break;
      case "--commit-check":
        options.commitCheck = take();
        break;
      case "--scan-file":
        options.scanFile = take();
        break;
      case "--adoption-check":
        options.adoptionCheck = take();
        break;
      case "--dirty-result":
        options.dirtyResult = take();
        break;
      case "--loop-cap-result":
        options.loopCapResult = take();
        break;
      case "--skipped-seed":
        options.skippedSeeds.push(take());
        break;
      case "--stop-reason":
        options.stopReason = take();
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--run-state=")) options.runState = arg.slice("--run-state=".length);
        else if (arg.startsWith("--current-state=")) {
          options.currentState = parseState(arg.slice("--current-state=".length), "--current-state");
        } else if (arg.startsWith("--next-state=")) {
          options.nextState = parseState(arg.slice("--next-state=".length), "--next-state");
        } else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--reconcile-result=")) options.reconcileResult = arg.slice("--reconcile-result=".length);
        else if (arg.startsWith("--commit-check=")) options.commitCheck = arg.slice("--commit-check=".length);
        else if (arg.startsWith("--scan-file=")) options.scanFile = arg.slice("--scan-file=".length);
        else if (arg.startsWith("--adoption-check=")) options.adoptionCheck = arg.slice("--adoption-check=".length);
        else if (arg.startsWith("--dirty-result=")) options.dirtyResult = arg.slice("--dirty-result=".length);
        else if (arg.startsWith("--loop-cap-result=")) options.loopCapResult = arg.slice("--loop-cap-result=".length);
        else if (arg.startsWith("--skipped-seed=")) options.skippedSeeds.push(arg.slice("--skipped-seed=".length));
        else if (arg.startsWith("--stop-reason=")) options.stopReason = arg.slice("--stop-reason=".length);
        else throw new Error(`unknown arg: ${arg}`);
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

function add(blockers: Finding[], code: string, message: string, detail?: unknown): void {
  blockers.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function warn(warnings: Finding[], code: string, message: string, detail?: unknown): void {
  warnings.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function stateFrom(value: unknown): RunStateName | null {
  const state = isObject(value) ? stringField(value.state) : null;
  return state && (STATES as readonly string[]).includes(state) ? (state as RunStateName) : null;
}

function latestDispatch(runState: unknown): JsonObject | null {
  return objectField(runState, "latest_dispatch");
}

function inFlightSeed(runState: unknown): string | null {
  if (!isObject(runState)) return null;
  return (
    stringField(runState.in_flight_seed_id) ??
    stringField(runState.active_dispatch_seed_id) ??
    stringField(objectField(runState, "active_dispatch")?.seed_id) ??
    stringField(latestDispatch(runState)?.seed_id)
  );
}

function commitPolicy(runState: unknown): string | null {
  return isObject(runState) ? stringField(runState.commit_policy) : null;
}

function hasBlockerEvidence(...values: unknown[]): boolean {
  return values.some((value) => {
    if (!isObject(value)) return false;
    if (boolField(value.ok) === false) return true;
    const decision = stringField(value.decision);
    if (decision?.startsWith("blocked")) return true;
    if (decision === "commit_ready") return true;
    return Array.isArray(value.blockers) && value.blockers.length > 0;
  });
}

function scanAdoptedOpenIds(scan: unknown): string[] {
  if (!isObject(scan)) return [];
  return [
    ...stringArray(scan.open_adopted),
    ...stringArray(scan.adopted_open_ids),
    ...stringArray(objectField(scan, "ids")?.adopted_open_ids),
  ];
}

function scanAdoptedReadyIds(scan: unknown): string[] {
  if (!isObject(scan)) return [];
  return [
    ...stringArray(scan.adopted_ready_ids),
    ...stringArray(objectField(scan, "ids")?.adopted_ready_ids),
  ];
}

function checkerOk(value: unknown): boolean | null {
  return isObject(value) ? boolField(value.ok) : null;
}

function dirtyUnexpectedPaths(value: unknown): string[] {
  if (!isObject(value)) return [];
  const direct = stringArray(value.unexpected_paths);
  if (direct.length > 0) return direct;
  const paths = Array.isArray(value.paths) ? value.paths.filter(isObject) : [];
  return paths.flatMap((item) => {
    const path = stringField(item.path);
    return path && stringField(item.classification) === "unexpected" ? [path] : [];
  });
}

function checkerDecision(value: unknown): string | null {
  return isObject(value) ? stringField(value.decision) : null;
}

function loopCapSkipReady(value: unknown, seed: string | null): boolean {
  if (!isObject(value) || checkerDecision(value) !== "blocked_attempt_cap") return false;
  if (!seed) return false;
  const blockers = Array.isArray(value.blockers) ? value.blockers.filter(isObject) : [];
  return blockers.length === 1 && stringField(blockers[0]?.code) === "attempt_cap_exceeded";
}

function skippedSeedEvidence(raw: string): { seed: string; reason: string | null } {
  const split = raw.indexOf(":");
  if (split < 0) return { seed: raw, reason: null };
  return { seed: raw.slice(0, split), reason: raw.slice(split + 1) || null };
}

function scanHealth(value: unknown): string | null {
  return isObject(value) ? stringField(value.health) : null;
}

function seedInAdoption(adoption: unknown, seed: string): boolean {
  if (!isObject(adoption)) return false;
  return stringArray(adoption.explicit_candidate_ids).includes(seed);
}

function chooseDecision(blockers: Finding[], current: RunStateName | null): Decision {
  if (!blockers.length) return "transition_ready";
  if (blockers.some((finding) => finding.code.startsWith("dirty_"))) return "blocked_dirty";
  if (current && TERMINAL.has(current)) return "blocked_terminal";
  if (blockers.some((finding) => finding.code.includes("missing") || finding.code.includes("evidence"))) {
    return "blocked_missing_evidence";
  }
  return "blocked_transition";
}

function check(options: Options): Result {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const runState = loadJson(options.runState);
  const reconcile = loadJson(options.reconcileResult);
  const commit = loadJson(options.commitCheck);
  const scan = loadJson(options.scanFile);
  const adoption = loadJson(options.adoptionCheck);
  const dirty = loadJson(options.dirtyResult);
  const loopCap = loadJson(options.loopCapResult);

  if (!options.nextState) add(blockers, "missing_next_state", "--next-state required");

  const currentState = stateFrom(runState) ?? options.currentState ?? null;
  const nextState = options.nextState ?? null;
  const seed = options.seed ?? inFlightSeed(runState) ?? null;

  if (!currentState) add(blockers, "missing_current_state", "current state missing from --run-state and --current-state");
  if (currentState && nextState) {
    if (TERMINAL.has(currentState)) {
      add(blockers, "terminal_state", `${currentState} is terminal`);
    } else if (!GRAPH[currentState].includes(nextState)) {
      add(blockers, "edge_not_allowed", `${currentState} -> ${nextState} is not allowed`);
    }
  }

  if (checkerOk(dirty) === false && nextState !== "blocked" && nextState !== "escalated" && nextState !== "loop_cap") {
    add(blockers, "dirty_result_failed", "dirty-result ok false blocks non-stop transition");
  }
  const unexpectedDirty = dirtyUnexpectedPaths(dirty);
  if (unexpectedDirty.length > 0 && nextState !== "blocked" && nextState !== "escalated" && nextState !== "loop_cap") {
    add(blockers, "dirty_unexpected_paths", "dirty-result unexpected paths block non-stop transition", { unexpected_paths: unexpectedDirty });
  }

  if (currentState === "idle" && nextState === "dispatching") {
    if (!seed) add(blockers, "missing_seed", "idle -> dispatching requires --seed");
    if (!adoption) {
      add(blockers, "missing_adoption_check", "idle -> dispatching requires adoption-check");
    } else {
      if (checkerOk(adoption) !== true) add(blockers, "adoption_check_failed", "adoption-check ok true required");
      if (seed && !seedInAdoption(adoption, seed)) {
        add(blockers, "seed_not_adoption_candidate", "seed absent from adoption explicit_candidate_ids", {
          seed,
          explicit_candidate_ids: isObject(adoption) ? stringArray(adoption.explicit_candidate_ids) : [],
        });
      }
    }
    if (dirty && checkerOk(dirty) !== true) add(blockers, "dirty_result_failed", "dirty-result ok true required");
    if (scan) {
      if (checkerOk(scan) !== true) add(blockers, "scan_failed", "scan ok true required");
      const health = scanHealth(scan);
      if (health !== null && health !== "pass") {
        add(blockers, "scan_health_failed", "scan health pass required when health is present", { health });
      }
      if (seed && !scanAdoptedReadyIds(scan).includes(seed)) {
        warn(warnings, "seed_not_scan_adopted_ready", "seed not present in scan adopted_ready_ids", { seed });
      }
    }
  }

  if (currentState === "idle" && nextState === "idle") {
    if (!seed) add(blockers, "missing_seed", "idle skip transition requires --seed");
    if (!loopCap) add(blockers, "missing_loop_cap_result", "idle skip transition requires loop-cap-result");
    else if (!loopCapSkipReady(loopCap, seed)) {
      add(blockers, "loop_cap_not_skippable", "idle skip transition requires blocked_attempt_cap evidence", {
        ok: checkerOk(loopCap),
        decision: checkerDecision(loopCap),
      });
    }
    if (!scan) add(blockers, "missing_scan", "idle skip transition requires scan");
    else if (checkerOk(scan) !== true) add(blockers, "scan_failed", "scan ok true required");
    else if (seed && ![...scanAdoptedReadyIds(scan), ...scanAdoptedOpenIds(scan)].includes(seed)) {
      add(blockers, "seed_not_scan_adopted_ready_or_open", "idle skip transition requires seed in scan adopted ready/open ids", { seed });
    }
    if (!adoption) add(blockers, "missing_adoption_check", "idle skip transition requires adoption-check");
    else if (checkerOk(adoption) !== true) add(blockers, "adoption_check_failed", "adoption-check ok true required");
    else if (seed && !seedInAdoption(adoption, seed)) {
      add(blockers, "seed_not_adoption_candidate", "skip seed absent from adoption explicit_candidate_ids", { seed });
    }
    if (!dirty) add(blockers, "missing_dirty_result", "idle skip transition requires dirty-result");
    else if (checkerOk(dirty) !== true) add(blockers, "dirty_result_failed", "dirty-result ok true required");
  }

  if (currentState === "dispatching") {
    const reconcileDecision = checkerDecision(reconcile);
    if (nextState === "managing") {
      if (!reconcile) add(blockers, "missing_reconcile_result", "dispatching -> managing requires reconcile-result");
      else if (checkerOk(reconcile) !== true || reconcileDecision !== "manage_reconcile") {
        add(blockers, "reconcile_not_manage_ready", "dispatching -> managing requires ok true and decision manage_reconcile", {
          ok: checkerOk(reconcile),
          decision: reconcileDecision,
        });
      }
    }
    if (nextState === "blocked" || nextState === "escalated") {
      if (!reconcile && !options.allowUnreconciledStop) {
        add(blockers, "missing_reconcile_result", "dispatching stop requires reconcile-result unless --allow-unreconciled-stop");
      }
      if (reconcileDecision === "blocked_escalation" && nextState !== "blocked" && nextState !== "escalated") {
        add(blockers, "reconcile_escalation_target", "blocked_escalation allows only blocked/escalated");
      }
      if (reconcileDecision?.startsWith("blocked_") && nextState !== "blocked" && reconcileDecision !== "blocked_escalation") {
        add(blockers, "reconcile_blocked_target", "blocked reconcile decision allows only blocked");
      }
    }
  }

  if (currentState === "managing" && (nextState === "idle" || nextState === "done")) {
    const latest = latestDispatch(runState);
    const policy = commitPolicy(runState);
    const status = stringField(latest?.status);
    const pending = boolField(latest?.commit_pending);
    if (policy === "per_seed" && status === "closed_clean") {
      const commitDecision = checkerDecision(commit);
      const commitOk = checkerOk(commit);
      if (!commit) {
        add(blockers, "missing_commit_check", "per_seed closed_clean transition requires commit-check");
      } else if (pending === true) {
        add(blockers, "commit_pending", "commit_pending true blocks idle/done; commit_ready means commit still needed", {
          decision: commitDecision,
          ok: commitOk,
        });
      } else if (commitOk !== true || commitDecision !== "ledger_ready") {
        add(blockers, "commit_ledger_not_ready", "per_seed closed_clean transition requires commit-check ok true decision ledger_ready", {
          ok: commitOk,
          decision: commitDecision,
        });
      }
    }
  }

  if (currentState === "managing" && nextState === "dispatching") {
    const currentSeed = inFlightSeed(runState);
    if (!seed) add(blockers, "missing_seed", "managing -> dispatching requires --seed");
    if (seed && currentSeed && seed !== currentSeed) {
      add(blockers, "retry_seed_mismatch", "managing retry must dispatch the same seed", { seed, current_seed: currentSeed });
    }
    if (!loopCap) add(blockers, "missing_loop_cap_result", "managing retry requires loop-cap-result");
    else if (checkerOk(loopCap) !== true || checkerDecision(loopCap) !== "continue") {
      add(blockers, "retry_attempt_cap_blocked", "managing retry requires loop-cap-result ok true decision continue", {
        ok: checkerOk(loopCap),
        decision: checkerDecision(loopCap),
      });
    }
    if (!dirty) add(blockers, "missing_dirty_result", "managing retry requires dirty-result");
    else if (checkerOk(dirty) !== true) add(blockers, "dirty_result_failed", "dirty-result ok true required");
  }

  if (nextState === "done") {
    if (scan) {
      const openAdopted = scanAdoptedOpenIds(scan);
      const readyAdopted = scanAdoptedReadyIds(scan);
      if (openAdopted.length || readyAdopted.length) {
        add(blockers, "adopted_open_remaining", "done requires no adopted open/ready ids when scan supplied", {
          open_adopted: openAdopted,
          adopted_ready_ids: readyAdopted,
        });
      }
    } else {
      warn(warnings, "missing_scan", "done without scan cannot prove no adopted open work remains");
    }
  }

  if (nextState === "exhausted") {
    if (!scan) {
      add(blockers, "missing_scan", "exhausted requires scan");
    } else {
      if (checkerOk(scan) !== true) add(blockers, "scan_failed", "scan ok true required");
      const openAdopted = scanAdoptedOpenIds(scan);
      const readyAdopted = scanAdoptedReadyIds(scan);
      const remaining = [...new Set([...openAdopted, ...readyAdopted])];
      const skippedEvidence = options.skippedSeeds.map(skippedSeedEvidence);
      const skipped = new Set(skippedEvidence.map((item) => item.seed));
      const unskipped = remaining.filter((id) => !skipped.has(id));
      if (remaining.length === 0) {
        add(blockers, "no_skipped_open_remaining", "exhausted requires skipped open/ready adopted work; use done when none remains");
      }
      if (unskipped.length > 0) {
        add(blockers, "unskipped_open_remaining", "exhausted requires every open/ready adopted id to be skipped", {
          unskipped,
          skipped: [...skipped],
        });
      }
      for (const skippedSeed of skipped) {
        if (!remaining.includes(skippedSeed)) {
          warn(warnings, "skipped_seed_not_remaining", "skipped seed is not open/ready in exhausted scan", { seed: skippedSeed });
        }
      }
      for (const remainingSeed of remaining) {
        const evidence = skippedEvidence.find((item) => item.seed === remainingSeed);
        if (evidence?.reason !== "blocked_attempt_cap") {
          add(blockers, "missing_attempt_cap_skip_evidence", "exhausted requires blocked_attempt_cap skip evidence for every remaining seed", {
            seed: remainingSeed,
            reason: evidence?.reason ?? null,
          });
        }
      }
    }
  }

  if (nextState === "blocked" || nextState === "escalated" || nextState === "loop_cap") {
    const reason = options.stopReason;
    if (!reason && !hasBlockerEvidence(reconcile, dirty, commit)) {
      add(blockers, "missing_stop_evidence", `${nextState} requires stop reason or blocker evidence`);
    }
  }

  const decision = chooseDecision(blockers, currentState);
  return {
    contract: "run_transition_check.v1",
    ok: blockers.length === 0,
    decision,
    blockers,
    warnings,
    current_state: currentState,
    next_state: nextState,
    seed,
    summary: {
      repo: options.repo,
      run_state: options.runState ?? null,
      latest_dispatch_seed_id: stringField(latestDispatch(runState)?.seed_id),
      latest_dispatch_status: stringField(latestDispatch(runState)?.status),
      commit_policy: commitPolicy(runState),
      reconcile_decision: checkerDecision(reconcile),
      commit_decision: checkerDecision(commit),
      loop_cap_decision: checkerDecision(loopCap),
      skipped_seeds: options.skippedSeeds,
      dirty_ok: checkerOk(dirty),
      scan_ok: checkerOk(scan),
      scan_health: scanHealth(scan),
      adoption_ok: checkerOk(adoption),
      stop_reason: options.stopReason ?? null,
    },
  };
}

function assertCase(name: string, result: Result, ok: boolean, decision: Decision): void {
  if (result.ok !== ok || result.decision !== decision) {
    throw new Error(`${name}: got ok=${result.ok} decision=${result.decision}`);
  }
}

function selfTest(pretty: boolean): Result {
  const dir = mkdtempSync(join(tmpdir(), "run-transition-check-"));
  try {
    const write = (name: string, value: unknown) => {
      const path = join(dir, name);
      writeFileSync(path, `${JSON.stringify(value)}\n`);
      return path;
    };
    const state = (stateName: RunStateName, extra: JsonObject = {}) => write("run-state.json", { state: stateName, ...extra });
    const adoptionPass = write("adoption-pass.json", { ok: true, explicit_candidate_ids: ["S1"] });
    const dirtyPass = write("dirty-pass.json", { ok: true, unexpected_paths: [], paths: [] });
    const dirtyFail = write("dirty-fail.json", { ok: false, unexpected_paths: ["src/bad.ts"], paths: [{ path: "src/bad.ts" }] });
    const dirtySoftUnexpected = write("dirty-soft-unexpected.json", {
      ok: true,
      unexpected_paths: ["src/soft.ts"],
      paths: [{ path: "src/soft.ts", classification: "unexpected" }],
    });
    const scanPass = write("scan-pass.json", { ok: true, adopted_ready_ids: ["S1"], open_adopted: [] });
    const scanWarning = write("scan-warning.json", { ok: true, health: "warning", adopted_ready_ids: ["S1"], open_adopted: [] });
    const scanDone = write("scan-done.json", { ok: true, adopted_ready_ids: [], open_adopted: [] });
    const scanOpen = write("scan-open.json", { ok: true, adopted_ready_ids: ["S2"], open_adopted: ["S3"] });
    const scanSkipped = write("scan-skipped.json", { ok: true, adopted_ready_ids: ["S1"], open_adopted: [] });
    const reconcilePass = write("reconcile-pass.json", { ok: true, decision: "manage_reconcile", blockers: [] });
    const reconcileBlocked = write("reconcile-blocked.json", { ok: false, decision: "blocked_failed_gate", blockers: [{ code: "x", message: "x" }] });
    const ledgerReady = write("ledger-ready.json", { ok: true, decision: "ledger_ready", blockers: [] });
    const commitReady = write("commit-ready.json", { ok: true, decision: "commit_ready", blockers: [] });
    const attemptCap = write("attempt-cap.json", {
      ok: false,
      decision: "blocked_attempt_cap",
      blockers: [{ code: "attempt_cap_exceeded", message: "attempt cap" }],
    });

    const base: Omit<Options, "nextState"> = {
      repo: dir,
      allowUnreconciledStop: false,
      skippedSeeds: [],
      pretty,
      selfTest: true,
    };

    const cases = [
      {
        name: "idle dispatch adoption pass",
        result: check({
          ...base,
          runState: state("idle"),
          nextState: "dispatching",
          seed: "S1",
          adoptionCheck: adoptionPass,
          dirtyResult: dirtyPass,
          scanFile: scanPass,
        }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "idle dispatch missing adoption",
        result: check({ ...base, runState: state("idle"), nextState: "dispatching", seed: "S1" }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "idle dispatch scan health warning blocks",
        result: check({
          ...base,
          runState: state("idle"),
          nextState: "dispatching",
          seed: "S1",
          adoptionCheck: adoptionPass,
          dirtyResult: dirtyPass,
          scanFile: scanWarning,
        }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "idle dispatch soft unexpected dirty blocks",
        result: check({
          ...base,
          runState: state("idle"),
          nextState: "dispatching",
          seed: "S1",
          adoptionCheck: adoptionPass,
          dirtyResult: dirtySoftUnexpected,
          scanFile: scanPass,
        }),
        ok: false,
        decision: "blocked_dirty" as Decision,
      },
      {
        name: "missing current state blocks",
        result: check({ ...base, currentState: undefined, nextState: "dispatching", seed: "S1", adoptionCheck: adoptionPass }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "dispatching idle blocks",
        result: check({ ...base, runState: state("dispatching"), nextState: "idle" }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "idle skip attempt cap passes",
        result: check({
          ...base,
          runState: state("idle"),
          nextState: "idle",
          seed: "S1",
          scanFile: scanPass,
          adoptionCheck: adoptionPass,
          dirtyResult: dirtyPass,
          loopCapResult: attemptCap,
        }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "idle generic self-loop blocks",
        result: check({ ...base, runState: state("idle"), nextState: "idle", seed: "S1", scanFile: scanPass, adoptionCheck: adoptionPass }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "dispatching managing pass",
        result: check({ ...base, runState: state("dispatching"), nextState: "managing", reconcileResult: reconcilePass }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "dispatching managing blocked reconcile",
        result: check({ ...base, runState: state("dispatching"), nextState: "managing", reconcileResult: reconcileBlocked }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "managing done missing commit",
        result: check({
          ...base,
          runState: state("managing", {
            commit_policy: "per_seed",
            latest_dispatch: { seed_id: "S1", status: "closed_clean", commit_pending: false },
          }),
          nextState: "done",
          scanFile: scanDone,
        }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "managing done ledger ready",
        result: check({
          ...base,
          runState: state("managing", {
            commit_policy: "per_seed",
            latest_dispatch: { seed_id: "S1", status: "closed_clean", commit_pending: false },
          }),
          nextState: "done",
          commitCheck: ledgerReady,
          scanFile: scanDone,
        }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "managing done commit pending commit ready blocks",
        result: check({
          ...base,
          runState: state("managing", {
            commit_policy: "per_seed",
            latest_dispatch: { seed_id: "S1", status: "closed_clean", commit_pending: true },
          }),
          nextState: "done",
          commitCheck: commitReady,
          scanFile: scanDone,
        }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "managing idle commit pending commit ready blocks",
        result: check({
          ...base,
          runState: state("managing", {
            commit_policy: "per_seed",
            latest_dispatch: { seed_id: "S1", status: "closed_clean", commit_pending: true },
          }),
          nextState: "idle",
          commitCheck: commitReady,
        }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "managing retry same seed passes",
        result: check({
          ...base,
          runState: state("managing", { in_flight_seed_id: "S1", dispatch_attempts: { S1: 1 } }),
          nextState: "dispatching",
          seed: "S1",
          dirtyResult: dirtyPass,
          loopCapResult: write("loop-cap-continue.json", { ok: true, decision: "continue", blockers: [] }),
        }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "managing retry other seed blocks",
        result: check({
          ...base,
          runState: state("managing", { in_flight_seed_id: "S1", dispatch_attempts: { S1: 1 } }),
          nextState: "dispatching",
          seed: "S2",
          dirtyResult: dirtyPass,
          loopCapResult: write("loop-cap-continue-2.json", { ok: true, decision: "continue", blockers: [] }),
        }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "done adopted open ready blocks",
        result: check({ ...base, runState: state("managing"), nextState: "done", scanFile: scanOpen }),
        ok: false,
        decision: "blocked_transition" as Decision,
      },
      {
        name: "idle exhausted skipped open passes",
        result: check({ ...base, runState: state("idle"), nextState: "exhausted", scanFile: scanSkipped, skippedSeeds: ["S1:blocked_attempt_cap"] }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "idle exhausted missing attempt evidence blocks",
        result: check({ ...base, runState: state("idle"), nextState: "exhausted", scanFile: scanSkipped, skippedSeeds: ["S1"] }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "idle exhausted unskipped open blocks",
        result: check({ ...base, runState: state("idle"), nextState: "exhausted", scanFile: scanSkipped, skippedSeeds: [] }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "stale stop reason blocks without new evidence",
        result: check({ ...base, runState: state("managing", { stop_reason: "old stop" }), nextState: "blocked" }),
        ok: false,
        decision: "blocked_missing_evidence" as Decision,
      },
      {
        name: "loop cap dirty false explicit reason passes",
        result: check({ ...base, runState: state("managing"), nextState: "loop_cap", dirtyResult: dirtyFail, stopReason: "loop cap reached" }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "loop cap blocker evidence passes",
        result: check({ ...base, runState: state("managing"), nextState: "loop_cap", dirtyResult: dirtyFail }),
        ok: true,
        decision: "transition_ready" as Decision,
      },
      {
        name: "terminal idle blocks",
        result: check({ ...base, runState: state("done"), nextState: "idle" }),
        ok: false,
        decision: "blocked_terminal" as Decision,
      },
      {
        name: "dirty false dispatch blocks",
        result: check({
          ...base,
          runState: state("idle"),
          nextState: "dispatching",
          seed: "S1",
          adoptionCheck: adoptionPass,
          dirtyResult: dirtyFail,
        }),
        ok: false,
        decision: "blocked_dirty" as Decision,
      },
    ];

    for (const item of cases) assertCase(item.name, item.result, item.ok, item.decision);
    return {
      contract: "run_transition_check.v1",
      ok: true,
      decision: "transition_ready",
      blockers: [],
      warnings: [],
      current_state: null,
      next_state: null,
      seed: null,
      summary: { self_tests: cases.length, cases: cases.map((item) => ({ name: item.name, ok: item.result.ok, decision: item.result.decision })) },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function usageError(message: string): Result {
  return {
    contract: "run_transition_check.v1",
    ok: false,
    decision: "blocked_missing_evidence",
    blockers: [{ code: "usage_error", message }],
    warnings: [],
    current_state: null,
    next_state: null,
    seed: null,
    summary: {},
  };
}

function main(): number {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    printJson(usageError((error as Error).message), false);
    return 2;
  }

  if (options.selfTest) {
    printJson(selfTest(options.pretty), options.pretty);
    return 0;
  }

  try {
    const result = check(options);
    printJson(result, options.pretty);
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson(
      {
        ...usageError((error as Error).message),
        blockers: [{ code: "checker_crash", message: (error as Error).message }],
      },
      options.pretty,
    );
    return 2;
  }
}

process.exit(main());
