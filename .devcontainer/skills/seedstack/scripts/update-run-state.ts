#!/usr/bin/env bun
// Deterministic Seedstack run-state refresher.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runStatePath } from "./seedstack-paths.ts";

type RunStateName =
  | "idle"
  | "dispatching"
  | "managing"
  | "done"
  | "exhausted"
  | "blocked"
  | "escalated"
  | "loop_cap";

type JsonObject = Record<string, unknown>;

type Options = {
  repo: string;
  originalRepo?: string;
  worktreePolicy?: "linked-ok" | "allow-same-branch";
  worktreeMetadataFile?: string;
  seedstackDir?: string;
  state?: RunStateName;
  seed?: string;
  candidates: string[];
  candidatesFile?: string;
  decision?: string;
  rationale?: string;
  latestDispatchFile?: string;
  boundaryHealthFile?: string;
  reconcileResult?: string;
  dirtyResult?: string;
  commit?: string;
  commitPolicy?: "none" | "per_seed";
  blockedReason?: string;
  doneReason?: string;
  stopReason?: string;
  events: Array<{ type: string; text: string }>;
  loopIteration?: number;
  pretty: boolean;
  dryRun: boolean;
  selfTest: boolean;
};

type Contract = {
  contract: "update_run_state.v1";
  ok: boolean;
  state_path: string | null;
  run_path: string | null;
  state: RunStateName | null;
  warnings: string[];
  writes: string[];
  summary: JsonObject;
};

const STATES = new Set<RunStateName>([
  "idle",
  "dispatching",
  "managing",
  "done",
  "exhausted",
  "blocked",
  "escalated",
  "loop_cap",
]);

const HELP = `update-run-state.ts update_run_state.v1

Usage:
  bun skills/seedstack/scripts/update-run-state.ts --seedstack-dir <path> --state <state> [args]
  bun skills/seedstack/scripts/update-run-state.ts --self-test [--pretty]

Args:
  --seedstack-dir <path>              Artifact dir containing run-state.json/run.md.
  --state <idle|dispatching|managing|done|exhausted|blocked|escalated|loop_cap>
  --repo <path>                       Repo root. Default: cwd.
  --original-repo <path>              Original repo argument before normalization.
  --worktree-policy <linked-ok|allow-same-branch>
                                     Active worktree policy.
  --worktree-metadata-file <json>     Worktree preflight metadata object.
  --seed <id>                         Current chosen/in-flight seed.
  --candidate <id>                    Ready candidate work order id. Repeatable.
  --candidates-file <json>            Array or object with candidates/ready/adopted_ready_ids.
  --decision <text>                   Latest run/manage decision.
  --rationale <text>                  Selection or stop rationale.
  --latest-dispatch-file <json>       Object merged into latest_dispatch.
  --boundary-health-file <json>       Boundary health result summarized into state.
  --reconcile-result <json>           Reconciliation result, summarized into state.
  --dirty-result <json>               Dirty classifier result, normalized into dirty_state.
  --commit <hash>                     Latest commit hash.
  --commit-policy <none|per_seed>     Current loop commit policy.
  --blocked-reason <text>             Blocked/escalated/loop_cap reason.
  --done-reason <text>                Done reason.
  --stop-reason <text>                Stop reason.
  --event <type:text>                 Append run event. Repeatable.
  --loop-iteration <n>                Explicit loop iteration value.
  --pretty                            Pretty-print JSON.
  --dry-run                           Print result and state preview; write nothing.
  --self-test                         Run fixture tests.
  --help                              Show this help.
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

function parseState(value: string): RunStateName {
  if (!STATES.has(value as RunStateName)) throw new Error(`invalid --state ${value}`);
  return value as RunStateName;
}

function parseEvent(value: string): { type: string; text: string } {
  const split = value.indexOf(":");
  if (split <= 0) throw new Error("--event must be type:text");
  const type = value.slice(0, split).trim();
  const text = value.slice(split + 1).trim();
  if (!type || !text) throw new Error("--event must be type:text");
  return { type, text };
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    candidates: [],
    events: [],
    pretty: false,
    dryRun: false,
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
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      case "--repo":
        options.repo = take();
        break;
      case "--original-repo":
        options.originalRepo = take();
        break;
      case "--worktree-policy": {
        const policy = take();
        if (policy !== "linked-ok" && policy !== "allow-same-branch") {
          throw new Error("--worktree-policy must be linked-ok or allow-same-branch");
        }
        options.worktreePolicy = policy;
        break;
      }
      case "--worktree-metadata-file":
        options.worktreeMetadataFile = take();
        break;
      case "--seedstack-dir":
        options.seedstackDir = take();
        break;
      case "--state":
        options.state = parseState(take());
        break;
      case "--seed":
        options.seed = take();
        break;
      case "--candidate":
        options.candidates.push(take());
        break;
      case "--candidates-file":
        options.candidatesFile = take();
        break;
      case "--decision":
        options.decision = take();
        break;
      case "--rationale":
        options.rationale = take();
        break;
      case "--latest-dispatch-file":
        options.latestDispatchFile = take();
        break;
      case "--boundary-health-file":
        options.boundaryHealthFile = take();
        break;
      case "--reconcile-result":
        options.reconcileResult = take();
        break;
      case "--dirty-result":
        options.dirtyResult = take();
        break;
      case "--commit":
        options.commit = take();
        break;
      case "--commit-policy": {
        const policy = take();
        if (policy !== "none" && policy !== "per_seed") throw new Error("--commit-policy must be none or per_seed");
        options.commitPolicy = policy;
        break;
      }
      case "--blocked-reason":
        options.blockedReason = take();
        break;
      case "--done-reason":
        options.doneReason = take();
        break;
      case "--stop-reason":
        options.stopReason = take();
        break;
      case "--event":
        options.events.push(parseEvent(take()));
        break;
      case "--loop-iteration":
        options.loopIteration = parseInteger(take(), "--loop-iteration");
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--original-repo=")) options.originalRepo = arg.slice("--original-repo=".length);
        else if (arg.startsWith("--worktree-policy=")) {
          const policy = arg.slice("--worktree-policy=".length);
          if (policy !== "linked-ok" && policy !== "allow-same-branch") {
            throw new Error("--worktree-policy must be linked-ok or allow-same-branch");
          }
          options.worktreePolicy = policy;
        }
        else if (arg.startsWith("--worktree-metadata-file=")) options.worktreeMetadataFile = arg.slice("--worktree-metadata-file=".length);
        else if (arg.startsWith("--seedstack-dir=")) options.seedstackDir = arg.slice("--seedstack-dir=".length);
        else if (arg.startsWith("--state=")) options.state = parseState(arg.slice("--state=".length));
        else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--candidate=")) options.candidates.push(arg.slice("--candidate=".length));
        else if (arg.startsWith("--candidates-file=")) options.candidatesFile = arg.slice("--candidates-file=".length);
        else if (arg.startsWith("--decision=")) options.decision = arg.slice("--decision=".length);
        else if (arg.startsWith("--rationale=")) options.rationale = arg.slice("--rationale=".length);
        else if (arg.startsWith("--latest-dispatch-file=")) options.latestDispatchFile = arg.slice("--latest-dispatch-file=".length);
        else if (arg.startsWith("--boundary-health-file=")) options.boundaryHealthFile = arg.slice("--boundary-health-file=".length);
        else if (arg.startsWith("--reconcile-result=")) options.reconcileResult = arg.slice("--reconcile-result=".length);
        else if (arg.startsWith("--dirty-result=")) options.dirtyResult = arg.slice("--dirty-result=".length);
        else if (arg.startsWith("--commit=")) options.commit = arg.slice("--commit=".length);
        else if (arg.startsWith("--commit-policy=")) {
          const policy = arg.slice("--commit-policy=".length);
          if (policy !== "none" && policy !== "per_seed") throw new Error("--commit-policy must be none or per_seed");
          options.commitPolicy = policy;
        }
        else if (arg.startsWith("--blocked-reason=")) options.blockedReason = arg.slice("--blocked-reason=".length);
        else if (arg.startsWith("--done-reason=")) options.doneReason = arg.slice("--done-reason=".length);
        else if (arg.startsWith("--stop-reason=")) options.stopReason = arg.slice("--stop-reason=".length);
        else if (arg.startsWith("--event=")) options.events.push(parseEvent(arg.slice("--event=".length)));
        else if (arg.startsWith("--loop-iteration=")) {
          options.loopIteration = parseInteger(arg.slice("--loop-iteration=".length), "--loop-iteration");
        } else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  if (options.seedstackDir) options.seedstackDir = resolve(options.seedstackDir);
  if (options.worktreeMetadataFile) options.worktreeMetadataFile = resolve(options.worktreeMetadataFile);
  return options;
}

function parseInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a nonnegative integer`);
  return Number.parseInt(value, 10);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readState(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const parsed = readJson(path);
  if (!isObject(parsed)) throw new Error(`${path} must contain a JSON object`);
  return parsed;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function candidatesFromFile(path: string): string[] {
  const parsed = readJson(path);
  if (Array.isArray(parsed)) return stringArray(parsed);
  if (!isObject(parsed)) throw new Error("--candidates-file must be array or object");
  return [
    ...stringArray(parsed.candidates),
    ...stringArray(parsed.ready),
    ...stringArray(parsed.adopted_ready_ids),
  ];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function summarizeJson(path: string): JsonObject {
  const parsed = readJson(path);
  if (!isObject(parsed)) return { path, result: parsed };
  const summary: JsonObject = { path };
  for (const key of ["contract", "ok", "decision", "state", "seed", "summary"]) {
    if (key in parsed) summary[key] = parsed[key];
  }
  if (Array.isArray(parsed.findings)) {
    summary.findings = parsed.findings.filter(isObject).slice(0, 5).map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      seed_ref: finding.seed_ref,
      threshold: finding.threshold,
      observed: finding.observed,
      action: finding.action,
    }));
  }
  return summary;
}

function normalizeDirty(path: string): JsonObject {
  const parsed = readJson(path);
  if (!isObject(parsed)) throw new Error("--dirty-result must contain object");
  const rawPaths = Array.isArray(parsed.paths) ? parsed.paths : [];
  const paths = rawPaths.filter(isObject).map((item) => ({
    path: String(item.path ?? ""),
    classification: String(item.classification ?? "unexpected"),
    reason: String(item.reason ?? ""),
    ...(typeof item.status === "string" ? { status: item.status } : {}),
  }));
  const unexpectedPaths = stringArray(parsed.unexpected_paths);
  const unexpected =
    unexpectedPaths.length > 0
      ? unexpectedPaths
      : paths
          .filter((item) => item.classification === "unexpected")
          .map((item) => item.path)
          .filter(Boolean);
  return {
    git_status:
      paths.length === 0 ? "clean" : unexpected.length === 0 ? "dirty_expected" : "dirty_unexpected",
    paths,
    unexpected_paths: unexpected,
    source: path,
    ...(isObject(parsed.summary) ? { summary: parsed.summary } : {}),
  };
}

function relativeToRepo(absPath: string, repo: string): string {
  const resolved = resolve(absPath);
  if (resolved.startsWith(`${repo}/`)) return resolved.slice(repo.length + 1);
  return resolved;
}

function pathSummary(seedstackDir: string, repo: string) {
  return {
    statePath: runStatePath(seedstackDir),
    runPath: join(seedstackDir, "run.md"),
    stateDisplay: relativeToRepo(runStatePath(seedstackDir), repo),
    runDisplay: relativeToRepo(join(seedstackDir, "run.md"), repo),
  };
}

function validate(options: Options): string[] {
  const errors: string[] = [];
  if (!options.seedstackDir) errors.push("--seedstack-dir required unless --self-test");
  if (!options.state) errors.push("--state required unless --self-test");
  if (options.state === "dispatching") {
    if (!options.seed) errors.push("dispatching requires --seed");
    if (!options.decision) errors.push("dispatching requires --decision");
    if (!options.rationale) errors.push("dispatching requires --rationale");
  }
  if (options.state === "managing") {
    if (!options.seed) errors.push("managing requires --seed");
    if (!options.decision) errors.push("managing requires --decision");
    if (!options.rationale) errors.push("managing requires --rationale");
  }
  if ((options.state === "done" || options.state === "exhausted") && !options.doneReason && !options.stopReason) {
    errors.push(`${options.state} requires --done-reason or --stop-reason`);
  }
  if (
    (options.state === "blocked" || options.state === "escalated" || options.state === "loop_cap") &&
    !options.blockedReason &&
    !options.stopReason
  ) {
    errors.push(`${options.state} requires --blocked-reason or --stop-reason`);
  }
  return errors;
}

function updateState(existing: JsonObject, options: Options, now: string): { state: JsonObject; warnings: string[] } {
  if (!options.seedstackDir || !options.state) throw new Error("missing required options");
  const warnings: string[] = [];
  const state: JsonObject = { ...existing };
  const hasCandidateInput = options.candidates.length > 0 || !!options.candidatesFile;
  const candidates = dedupe([
    ...options.candidates,
    ...(options.candidatesFile ? candidatesFromFile(options.candidatesFile) : []),
  ]);

  state.state = options.state;
  state.updated_at = now;
  state.repo = options.repo;
  if (options.originalRepo !== undefined) state.original_repo = options.originalRepo;
  if (options.worktreePolicy !== undefined) state.worktree_policy = options.worktreePolicy;
  if (options.worktreeMetadataFile) {
    const metadata = readJson(options.worktreeMetadataFile);
    if (!isObject(metadata)) throw new Error("--worktree-metadata-file must contain object");
    state.worktree = metadata;
  }
  if (options.loopIteration !== undefined) state.loop_iteration = options.loopIteration;
  if (options.commitPolicy) state.commit_policy = options.commitPolicy;
  if (options.decision) state.decision = options.decision;
  if (options.rationale) state.rationale = options.rationale;
  if (options.blockedReason) state.blocked_reason = options.blockedReason;
  if (options.doneReason) state.done_reason = options.doneReason;
  if (options.stopReason) state.stop_reason = options.stopReason;
  normalizeStopFields(state, options);
  if (options.state === "dispatching" && options.seed) {
    const attempts = isObject(state.dispatch_attempts) ? { ...state.dispatch_attempts } : {};
    const previous = typeof attempts[options.seed] === "number" && Number.isFinite(attempts[options.seed]) ? (attempts[options.seed] as number) : 0;
    attempts[options.seed] = previous + 1;
    state.dispatch_attempts = attempts;
  }

  const existingLatestDispatch = isObject(state.latest_dispatch) ? state.latest_dispatch : {};
  const existingLatestSeed = typeof existingLatestDispatch.seed_id === "string" ? existingLatestDispatch.seed_id : null;
  const isSeedDispatchState = !!options.seed && (options.state === "dispatching" || options.state === "managing");
  const latestDispatch =
    isSeedDispatchState && existingLatestSeed !== options.seed
      ? { seed_id: options.seed, dispatch_artifact_root: `tmp/dispatch-work/${options.seed}` }
      : { ...existingLatestDispatch };
  if (isSeedDispatchState && existingLatestSeed !== options.seed) {
    delete state.reconciliation;
  }
  if (isSeedDispatchState) {
    latestDispatch.seed_id = options.seed;
    if (!latestDispatch.dispatch_artifact_root) latestDispatch.dispatch_artifact_root = `tmp/dispatch-work/${options.seed}`;
  }
  if (options.latestDispatchFile) {
    const latest = readJson(options.latestDispatchFile);
    if (!isObject(latest)) throw new Error("--latest-dispatch-file must contain object");
    Object.assign(latestDispatch, latest);
  }
  if (options.boundaryHealthFile) {
    state.boundary_health = summarizeJson(options.boundaryHealthFile);
  } else if (isSeedDispatchState && existingLatestSeed !== options.seed) {
    delete state.boundary_health;
  }
  if (options.seed && !latestDispatch.dispatch_artifact_root) {
    latestDispatch.dispatch_artifact_root = `tmp/dispatch-work/${options.seed}`;
  }
  if (options.reconcileResult) {
    const summary = summarizeJson(options.reconcileResult);
    latestDispatch.reconcile_result_path = options.reconcileResult;
    latestDispatch.reconciliation = summary;
    state.reconciliation = summary;
  }
  if (options.commit) {
    latestDispatch.commit = options.commit;
    latestDispatch.commit_pending = false;
  }
  if (Object.keys(latestDispatch).length > 0) state.latest_dispatch = latestDispatch;

  const selectedRationale = options.rationale ?? (isObject(state.selection) ? String(state.selection.rationale ?? "") : "");
  const existingSelection = isObject(state.selection) ? state.selection : {};
  state.selection = {
    ...existingSelection,
    ...(hasCandidateInput ? { candidates } : {}),
    chosen_seed_id: options.state === "dispatching" || options.state === "managing" ? options.seed ?? null : null,
    rationale: selectedRationale || null,
  };

  if (options.state === "dispatching") {
    state.in_flight_seed_id = options.seed ?? null;
    state.dispatch_artifact_root = String(latestDispatch.dispatch_artifact_root ?? `tmp/dispatch-work/${options.seed}`);
  } else if (options.state === "managing") {
    state.in_flight_seed_id = options.seed ?? String(latestDispatch.seed_id ?? "");
    state.dispatch_artifact_root =
      String(latestDispatch.dispatch_artifact_root ?? (options.seed ? `tmp/dispatch-work/${options.seed}` : ""));
  } else if (options.state === "idle") {
    state.in_flight_seed_id = null;
    if (!options.rationale) {
      warnings.push("idle recommends --rationale");
    }
  } else {
    const unreconciled = latestDispatch.unreconciled === true || latestDispatch.status === "unreconciled";
    state.in_flight_seed_id = unreconciled ? options.seed ?? latestDispatch.seed_id ?? null : null;
  }

  if (options.dirtyResult) state.dirty_state = normalizeDirty(options.dirtyResult);
  if (options.events.length > 0) {
    const prior = Array.isArray(state.events) ? state.events : [];
    state.events = [
      ...prior,
      ...options.events.map((event) => ({ at: now, type: event.type, text: event.text })),
    ];
  }

  return { state, warnings };
}

function normalizeStopFields(state: JsonObject, options: Options): void {
  const clearStopFields = () => {
    delete state.blocked_reason;
    delete state.done_reason;
    delete state.stop_reason;
    delete state.stop_condition;
    delete state.next_command;
    delete state.user_decision;
  };

  if (options.state === "idle" || options.state === "dispatching" || options.state === "managing") {
    clearStopFields();
    return;
  }

  if (options.state === "done") {
    if (!options.doneReason && options.stopReason) state.done_reason = options.stopReason;
    delete state.blocked_reason;
    delete state.stop_reason;
    delete state.stop_condition;
    delete state.next_command;
    delete state.user_decision;
    return;
  }

  if (options.state === "exhausted") {
    if (options.stopReason || options.doneReason) state.stop_reason = options.stopReason ?? options.doneReason;
    delete state.blocked_reason;
    delete state.done_reason;
    delete state.stop_condition;
    delete state.next_command;
    delete state.user_decision;
    return;
  }

  delete state.done_reason;
}

function renderRunMarkdown(state: JsonObject): string {
  const title = String(state.network_slug ?? basename(dirname(String(state.plan ?? "run"))) ?? "seedstack");
  const latest = isObject(state.latest_dispatch) ? state.latest_dispatch : {};
  const selection = isObject(state.selection) ? state.selection : {};
  const dirty = isObject(state.dirty_state) ? state.dirty_state : {};
  const scan = isObject(state.pre_dispatch_scan) ? state.pre_dispatch_scan : {};
  const boundary = isObject(state.boundary_health) ? state.boundary_health : {};
  const boundarySummary = isObject(boundary.summary) ? boundary.summary : {};
  const candidates = stringArray(selection.candidates);
  const dirtyPaths = Array.isArray(dirty.paths) ? dirty.paths.filter(isObject) : [];
  const unexpected = stringArray(dirty.unexpected_paths);
  const followups = Array.isArray(state.followups) ? state.followups.length : state.followup_count;
  const worktree = isObject(state.worktree) ? state.worktree : {};
  const worktreeRef = [
    worktree.linked === true ? "linked" : worktree.linked === false ? "main" : "unknown",
    typeof worktree.branch === "string" && worktree.branch ? worktree.branch : "detached",
    typeof worktree.head === "string" && worktree.head ? String(worktree.head).slice(0, 12) : "no-head",
  ].join(" ");

  return [
    `# Seedstack Run: ${title}`,
    "",
    ...kvLines({
      state: state.state,
      updated_at: state.updated_at,
      repo: state.repo,
      original_repo: state.original_repo,
      worktree_policy: state.worktree_policy,
      worktree: worktreeRef,
      cli: state.cli,
      mode: state.mode,
      commit_policy: state.commit_policy,
      assignee: state.assignee,
      adoption_epoch: state.adoption_epoch,
      adoption_selection: state.adoption_selection,
      active_manifest: state.active_manifest,
      plan: state.plan,
      shared_label: state.shared_label,
      loop_iteration: state.loop_iteration,
      loop_cap: state.loop_cap,
    }),
    "",
    "## Current Selection",
    "",
    `- candidates: ${candidates.length ? candidates.join(", ") : "none"}`,
    `- chosen_seed_id: ${display(selection.chosen_seed_id)}`,
    `- rationale: ${display(selection.rationale)}`,
    "",
    "## Latest Dispatch",
    "",
    ...kvLines({
      seed_id: latest.seed_id,
      status: latest.status,
      dispatch_artifact_root: latest.dispatch_artifact_root ?? state.dispatch_artifact_root,
      gate: latest.gate,
      terminal_event: latest.terminal_event,
      dispatcher_report: latest.dispatcher_report,
      reconciliation: latest.reconciliation,
      manage_reconciliation: latest.manage_reconciliation,
      manage_result: latest.manage_result ?? state.manage_result,
      commit: latest.commit,
      commit_pending: latest.commit_pending,
    }),
    "",
    "## Current Stack State",
    "",
    ...kvLines({
      health: scan.health,
      closed_adopted: scan.closed_adopted,
      open_adopted: scan.open_adopted,
      ready_candidates: scan.adopted_ready_ids ?? scan.ready_ids,
      excluded_ready: scan.excluded_ready_ids,
      blocked_adopted: scan.adopted_blocked_ids,
      in_flight_seed_id: state.in_flight_seed_id,
      followup_count: followups,
    }),
    "",
    "## Dirty Classification",
    "",
    dirtyPaths.length
      ? dirtyPaths
          .map(
            (item) =>
              `- \`${String(item.path ?? "")}\`: ${String(item.classification ?? "")}, ${String(item.reason ?? "")}`,
          )
          .join("\n")
      : "- paths: none",
    `- unexpected_paths: ${unexpected.length ? unexpected.join(", ") : "none"}`,
    "",
    "## Boundary Status",
    "",
    ...kvLines({
      seed: boundary.seed,
      decision: boundary.decision,
      artifact: boundary.path,
      warnings: boundarySummary.warnings,
      blockers: boundarySummary.blockers,
      findings: boundary.findings,
    }),
    "",
    "## Stop Or Next Action",
    "",
    `- decision: ${display(state.decision)}`,
    `- rationale: ${display(state.rationale)}`,
    `- blocked_reason: ${display(state.blocked_reason)}`,
    `- done_reason: ${display(state.done_reason)}`,
    `- stop_reason: ${display(state.stop_reason)}`,
    `- stop_condition: ${display(state.stop_condition)}`,
    `- next_command: ${display(state.next_command)}`,
    `- user_decision: ${display(state.user_decision)}`,
    "",
  ].join("\n");
}

function kvLines(entries: JsonObject): string[] {
  return Object.entries(entries).map(([key, value]) => `- ${key}: ${display(value)}`);
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (Array.isArray(value)) {
    if (!value.length) return "none";
    return value.every((item) => ["string", "number", "boolean"].includes(typeof item))
      ? value.map(String).join(", ")
      : JSON.stringify(value);
  }
  if (isObject(value)) return JSON.stringify(value);
  return String(value);
}

function tempPath(path: string, label: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${label}.tmp`);
}

function writePairAtomic(firstPath: string, firstContent: string, secondPath: string, secondContent: string): void {
  const firstTemp = tempPath(firstPath, "state");
  const secondTemp = tempPath(secondPath, "run");
  const rollbackTemp = tempPath(firstPath, "rollback");
  let firstRenamed = false;
  let rollbackReady = false;
  try {
    writeFileSync(firstTemp, firstContent);
    writeFileSync(secondTemp, secondContent);
    if (existsSync(firstPath)) {
      renameSync(firstPath, rollbackTemp);
      rollbackReady = true;
    }
    // Both temp files are safely written before either target path is replaced.
    renameSync(firstTemp, firstPath);
    firstRenamed = true;
    renameSync(secondTemp, secondPath);
    if (rollbackReady) rmSync(rollbackTemp, { force: true });
  } catch (error) {
    if (firstRenamed) {
      rmSync(firstPath, { force: true });
      if (rollbackReady) renameSync(rollbackTemp, firstPath);
    } else if (rollbackReady && !existsSync(firstPath)) {
      renameSync(rollbackTemp, firstPath);
    }
    rmSync(firstTemp, { force: true });
    rmSync(secondTemp, { force: true });
    rmSync(rollbackTemp, { force: true });
    throw error;
  }
}

function contract(
  options: Options,
  statePath: string | null,
  runPath: string | null,
  state: RunStateName | null,
  ok: boolean,
  warnings: string[],
  writes: string[],
  summary: JsonObject,
): Contract {
  return {
    contract: "update_run_state.v1",
    ok,
    state_path: statePath,
    run_path: runPath,
    state,
    warnings,
    writes,
    summary: {
      dry_run: options.dryRun,
      ...summary,
    },
  };
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function run(options: Options): Contract {
  const errors = validate(options);
  const paths = options.seedstackDir ? pathSummary(options.seedstackDir, options.repo) : null;
  if (errors.length > 0) {
    return contract(options, paths?.statePath ?? null, paths?.runPath ?? null, options.state ?? null, false, errors, [], {
      validation_errors: errors,
    });
  }
  if (!paths || !options.state || !options.seedstackDir) throw new Error("unreachable");

  const existing = readState(paths.statePath);
  const { state, warnings } = updateState(existing, options, new Date().toISOString());
  const runMd = renderRunMarkdown(state);
  const writes: string[] = [];
  if (!options.dryRun) {
    writePairAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, paths.runPath, runMd);
    writes.push(paths.stateDisplay);
    writes.push(paths.runDisplay);
  }

  const summary: JsonObject = {
    seed: options.seed ?? null,
    in_flight_seed_id: state.in_flight_seed_id ?? null,
    candidates: isObject(state.selection) ? state.selection.candidates ?? [] : [],
  };
  if (options.dryRun) {
    summary.state_preview = state;
    summary.run_preview = runMd;
  }
  return contract(options, paths.statePath, paths.runPath, options.state, true, warnings, writes, summary);
}

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

function selfTest(pretty: boolean): void {
  const dir = mkdtempSync(join(tmpdir(), "update-run-state-"));
  try {
    const seedstackDir = join(dir, "stack");
    const repo = dir;
    writeFileSync(join(dir, "noop"), "");
    mkdirSync(seedstackDir, { recursive: true });
    const dispatch = run({
      repo,
      seedstackDir,
      state: "dispatching",
      seed: "S1",
      candidates: ["S1", "S2"],
      decision: "dispatch S1",
      rationale: "priority tie-breaker",
      events: [{ type: "select", text: "picked S1" }],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(dispatch.ok, "dispatching write failed");
    const written = readState(runStatePath(seedstackDir));
    assert(written.state === "dispatching", "dispatching state not written");
    assert(written.in_flight_seed_id === "S1", "dispatching in-flight missing");
    assert(existsSync(join(seedstackDir, "run.md")), "run.md not written");

    const doneFail = run({
      repo,
      seedstackDir,
      state: "done",
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(!doneFail.ok, "done without reason must fail");
    assert((doneFail.summary.validation_errors as string[]).length === 1, "done validation missing");

    const dryDir = join(dir, "dry");
    mkdirSync(dryDir, { recursive: true });
    const dryRun = run({
      repo,
      seedstackDir: dryDir,
      state: "idle",
      candidates: [],
      events: [],
      pretty,
      dryRun: true,
      selfTest: true,
    });
    assert(dryRun.ok, "dry-run failed");
    assert(!existsSync(join(dryDir, "run-state.json")), "dry-run wrote state");

    const worktreeMetadata = {
      original_repo_input: "relative-linked",
      original_repo_path: join(dir, "relative-linked"),
      repo: join(dir, "linked"),
      git_common_dir: join(dir, "repo", ".git"),
      git_dir: join(dir, "repo", ".git", "worktrees", "linked"),
      worktree_root: join(dir, "linked"),
      branch: "feature",
      head: "1234567890abcdef",
      linked: true,
      policy: "linked-ok",
      require_worktree: true,
    };
    const worktreeMetadataPath = join(dir, "worktree-metadata.json");
    writeFileSync(worktreeMetadataPath, JSON.stringify(worktreeMetadata));
    const worktreeRun = run({
      repo: worktreeMetadata.repo,
      originalRepo: "relative-linked",
      worktreePolicy: "linked-ok",
      worktreeMetadataFile: worktreeMetadataPath,
      seedstackDir,
      state: "idle",
      decision: "refresh",
      rationale: "worktree metadata round trip",
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(worktreeRun.ok, "worktree metadata run failed");
    const worktreeState = readState(runStatePath(seedstackDir));
    assert(worktreeState.repo === worktreeMetadata.repo, "normalized repo not recorded");
    assert(worktreeState.original_repo === "relative-linked", "original repo argument not recorded");
    assert(worktreeState.worktree_policy === "linked-ok", "worktree policy not recorded");
    assert((worktreeState.worktree as JsonObject).linked === true, "linked worktree metadata not recorded");
    const worktreeRunMd = readFileSync(join(seedstackDir, "run.md"), "utf8");
    assert(worktreeRunMd.includes("- original_repo: relative-linked"), "run.md missing original repo");
    assert(worktreeRunMd.includes("- worktree_policy: linked-ok"), "run.md missing worktree policy");
    assert(worktreeRunMd.includes("- worktree: linked feature 1234567890ab"), "run.md missing compact worktree metadata");

    const dirtyPath = join(dir, "dirty.json");
    writeFileSync(
      dirtyPath,
      JSON.stringify({
        paths: [
          { path: "src/a.ts", classification: "expected_seed", reason: "seed-owned", status: " M" },
          { path: "src/b.ts", classification: "unexpected", reason: "no match", status: "??" },
        ],
        unexpected_paths: ["src/b.ts"],
        summary: { total: 2 },
      }),
    );
    const dirty = run({
      repo,
      seedstackDir,
      state: "blocked",
      blockedReason: "unexpected dirty",
      dirtyResult: dirtyPath,
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(dirty.ok, "dirty normalization run failed");
    const dirtyState = readState(runStatePath(seedstackDir)).dirty_state as JsonObject;
    assert(dirtyState.git_status === "dirty_unexpected", "dirty status not normalized");

    const boundaryPath = join(dir, "boundary.json");
    writeFileSync(
      boundaryPath,
      JSON.stringify({
        contract: "seedstack_boundary_health.v1",
        ok: true,
        decision: "warn",
        summary: { warnings: 1, blockers: 0 },
        findings: [{ severity: "warning", code: "BOUNDARY_OVER_TARGET", seed_ref: "N1", action: "review" }],
      }),
    );
    const boundary = run({
      repo,
      seedstackDir,
      state: "idle",
      decision: "continue",
      rationale: "boundary advisory recorded",
      boundaryHealthFile: boundaryPath,
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(boundary.ok, "boundary health run failed");
    const boundaryWritten = readState(runStatePath(seedstackDir));
    const boundaryState = boundaryWritten.boundary_health as JsonObject;
    assert(boundaryState.decision === "warn", "boundary health not summarized");
    assert(Array.isArray(boundaryState.findings), "boundary findings not summarized");
    assert(boundaryWritten.blocked_reason === undefined, "idle did not clear stale blocked_reason");
    assert(boundaryWritten.stop_reason === undefined, "idle did not clear stale stop_reason");

    const terminalDir = join(dir, "terminal");
    mkdirSync(terminalDir, { recursive: true });
    writeFileSync(
      join(terminalDir, "run-state.json"),
      JSON.stringify({
        state: "blocked",
        blocked_reason: "old block",
        stop_reason: "old stop",
        done_reason: "old done",
        stop_condition: "old condition",
        next_command: "old command",
        user_decision: "old decision",
      }),
    );
    const terminalDone = run({
      repo,
      seedstackDir: terminalDir,
      state: "done",
      doneReason: "all closed",
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(terminalDone.ok, "terminal done cleanup run failed");
    const doneState = readState(join(terminalDir, "run-state.json"));
    assert(doneState.done_reason === "all closed", "done reason not recorded");
    assert(doneState.blocked_reason === undefined, "done did not clear stale blocked_reason");
    assert(doneState.stop_reason === undefined, "done did not clear stale stop_reason");
    assert(doneState.stop_condition === undefined, "done did not clear stale stop_condition");

    writeFileSync(
      join(terminalDir, "run-state.json"),
      JSON.stringify({
        state: "blocked",
        blocked_reason: "old block",
        stop_reason: "old stop",
        done_reason: "old done",
      }),
    );
    const terminalExhausted = run({
      repo,
      seedstackDir: terminalDir,
      state: "exhausted",
      stopReason: "skipped remaining seeds",
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(terminalExhausted.ok, "terminal exhausted cleanup run failed");
    const exhaustedState = readState(join(terminalDir, "run-state.json"));
    assert(exhaustedState.stop_reason === "skipped remaining seeds", "exhausted stop reason not recorded");
    assert(exhaustedState.blocked_reason === undefined, "exhausted did not clear stale blocked_reason");
    assert(exhaustedState.done_reason === undefined, "exhausted did not clear stale done_reason");

    const preserveCandidates = run({
      repo,
      seedstackDir,
      state: "idle",
      rationale: "waiting",
      candidates: [],
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(preserveCandidates.ok, "candidate preservation run failed");
    const preservedSelection = readState(runStatePath(seedstackDir)).selection as JsonObject;
    assert(
      Array.isArray(preservedSelection.candidates) && preservedSelection.candidates.join(",") === "S1,S2",
      "candidates not preserved without explicit input",
    );

    const staleDir = join(dir, "stale");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(
      join(staleDir, "run-state.json"),
      JSON.stringify({
        latest_dispatch: {
          seed_id: "OLD",
          dispatch_artifact_root: "tmp/dispatch-work/OLD",
          gate: "stale",
          terminal_event: "stale",
          dispatcher_report: "stale",
          manage_reconciliation: "stale",
          commit: "abc",
          status: "done",
        },
      }),
    );
    const fresh = run({
      repo,
      seedstackDir: staleDir,
      state: "dispatching",
      seed: "NEW",
      candidates: [],
      decision: "dispatch NEW",
      rationale: "fresh seed",
      events: [],
      pretty,
      dryRun: false,
      selfTest: true,
    });
    assert(fresh.ok, "stale dispatch replacement run failed");
    const latestFresh = readState(join(staleDir, "run-state.json")).latest_dispatch as JsonObject;
    assert(latestFresh.seed_id === "NEW", "latest_dispatch work not replaced");
    assert(latestFresh.dispatch_artifact_root === "tmp/dispatch-work/NEW", "latest dispatch root not reset");
    assert(!("gate" in latestFresh), "stale gate retained for new seed");
    assert(!("status" in latestFresh), "stale status retained for new seed");

    const objectMarkdown = renderRunMarkdown({
      state: "managing",
      updated_at: "now",
      latest_dispatch: { seed_id: "S", gate: { ok: true }, dispatcher_report: ["a", { b: 2 }] },
      selection: { candidates: ["S"], rationale: { why: "object" } },
      stop_condition: { kind: "manual" },
      next_command: ["bun", "test"],
      user_decision: { action: "continue" },
    });
    assert(!objectMarkdown.includes("[object Object]"), "run.md rendered [object Object]");
    assert(objectMarkdown.includes('{"ok":true}'), "object display not JSON");

    const rollbackDir = join(dir, "rollback");
    mkdirSync(join(rollbackDir, "run.md"), { recursive: true });
    writeFileSync(join(rollbackDir, "run-state.json"), JSON.stringify({ state: "idle", marker: "original" }));
    let rollbackFailed = false;
    try {
      writePairAtomic(join(rollbackDir, "run-state.json"), '{"state":"dispatching"}\n', join(rollbackDir, "run.md"), "new");
    } catch {
      rollbackFailed = true;
    }
    assert(rollbackFailed, "pair write should fail when run.md target is directory");
    const rollbackState = readState(join(rollbackDir, "run-state.json"));
    assert(rollbackState.marker === "original", "state write not rolled back after pair failure");

    printJson(
      {
        contract: "update_run_state_self_test.v1",
        ok: true,
        cases: [
          "dispatching write",
          "done validation failure",
          "dry-run no write",
          "worktree metadata round trip",
          "dirty normalization",
          "boundary health summary",
          "candidate preservation",
          "stale latest_dispatch replacement",
          "object display",
          "pair write rollback",
        ],
      },
      pretty,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    selfTest(options.pretty);
    process.exit(0);
  }
  const result = run(options);
  printJson(result, options.pretty);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  printJson(
    {
      contract: "update_run_state.v1",
      ok: false,
      state_path: null,
      run_path: null,
      state: null,
      warnings: [],
      writes: [],
      summary: { error: error instanceof Error ? error.message : String(error) },
    },
    process.argv.includes("--pretty"),
  );
  process.exit(2);
}
