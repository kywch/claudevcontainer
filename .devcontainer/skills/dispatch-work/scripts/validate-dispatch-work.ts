#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { runSelfTest } from "./validate-dispatch-work-self-test.ts";
import {
  isReportFile,
  parseReport,
  RECOMMENDATIONS,
  REQUIRED_ROLES,
  validateExecuteCompatibility,
  validateReport,
  validateRequiredRoleReports,
} from "./validate-dispatch-work-reports.ts";
import type { ReportRecord } from "./validate-dispatch-work-reports.ts";
import { validatePromptContract } from "./validate-dispatch-work-prompts.ts";
import { BASENAMES } from "./dispatch-work-paths.ts";
import {
  LAUNCH_EVIDENCE_CONTRACT,
  LAUNCH_EVIDENCE_PATH_FIELDS,
  LAUNCH_EVIDENCE_VALUE_FIELDS,
  LAUNCHERS,
  STATUS_CONTRACT,
  STATUS_REQUIRED_FIELDS,
  STATUS_TERMINAL_FIELDS,
  isLocalDoneDecision,
} from "./dispatch-work-contracts.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readDirtyStatusText } from "../../seedstack/scripts/snapshot-dirty-state.ts";

export type { ReportRecord, ReportRole } from "./validate-dispatch-work-reports.ts";

type Level = "blocker" | "warning";
type ValidationPolicy = "strict" | "loop";

type Finding = {
  code: string;
  message: string;
  path?: string;
};

type Args = {
  repo: string;
  seed?: string;
  dispatchRoot: string;
  round?: number;
  roundPath?: string;
  gate?: string | "none";
  pretty: boolean;
  help: boolean;
  selfTest: boolean;
  checkHashes: boolean;
  allowRunning: boolean;
  allowNonlatest: boolean;
  validationPolicy: ValidationPolicy;
  queueMutationContext: "dispatch" | "manager";
  dirtyStatusFile?: string;
};

type StatusRecord = {
  path: string;
  data: Record<string, unknown>;
  role?: string;
  state?: string;
  reportPath?: string;
  logPath?: string;
  clean: boolean;
  hardClean: boolean;
};

type LaunchEvidence = Record<string, unknown>;

type GateAcceptedRow = {
  path?: string;
  outcome?: string;
  source: string;
};

type GateRecord = {
  path: string;
  decision?: string;
  acceptedPaths: string[];
  acceptedRows: GateAcceptedRow[];
};

type DirtyGuardRecord = {
  contract: "dirty_guard.v1";
  baseline_paths: string[];
  actual_impl_paths: string[];
  queue_paths: string[];
  unexpected_paths: string[];
  snapshot_path: string;
};

type ArtifactLocation = {
  resolved: string;
  repoPath: string;
};

type Summary = {
  repo: string;
  seed: string;
  dispatchPath: string;
  latestRound?: number;
  selectedRound?: number;
  roundPath: string;
  gatePath?: string;
  statuses: { checked: number; clean: number; dirty: number; hard_dirty?: number; soft_dirty?: number };
  artifactIndexes: { checked: number; rows: number };
  reports: { checked: number; execute: number; implement: number; review: number; verify: number };
  gate?: { present: boolean; decision?: string; acceptedPaths: number };
};

type ValidationResult = {
  contract: typeof VERSION;
  ok: boolean;
  blockers: Finding[];
  hard_blockers?: Finding[];
  soft_blockers?: Finding[];
  warnings: Finding[];
  summary: Summary;
};

const VERSION = "dispatch-work-validation.v1";
const TERMINAL_STATES = new Set([
  "completed",
  "failed_exit",
  "failed_signal",
  "failed_timeout",
  "infra_failed",
  "unknown_terminal_state",
]);
const ACTIVE_STATES = new Set(["starting", "running"]);
const STATUS_STATES = new Set([...TERMINAL_STATES, ...ACTIVE_STATES]);
const INVALID_BARE = new Set(["0", "pass", "risk", "block", "verdict"]);
const HELP = `validate-dispatch-work.ts ${VERSION}

Validate one dispatch-work round artifact set.

Usage:
  bun skills/dispatch-work/scripts/validate-dispatch-work.ts --work-order <id> [args]
  bun skills/dispatch-work/scripts/validate-dispatch-work.ts --round-path tmp/dispatch-work/<id>/round-N [args]

Args:
  --repo <path>             Repo root. Default: cwd.
  --work-order <id>         Work order id under tmp/dispatch-work.
  --seed <id>               Back-compat alias for --work-order.
  --dispatch-root <path>    Dispatch-work root. Default: tmp/dispatch-work.
  --round <N>               Round number. Default: latest round-N.
  --round-path <path>       Explicit round path; infers work order/round when possible.
  --gate <path|none>        Gate file. Default: tmp/dispatch-work/<id>/gate.md if present.
  --no-hash                 Accepted for old callers; v2 performs no artifact hash checks.
  --allow-running           Do not block on starting/running status states.
  --allow-nonlatest         Permit validating a non-latest round.
  --validation-policy <p>   strict|loop. Default: strict.
  --queue-mutation-context <dispatch|manager>
                            Queue dirty owner context. Default: dispatch.
  --dirty-status-file <p>   Read dirty guard status from raw porcelain or dirty_state_snapshot.v1.
  --dirty-snapshot <p>      Alias for --dirty-status-file.
  --pretty                  Pretty-print JSON.
  --self-test               Run built-in fixture tests.
  --help                    Show this help.

Output JSON:
  { "ok": boolean, "blockers": [], "warnings": [], "summary": {} }
`;

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    repo: process.cwd(),
    dispatchRoot: "tmp/dispatch-work",
    pretty: false,
    help: false,
    selfTest: false,
    checkHashes: false,
    allowRunning: false,
    allowNonlatest: false,
    validationPolicy: "strict",
    queueMutationContext: "dispatch",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires value`);
      i += 1;
      return value;
    };

    switch (arg) {
      case "--repo":
        args.repo = next();
        break;
      case "--work-order":
      case "--seed":
        args.seed = next();
        break;
      case "--dispatch-root":
        args.dispatchRoot = next();
        break;
      case "--round":
        args.round = parsePositiveInt(next(), "--round");
        break;
      case "--round-path":
        args.roundPath = next();
        break;
      case "--gate":
        args.gate = next();
        break;
      case "--no-hash":
        args.checkHashes = false;
        break;
      case "--allow-running":
        args.allowRunning = true;
        break;
      case "--allow-nonlatest":
        args.allowNonlatest = true;
        break;
      case "--validation-policy": {
        const policy = next();
        if (policy !== "strict" && policy !== "loop") throw new Error("--validation-policy must be strict or loop");
        args.validationPolicy = policy;
        break;
      }
      case "--queue-mutation-context": {
        const context = next();
        if (context !== "dispatch" && context !== "manager") throw new Error("--queue-mutation-context must be dispatch or manager");
        args.queueMutationContext = context;
        break;
      }
      case "--dirty-status-file":
      case "--dirty-snapshot":
        args.dirtyStatusFile = next();
        break;
      case "--pretty":
        args.pretty = true;
        break;
      case "--self-test":
        args.selfTest = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (arg.startsWith("--validation-policy=")) {
          const policy = arg.slice("--validation-policy=".length);
          if (policy !== "strict" && policy !== "loop") throw new Error("--validation-policy must be strict or loop");
          args.validationPolicy = policy;
          break;
        }
        if (arg.startsWith("--dirty-status-file=")) {
          args.dirtyStatusFile = arg.slice("--dirty-status-file=".length);
          break;
        }
        if (arg.startsWith("--queue-mutation-context=")) {
          const context = arg.slice("--queue-mutation-context=".length);
          if (context !== "dispatch" && context !== "manager") throw new Error("--queue-mutation-context must be dispatch or manager");
          args.queueMutationContext = context;
          break;
        }
        if (arg.startsWith("--dirty-snapshot=")) {
          args.dirtyStatusFile = arg.slice("--dirty-snapshot=".length);
          break;
        }
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  return args;
}

function parsePositiveInt(value: string, label: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive integer`);
  return Number(value);
}

function normalizeArgs(args: Args): Args {
  const repo = resolve(args.repo);
  let seed = args.seed;
  let round = args.round;
  let roundPath = args.roundPath ? resolve(repo, args.roundPath) : undefined;
  let dispatchRoot = resolve(repo, args.dispatchRoot);

  if (roundPath) {
    const base = roundPath.split(sep).pop() ?? "";
    const match = /^round-(\d+)$/.exec(base);
    if (match && !round) round = Number(match[1]);
    if (!seed) seed = roundPath.split(sep).at(-2);
    if (seed) dispatchRoot = dirname(dirname(roundPath));
  }

  return {
    ...args,
    repo,
    seed,
    round,
    roundPath,
    dispatchRoot,
    gate: args.gate && args.gate !== "none" ? resolve(repo, args.gate) : args.gate,
    dirtyStatusFile: args.dirtyStatusFile ? resolve(repo, args.dirtyStatusFile) : undefined,
  };
}

export function validateDispatch(inputArgs: Args): ValidationResult {
  const args = normalizeArgs(inputArgs);
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const add = (level: Level, code: string, message: string, path?: string) => {
    const target = level === "blocker" ? blockers : warnings;
    target.push({ code, message, ...(path ? { path: toRepoPath(args.repo, path) } : {}) });
  };

  const seed = args.seed ?? "";
  const dispatchPath = seed ? (args.roundPath ? dirname(args.roundPath) : join(args.dispatchRoot, seed)) : "";
  let latestRound: number | undefined;
  let selectedRound = args.round;
  let roundPath = args.roundPath ?? "";

  if (!seed) add("blocker", "missing_work_order", "--work-order required unless --round-path infers work order id");
  if (!existsSync(args.repo)) add("blocker", "missing_repo", "repo path missing", args.repo);
  if (seed && !existsSync(dispatchPath)) add("blocker", "missing_dispatch_work_dir", `dispatch-work dir missing for ${seed}`, dispatchPath);

  if (existsSync(dispatchPath)) {
    const rounds = listRoundDirs(dispatchPath);
    latestRound = rounds.at(-1)?.round;
    if (!roundPath) {
      if (!selectedRound) selectedRound = latestRound;
      if (selectedRound) roundPath = join(dispatchPath, `round-${selectedRound}`);
    }
    if (!latestRound) add("blocker", "missing_round", "no round-N dirs found", dispatchPath);
    if (selectedRound && latestRound && selectedRound !== latestRound && !args.allowNonlatest) {
      add("blocker", "nonlatest_round", `selected round-${selectedRound} is not latest round-${latestRound}`, roundPath);
    }
  }

  if (!roundPath) add("blocker", "missing_round_path", "round path unresolved");
  if (roundPath && !existsSync(roundPath)) add("blocker", "missing_round_path", "round path missing", roundPath);

  const summary: Summary = {
    repo: args.repo,
    seed,
    dispatchPath,
    latestRound,
    selectedRound,
    roundPath,
    statuses: { checked: 0, clean: 0, dirty: 0 },
    artifactIndexes: { checked: 0, rows: 0 },
    reports: { checked: 0, execute: 0, implement: 0, review: 0, verify: 0 },
  };

  if (!roundPath || !existsSync(roundPath)) {
    return finish(blockers, warnings, summary, args.validationPolicy);
  }

  const effectiveArgs = { ...args, round: selectedRound };
  const files = walkFiles(roundPath).sort();
  const statusFiles = files.filter((file) => isStatusFile(file) && isLikelyStatusArtifact(file));
  const reportFiles = files.filter(isReportFile);

  if (statusFiles.length === 0) add("blocker", "missing_status_files", "no status artifacts found", roundPath);
  if (!files.some((file) => file.endsWith(`${sep}${BASENAMES.executorReport}`))) {
    add("blocker", "missing_execute_report", "executor-report.md missing", roundPath);
  }
  validateTypedRootScope(args, seed, dispatchPath, roundPath, files, add);

  summary.artifactIndexes.checked = files.filter(isIndexFile).length;
  summary.artifactIndexes.rows = 0;

  const statuses = statusFiles.map((file) => validateStatus(effectiveArgs, file, add));
  summary.statuses.checked = statuses.length;
  summary.statuses.clean = statuses.filter((status) => status.clean).length;
  summary.statuses.dirty = statuses.length - summary.statuses.clean;

  const reports = reportFiles.flatMap((file) => {
    const report = parseReport(file);
    if (!report) return [];
    validateReport(report, add);
    return [report];
  });
  summary.reports.checked = reports.length;
  summary.reports.execute = reports.filter((report) => report.role === "execute").length;
  summary.reports.implement = reports.filter((report) => report.role === "implement").length;
  summary.reports.review = reports.filter((report) => report.role === "review").length;
  summary.reports.verify = reports.filter((report) => report.role === "verify").length;

  validateRequiredRoleReports(reports, add, roundPath);
  validateRoleArtifacts(effectiveArgs, statuses, reports, add, roundPath);
  validateExecuteCompatibility(reports, add);

  const gate = loadGate(effectiveArgs, seed, dispatchPath);
  if (gate) {
    summary.gatePath = gate.path;
    summary.gate = { present: true, decision: gate.decision, acceptedPaths: gate.acceptedPaths.length };
    validateGate(effectiveArgs, gate, reports, statuses, add);
  } else {
    summary.gate = { present: false, acceptedPaths: 0 };
    if (args.gate !== "none") add("blocker", "missing_gate", "gate.md missing; pass --gate none for pre-gate artifact-only validation", dispatchPath);
  }

  return finish(blockers, warnings, summary, args.validationPolicy);
}

const LOOP_SOFT_BLOCKERS = new Set([
  "prompt_missing_child_contract",
  "prompt_missing_seed_mutation_rule",
  "prompt_missing_command_wrapper_rule",
  "prompt_missing_report_path",
  "prompt_missing_launch_evidence_path",
  "prompt_missing_launch_provenance",
  "prompt_missing_launch_provenance_attr",
  "prompt_missing_io_path",
  "prompt_missing_io_policy",
  "prompt_missing_io_policy_attr",
  "prompt_missing_preserve_dirty_paths",
  "prompt_preserve_dirty_paths_missing_attr",
  "prompt_child_contract_missing_dirty_baseline",
  "gate_dirty_guard_missing_actual_paths",
  "gate_dirty_guard_snapshot_mismatch",
  "missing_launch_evidence_path",
  "missing_launch_evidence_owner",
  "invalid_liveness_handle",
  "self_attested_liveness_handle",
  "launcher_liveness_mismatch",
  "stale_linked_report",
  "gate_done_dirty_child",
  "missing_status_parent_launch_id",
  "missing_status_launch_evidence_path",
  "missing_report_summary",
  "missing_report_summary_key",
  "invalid_report_summary_order",
  "invalid_report_summary_value",
]);

function isLoopSoftBlocker(finding: Finding): boolean {
  return LOOP_SOFT_BLOCKERS.has(finding.code);
}

function statusCleanForPolicy(args: Args, status: StatusRecord): boolean {
  return args.validationPolicy === "loop" ? status.hardClean : status.clean;
}

function finish(blockers: Finding[], warnings: Finding[], summary: Summary, policy: ValidationPolicy): ValidationResult {
  blockers.sort(compareFindings);
  warnings.sort(compareFindings);
  if (policy === "strict") {
    summary.statuses.hard_dirty = summary.statuses.dirty;
    summary.statuses.soft_dirty = 0;
    return { contract: VERSION, ok: blockers.length === 0, blockers, hard_blockers: blockers, soft_blockers: [], warnings, summary };
  }
  const hardBlockers = blockers.filter((finding) => !isLoopSoftBlocker(finding)).sort(compareFindings);
  const softBlockers = blockers.filter(isLoopSoftBlocker).sort(compareFindings);
  const hardStatusPaths = new Set(
    hardBlockers
      .map((finding) => finding.path)
      .filter((path): path is string => !!path && /(?:\.status|status\.json|status\.md)$/.test(path)),
  );
  summary.statuses.hard_dirty = hardStatusPaths.size;
  summary.statuses.soft_dirty = softBlockers.length > 0 ? Math.max(0, summary.statuses.dirty - (summary.statuses.hard_dirty ?? 0)) : 0;
  return {
    contract: VERSION,
    ok: hardBlockers.length === 0,
    blockers: hardBlockers,
    hard_blockers: hardBlockers,
    soft_blockers: softBlockers,
    warnings,
    summary,
  };
}

function compareFindings(left: Finding, right: Finding): number {
  return `${left.code}\0${left.path ?? ""}\0${left.message}`.localeCompare(`${right.code}\0${right.path ?? ""}\0${right.message}`);
}

function listRoundDirs(dispatchPath: string): Array<{ round: number; path: string }> {
  return readdirSync(dispatchPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const match = /^round-(\d+)$/.exec(entry.name);
      return match ? [{ round: Number(match[1]), path: join(dispatchPath, entry.name) }] : [];
    })
    .sort((left, right) => left.round - right.round);
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function isStatusFile(file: string): boolean {
  const base = file.split(sep).pop() ?? "";
  return base.endsWith(".status") || base === "status.md" || base === "status.json";
}

function isLikelyStatusArtifact(file: string): boolean {
  const base = file.split(sep).pop() ?? "";
  if (base.endsWith(".status")) return true;
  const raw = readFileSync(file, "utf8");
  return (
    /child_run_status\.v2/.test(raw) ||
    isBareInvalidStatus(raw) ||
    (/^\s*(contract|role|state)\s*[:=]/im.test(raw) && /^\s*(log_path|report_path)\s*[:=]/im.test(raw))
  );
}

function isIndexFile(file: string): boolean {
  const base = file.split(sep).pop() ?? "";
  return /(^|-)artifact-index\.(md|json)$/.test(base) || base === "artifact-index.md" || base === "artifact-index.json";
}

function validateTypedRootScope(
  args: Args,
  seed: string,
  dispatchPath: string,
  roundPath: string,
  roundFiles: string[],
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  const areas = seed ? seedAreas(args.repo, seed) : [];
  const topLevelDispatchFiles = existsSync(dispatchPath)
    ? readdirSync(dispatchPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|txt)$/.test(entry.name))
      .map((entry) => join(dispatchPath, entry.name))
    : [];
  const files = [
    join(dispatchPath, BASENAMES.packet),
    join(dispatchPath, BASENAMES.gate),
    ...topLevelDispatchFiles,
    ...roundFiles.filter((file) => /\.(md|txt)$/.test(file) && /(prompt|report|verify|review|executor)/.test(file)),
  ].filter((file, index, all) => existsSync(file) && all.indexOf(file) === index);
  for (const file of files) {
    const raw = readSmallArtifact(file, statSync(file).size);
    if (!raw) continue;
    if (areas.length === 0) continue;
    for (const root of scopedRepoEditRoots(raw)) {
      if (isDispatchArtifactRoot(args.repo, dispatchPath, root)) continue;
      if (matchesAnyScopedAreaRoot(root, areas)) continue;
      add(
        "blocker",
        "artifact_impl_root_mismatch",
        `artifact repo_edit_roots includes ${root}, but seed areas are ${areas.join(", ")}`,
        file,
      );
    }
  }
  validateActualRepoEditPaths(args, dispatchPath, files, add);
}

function isDispatchArtifactRoot(repo: string, dispatchPath: string, root: string): boolean {
  const dispatchRoot = normalizeArea(toRepoPath(repo, dispatchPath));
  const normalizedRoot = normalizeArea(root);
  return normalizedRoot === dispatchRoot || normalizedRoot.startsWith(`${dispatchRoot}/`);
}

function seedAreas(repo: string, seed: string): string[] {
  const issuesPath = join(repo, ".seeds", "issues.jsonl");
  if (!existsSync(issuesPath)) return [];
  for (const line of readFileSync(issuesPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record.id !== seed) continue;
    const description = stringValue(record.description);
    return description ? parseAreas(description) : [];
  }
  return [];
}

function parseAreas(description: string): string[] {
  const match = /^\s*area:\s*(.+?)\s*$/m.exec(description);
  if (!match) return [];
  return match[1]
    .split(/[+;,|]/)
    .map(normalizeArea)
    .filter(Boolean);
}

function normalizeArea(value: string): string {
  return value.trim().replace(/^["'`]|["'`]$/g, "").replace(/^\.?\//, "").replace(/\/+$/, "");
}

function areaAliases(area: string): string[] {
  const normalized = normalizeArea(area);
  switch (normalized) {
    case "impl/go":
      return ["impl_go/v1"];
    default:
      return [];
  }
}

function scopedRepoEditRoots(raw: string): Set<string> {
  const roots = new Set<string>();
  let hasRepoEditRoots = false;
  for (const match of raw.matchAll(/repo_edit_roots\s*=\s*["']([^"']*)["']/g)) {
    hasRepoEditRoots = true;
    for (const token of splitRootList(match[1])) addScopedRoot(roots, token);
  }
  if (!hasRepoEditRoots) {
    for (const match of raw.matchAll(/allowed_write_roots\s*=\s*["']([^"']+)["']/g)) {
      for (const token of splitRootList(match[1])) addScopedRoot(roots, token);
    }
  }
  return roots;
}

function validateActualRepoEditPaths(
  args: Args,
  dispatchPath: string,
  roundFiles: string[],
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  const actual = repoDirtyImplementationPaths(args);
  if (!actual) return;
  if (actual.length === 0) return;

  const roots = collectRepoEditRoots(args, dispatchPath, roundFiles);
  for (const path of actual) {
    if (roots.some((root) => pathMatchesRoot(path, root))) continue;
    const rootList = roots.length > 0 ? roots.join(", ") : "<none>";
    add("blocker", "repo_edit_path_outside_roots", `changed repo path ${path} is outside repo_edit_roots ${rootList}`, dispatchPath);
  }
}

function collectRepoEditRoots(args: Args, dispatchPath: string, roundFiles: string[]): string[] {
  const roots = new Set<string>();
  const topLevelDispatchFiles = existsSync(dispatchPath)
    ? readdirSync(dispatchPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|txt)$/.test(entry.name))
      .map((entry) => join(dispatchPath, entry.name))
    : [];
  const files = [
    join(dispatchPath, BASENAMES.packet),
    join(dispatchPath, BASENAMES.gate),
    ...topLevelDispatchFiles,
    ...roundFiles.filter((file) => /\.(md|txt)$/.test(file) && /(prompt|report|verify|review|executor)/.test(file)),
  ].filter((file, index, all) => existsSync(file) && all.indexOf(file) === index);
  for (const file of files) {
    const raw = readSmallArtifact(file, statSync(file).size);
    for (const root of scopedRepoEditRoots(raw)) {
      if (isDispatchArtifactRoot(args.repo, dispatchPath, root)) continue;
      roots.add(root);
    }
  }
  return [...roots].sort();
}

function splitRootList(value: string): string[] {
  return value.split(/[;,\s]+/).map((token) => token.trim()).filter(Boolean);
}

function addScopedRoot(roots: Set<string>, value: string) {
  const normalized = normalizeArea(value.replace(/\/\*\*$/, "").replace(/:\d+(:\d+)?$/, ""));
  if (/\s/.test(normalized)) return;
  if (!normalized.includes("/")) return;
  if (!normalized || isNonImplementationRoot(normalized)) return;
  if (/^(repo|root|cwd|none)$/i.test(normalized)) return;
  roots.add(normalized);
}

function isNonImplementationRoot(root: string): boolean {
  return (
    root.startsWith("tmp/dispatch-work") ||
    root.startsWith("tmp/seedstack") ||
    root.startsWith(".tmp/seedspec") ||
    root.startsWith(".seeds")
  );
}

function matchesAnyImplementationAreaRoot(root: string, areas: string[]): boolean {
  return areas.some((area) =>
    sameAreaRoot(root, area) ||
    sameAreaRoot(area, root) ||
    areaAliases(area).some((alias) => sameAreaRoot(root, alias) || sameAreaRoot(alias, root)),
  );
}

function matchesAnyScopedAreaRoot(root: string, areas: string[]): boolean {
  return areas.some((area) =>
    sameAreaRoot(root, area) ||
    areaAliases(area).some((alias) => sameAreaRoot(root, alias)),
  );
}

function sameAreaRoot(root: string, area: string): boolean {
  const normalizedRoot = normalizeArea(root);
  const normalizedArea = normalizeArea(area);
  return (
    normalizedRoot === normalizedArea ||
    normalizedRoot === `${normalizedArea}.md` ||
    normalizedRoot.startsWith(`${normalizedArea}/`)
  );
}

function pathMatchesRoot(path: string, root: string): boolean {
  const normalizedPath = normalizeArea(path);
  const normalizedRoot = normalizeArea(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function validateStatus(
  args: Args,
  file: string,
  add: (level: Level, code: string, message: string, path?: string) => void,
): StatusRecord {
  const raw = readFileSync(file, "utf8");
  let clean = true;
  let hardClean = true;

  const dirty = (code: string, message: string) => {
    clean = false;
    if (!isLoopSoftBlocker({ code, message })) hardClean = false;
    add("blocker", code, message, file);
  };

  let data: Record<string, unknown> = {};
  try {
    data = parseStatus(raw);
  } catch (error) {
    dirty("malformed_status", `status parse failed: ${(error as Error).message}`);
  }
  const state = stringValue(data.state)?.toLowerCase();
  const role = stringValue(data.role)?.toLowerCase();
  const promptPath = stringValue(data.prompt_path);
  const reportPath = stringValue(data.report_path);
  const logPath = stringValue(data.log_path);
  const launcher = stringValue(data.launcher);
  const attempt = stringValue(data.attempt);
  const liveness = stringValue(data.liveness_handle);
  const parentLaunchId = stringValue(data.parent_launch_id);
  const launchEvidencePath = stringValue(data.launch_evidence_path);
  const endedAt = stringValue(data.ended_at);

  if (raw.trim().length === 0) dirty("empty_status", "status empty");
  if (isBareInvalidStatus(raw)) dirty("bare_status", "status has invalid bare terminal content");

  const contract = stringValue(data.contract) ?? stringValue(data.version);
  if (contract !== STATUS_CONTRACT) dirty("invalid_status_contract", `status missing ${STATUS_CONTRACT} contract/version`);
  for (const key of STATUS_REQUIRED_FIELDS) {
    if (!stringValue(data[key])) {
      const code = key === "parent_launch_id" || key === "launch_evidence_path" ? `missing_status_${key}` : "missing_status_field";
      dirty(code, `status missing ${key}`);
    }
  }
  for (const key of ["started_at", "updated_at"]) {
    const value = stringValue(data[key]);
    if (value && !Number.isFinite(Date.parse(value))) dirty("invalid_status_timestamp", `status ${key} is not parseable timestamp`);
  }
  if (!state || !STATUS_STATES.has(state)) dirty("invalid_status_state", `invalid status state ${state ?? "<missing>"}`);

  const terminal = state ? TERMINAL_STATES.has(state) : false;
  if (terminal) {
    for (const key of STATUS_TERMINAL_FIELDS) {
      if (!stringValue(data[key])) dirty("missing_terminal_status_field", `terminal status missing ${key}`);
    }
    if (endedAt && !Number.isFinite(Date.parse(endedAt))) dirty("invalid_status_timestamp", "status ended_at is not parseable timestamp");
  } else if (!args.allowRunning) {
    dirty("active_status", `status state ${state ?? "<missing>"} is not terminal`);
  }

  const exitCode = stringValue(data.exit_code);
  const signal = stringValue(data.signal);
  const timeout = stringValue(data.timeout);
  if (liveness && !isValidLivenessHandle(liveness)) {
    dirty("invalid_liveness_handle", `invalid liveness handle: ${liveness}`);
  }
  if (liveness && role && isSelfAttestedHandle(role, liveness)) {
    dirty("self_attested_liveness_handle", `liveness handle looks self-attested: ${liveness}`);
  }
  if (launcher && !isValidLauncher(launcher)) {
    dirty("invalid_launcher", `invalid launcher: ${launcher}`);
  }
  if (launcher && liveness && !launcherMatchesHandle(launcher, liveness)) {
    dirty("launcher_liveness_mismatch", `launcher ${launcher} does not match liveness handle ${liveness}`);
  }
  if (attempt && !isValidAttempt(attempt)) {
    dirty("invalid_attempt", `attempt must be a positive integer, got ${attempt}`);
  }
  if (state === "completed" && exitCode && exitCode !== "0") dirty("completed_nonzero", `completed status has exit_code=${exitCode}`);
  if (state === "completed" && signal && !["none", "null", "0", "false"].includes(signal.toLowerCase())) {
    dirty("completed_signal", `completed status has signal=${signal}`);
  }
  if (timeout && !["true", "false"].includes(timeout.toLowerCase())) {
    add("warning", "non_boolean_timeout", `timeout should be true|false, got ${timeout}`, file);
  }
  if (state === "completed" && timeout && !["none", "null", "0", "false"].includes(timeout.toLowerCase())) {
    dirty("completed_timeout", `completed status has timeout=${timeout}`);
  }
  if (state && state !== "completed" && TERMINAL_STATES.has(state) && !hasFailureCapsule(dirname(file))) {
    dirty("missing_failure_capsule", `dirty terminal state ${state} requires failure-capsule.md`);
  }

  validateStatusLinkedFile(
    args,
    file,
    "prompt",
    promptPath,
    undefined,
    { promptPath, reportPath, logPath, statusPath: toRepoPath(args.repo, file), launchEvidencePath, parentLaunchId },
    add,
  );
  validateStatusLinkedFile(args, file, "report", reportPath, stringValue(data.started_at), undefined, add);
  validateStatusLinkedFile(args, file, "log", logPath, undefined, undefined, add);
  validateLaunchEvidence(
    args,
    file,
    data,
    {
      role,
      attempt,
      launcher,
      liveness,
      parentLaunchId,
      launchEvidencePath,
      promptPath,
      reportPath,
      logPath,
      statusPath: toRepoPath(args.repo, file),
    },
    dirty,
    add,
  );

  return { path: file, data, role, state, reportPath, logPath, clean, hardClean };
}

function parseStatus(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed;
  }
  const data: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*(.*?)\s*$/.exec(line);
    if (match) data[match[1]] = match[2];
  }
  return data;
}

function isBareInvalidStatus(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (INVALID_BARE.has(trimmed)) return true;
  return /^state\s*=\s*(pass|risk|block|done|failed|completed)$/i.test(trimmed);
}

function isValidLauncher(value: string): boolean {
  return LAUNCHERS.includes(value as (typeof LAUNCHERS)[number]);
}

function isValidAttempt(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric);
}

function livenessKind(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^([A-Za-z_]+):(.+)$/.exec(trimmed);
  if (!match) return undefined;
  if (match[1] === "pid" || match[1] === "pgid") return match[1];
  if (match[1] === "spawn_agent" || match[1] === "session" || match[1] === "supervisor" || match[1] === "claude_agent") return match[1];
  return undefined;
}

function hasPlaceholderSegment(value: string): boolean {
  return /(^|[:/_@.-])(simulated|fake|placeholder|todo|none|null|manual|current)($|[:/_@.-])/i.test(value);
}

function isValidLivenessHandle(value: string): boolean {
  const trimmed = value.trim();
  if (hasPlaceholderSegment(trimmed)) return false;
  const pid = /^p(?:id|gid):([1-9]\d*)$/.exec(trimmed);
  if (pid) return Number(pid[1]) > 1;
  return /^(spawn_agent|session|supervisor|claude_agent):[A-Za-z0-9._:@/-]+$/.test(trimmed);
}

function isSelfAttestedHandle(role: string, handle: string): boolean {
  const normalizedRole = role.toLowerCase();
  const value = handle.toLowerCase();
  if (value === "session:codex-current") return true;
  if (value.startsWith("spawn_agent:") && value.includes("local")) return true;
  if (value.startsWith("spawn_agent:") && value.includes(normalizedRole)) return true;
  for (const roleName of ["research", "execute", "implement", "review", "verify", "dispatcher", "supervisor"]) {
    if (value.startsWith(`spawn_agent:${roleName}`) || value.includes(`:${roleName}-`) || value.includes(`/${roleName}-`)) return true;
  }
  if (value.startsWith("claude_agent:") && value.includes("local")) return true;
  if (value.startsWith("claude_agent:") && value.includes(normalizedRole)) return true;
  for (const roleName of ["research", "execute", "implement", "review", "verify", "dispatcher", "supervisor"]) {
    if (value.startsWith(`claude_agent:${roleName}`)) return true;
  }
  return false;
}

function launcherMatchesHandle(launcher: string, handle: string): boolean {
  const kind = livenessKind(handle);
  if (!kind) return false;
  if (launcher === "spawn_agent") return kind === "spawn_agent";
  if (launcher === "supervisor") return ["supervisor", "session", "pid", "pgid"].includes(kind);
  if (launcher === "codex_cli_supervisor") return ["supervisor", "session", "pid", "pgid"].includes(kind);
  if (launcher === "claude_agent") return kind === "claude_agent";
  if (launcher === "claude_cli_supervisor") return ["supervisor", "session", "pid", "pgid"].includes(kind);
  return false;
}

function validateLaunchEvidence(
  args: Args,
  statusFile: string,
  statusData: Record<string, unknown>,
  expected: {
    role?: string;
    attempt?: string;
    launcher?: string;
    liveness?: string;
    parentLaunchId?: string;
    launchEvidencePath?: string;
    promptPath?: string;
    reportPath?: string;
    logPath?: string;
    statusPath?: string;
  },
  dirty: (code: string, message: string) => void,
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  if (!expected.launchEvidencePath) {
    dirty("missing_launch_evidence_path", "status missing launch_evidence_path for parent-owned launch provenance");
    return;
  }
  if (!expected.parentLaunchId) {
    dirty("missing_parent_launch_id", "status missing parent_launch_id for parent-owned launch provenance");
    return;
  }
  if (!validateDispatchPath(args, expected.launchEvidencePath, statusFile, add)) return;
  const normalized = normalizePath(expected.launchEvidencePath) ?? "";
  if (args.round && normalized.includes("/round-") && !normalized.includes(`/round-${args.round}/`)) {
    dirty("artifact_path_outside_selected_round", `launch evidence path outside selected round-${args.round}: ${expected.launchEvidencePath}`);
    return;
  }
  const resolved = resolveArtifactPath(args.repo, expected.launchEvidencePath);
  if (!existsSync(resolved)) {
    dirty("missing_launch_evidence", `launch evidence path missing: ${expected.launchEvidencePath}`);
    return;
  }
  const stats = statSync(resolved);
  if (stats.size === 0) {
    dirty("empty_launch_evidence", `launch evidence path empty: ${expected.launchEvidencePath}`);
    return;
  }

  let evidence: LaunchEvidence;
  try {
    evidence = JSON.parse(readSmallArtifact(resolved, stats.size)) as LaunchEvidence;
  } catch (error) {
    dirty("malformed_launch_evidence", `launch evidence JSON parse failed: ${(error as Error).message}`);
    return;
  }

  const evidenceContract = stringValue(evidence.contract) ?? stringValue(evidence.version);
  if (evidenceContract !== LAUNCH_EVIDENCE_CONTRACT) {
    dirty("invalid_launch_evidence_contract", `launch evidence has invalid contract/version ${evidenceContract ?? "<missing>"}`);
  }
  const expectedValues = {
    parent_launch_id: expected.parentLaunchId,
    role: expected.role,
    attempt: expected.attempt,
    launcher: expected.launcher,
    liveness_handle: expected.liveness,
  };
  for (const key of LAUNCH_EVIDENCE_VALUE_FIELDS) {
    compareEvidenceValue(evidence, key, expectedValues[key], statusFile, dirty);
  }
  const expectedPaths = {
    prompt_path: expected.promptPath,
    log_path: expected.logPath,
    status_path: expected.statusPath,
    report_path: expected.reportPath,
  };
  for (const key of LAUNCH_EVIDENCE_PATH_FIELDS) {
    compareEvidencePath(args.repo, evidence, key, expectedPaths[key], statusFile, dirty);
  }

  const writer =
    stringValue(evidence.status_writer) ??
    stringValue(evidence.status_owner) ??
    stringValue(evidence.owner) ??
    stringValue(evidence.written_by);
  if (!writer) {
    dirty("missing_launch_evidence_owner", "launch evidence missing parent/supervisor owner or writer field");
  } else if (!/parent|dispatcher|execute|supervisor/i.test(writer)) {
    dirty("invalid_launch_evidence_owner", `launch evidence status owner is not parent/supervisor: ${writer}`);
  }
  const evidenceStatusPath = stringValue(evidence.status_path);
  if (evidenceStatusPath && !sameArtifactPath(evidenceStatusPath, expected.statusPath ?? "")) {
    dirty("launch_evidence_status_path_mismatch", `launch evidence status_path ${evidenceStatusPath} does not match status file`);
  }

  if (statusData.launcher && !evidence.launcher) {
    dirty("missing_launch_evidence_field", "launch evidence missing launcher");
  }
}

function compareEvidenceValue(
  evidence: LaunchEvidence,
  key: string,
  expected: string | undefined,
  statusFile: string,
  dirty: (code: string, message: string) => void,
) {
  if (!expected) return;
  const actual = stringValue(evidence[key]);
  if (!actual) {
    dirty("missing_launch_evidence_field", `launch evidence missing ${key}`);
  } else if (actual !== expected) {
    dirty("launch_evidence_mismatch", `launch evidence ${key}=${actual} does not match status ${expected}`);
  }
}

function compareEvidencePath(
  repo: string,
  evidence: LaunchEvidence,
  key: string,
  expected: string | undefined,
  statusFile: string,
  dirty: (code: string, message: string) => void,
) {
  if (!expected) return;
  const actual = stringValue(evidence[key]);
  if (!actual) {
    dirty("missing_launch_evidence_field", `launch evidence missing ${key}`);
  } else if (!sameArtifactPath(normalizeRepoRelative(repo, actual), normalizeRepoRelative(repo, expected))) {
    dirty("launch_evidence_mismatch", `launch evidence ${key}=${actual} does not match status ${expected}`);
  }
}

function validateStatusLinkedFile(
  args: Args,
  statusFile: string,
  kind: string,
  linkedPath: string | undefined,
  startedAt: string | undefined,
  expectedPaths:
    | { promptPath?: string; reportPath?: string; logPath?: string; statusPath?: string; launchEvidencePath?: string; parentLaunchId?: string }
    | undefined,
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  if (!linkedPath) return;
  if (!validateDispatchPath(args, linkedPath, statusFile, add)) return;
  const normalized = normalizePath(linkedPath) ?? "";
  if (args.round && !normalized.includes(`/round-${args.round}/`)) {
    add("blocker", "artifact_path_outside_selected_round", `${kind} path outside selected round-${args.round}: ${linkedPath}`, statusFile);
    return;
  }
  const resolved = resolveArtifactPath(args.repo, linkedPath);
  if (!isUnder(resolve(args.repo), resolved)) {
    add("blocker", "artifact_path_outside_repo", `${kind} path outside repo: ${linkedPath}`, statusFile);
    return;
  }
  if (!existsSync(resolved)) {
    add("blocker", "missing_linked_artifact", `${kind} path missing: ${linkedPath}`, statusFile);
    return;
  }
  const stats = statSync(resolved);
  if (stats.size === 0) {
    add("blocker", "empty_linked_artifact", `${kind} path empty: ${linkedPath}`, statusFile);
    return;
  }
  const raw = readSmallArtifact(resolved, stats.size);
  if (isPlaceholderArtifact(raw)) {
    add("blocker", "placeholder_linked_artifact", `${kind} path contains placeholder content: ${linkedPath}`, statusFile);
  }
  if (kind === "prompt") {
    validatePromptContract(raw, linkedPath, statusFile, expectedPaths, add, sameArtifactPath);
  }
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  if (kind === "report" && Number.isFinite(startedMs) && stats.mtimeMs + 1000 < startedMs) {
    add("blocker", "stale_linked_report", `report path older than child terminal/start timestamp: ${linkedPath}`, statusFile);
  }
}

function readSmallArtifact(file: string, size: number): string {
  if (size > 1024 * 1024) return "";
  return readFileSync(file, "utf8");
}

function isPlaceholderArtifact(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return ["todo", "tbd", "placeholder", "not run"].includes(trimmed);
}

function sameArtifactPath(left: string, right: string): boolean {
  return (normalizePath(left) ?? left) === (normalizePath(right) ?? right);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function stripCell(value: string): string {
  return value.trim().replace(/^`|`$/g, "");
}

function stripOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : stripCell(value);
}

function validateRoleArtifacts(
  args: Args,
  statuses: StatusRecord[],
  reports: ReportRecord[],
  add: (level: Level, code: string, message: string, path?: string) => void,
  roundPath: string,
) {
  for (const role of REQUIRED_ROLES) {
    const roleStatuses = statuses.filter((status) => status.role === role);
    if (roleStatuses.length === 0) add("blocker", "missing_role_status", `${role} status missing`, roundPath);
    if (roleStatuses.length > 1 && role !== "verify") add("blocker", "ambiguous_role_status", `multiple ${role} statuses`, roundPath);
    if (roleStatuses.length > 0 && roleStatuses.every((status) => !statusCleanForPolicy(args, status))) {
      add("blocker", "missing_clean_role_status", `${role} has no clean status`, roundPath);
    }
    const roleReports = reports.filter((report) => report.role === role);
    const referencedReports = new Set<string>();
    for (const status of roleStatuses) {
      if (!status.reportPath) continue;
      const statusReport = normalizeRepoRelative(args.repo, status.reportPath);
      referencedReports.add(statusReport);
      const matching = roleReports.some((report) => toRepoPath(args.repo, report.path) === statusReport);
      if (!matching) add("blocker", "status_report_role_mismatch", `${role} status report_path does not point at ${role} report`, status.path);
    }
    for (const report of roleReports) {
      const reportPath = toRepoPath(args.repo, report.path);
      if (!referencedReports.has(reportPath)) {
        add("blocker", "report_without_clean_status", `${role} report is not referenced by ${role} status`, report.path);
      }
    }
  }
}

function loadGate(args: Args, seed: string, dispatchPath: string): GateRecord | undefined {
  if (args.gate === "none") return undefined;
  const gatePath = args.gate ?? (seed ? join(dispatchPath, BASENAMES.gate) : undefined);
  if (!gatePath || !existsSync(gatePath)) return undefined;
  const raw = readFileSync(gatePath, "utf8");
  const decision = /^\s*-?\s*decision\s*:\s*([A-Za-z_-]+)\s*$/im.exec(raw)?.[1]?.toLowerCase();
  const acceptedRows = parseGateAcceptedRows(raw);
  const acceptedPaths = acceptedRows.flatMap((row) => (row.path ? [row.path] : []));
  return { path: gatePath, decision, acceptedPaths, acceptedRows };
}

function parseGateAcceptedRows(raw: string): GateAcceptedRow[] {
  const lines = raw.split(/\r?\n/);
  const rows: GateAcceptedRow[] = [];

  let inEvidenceSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = markdownHeadingTitle(lines[i]);
    if (heading !== undefined) {
      inEvidenceSection = /\bevidence\b/i.test(heading) && !/\bnon[-\s]?evidence\b/i.test(heading);
      continue;
    }
    if (!inEvidenceSection || !isMarkdownTableRow(lines[i])) continue;

    const headers = splitTableRow(lines[i]).map(normalizeTableHeader);
    const pathHeader = gateEvidencePathHeader(headers);
    if (!pathHeader) continue;
    if (i + 1 >= lines.length || !isMarkdownTableSeparator(lines[i + 1])) continue;

    let j = i + 2;
    for (; j < lines.length; j += 1) {
      if (markdownHeadingTitle(lines[j]) !== undefined || !isMarkdownTableRow(lines[j])) break;
      const cells = splitTableRow(lines[j]);
      if (cells.length < headers.length) continue;
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = cells[index];
      });
      const path = stripOptional(stringValue(row[pathHeader]));
      if (!path) continue;
      rows.push({
        path,
        outcome: stripOptional(stringValue(row.outcome) ?? stringValue(row.verdict) ?? stringValue(row.verdict_or_outcome)),
        source: "gate",
      });
    }
    i = j - 1;
  }
  return rows;
}

function normalizeTableHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "_");
}

function gateEvidencePathHeader(headers: string[]): string | undefined {
  const explicit = headers.find((header) => ["artifact_path", "evidence_path", "report_path", "log_artifact_path"].includes(header));
  if (explicit) return explicit;
  if (headers.includes("command")) return undefined;
  return headers.includes("path") ? "path" : undefined;
}

function markdownHeadingTitle(line: string): string | undefined {
  return /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
}

function isMarkdownTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function validateGate(
  args: Args,
  gate: GateRecord,
  reports: ReportRecord[],
  statuses: StatusRecord[],
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  if (!gate.decision) add("blocker", "missing_gate_decision", "gate missing decision", gate.path);
  else if (!RECOMMENDATIONS.has(gate.decision)) add("blocker", "invalid_gate_decision", `invalid gate decision ${gate.decision}`, gate.path);

  for (const row of gate.acceptedRows) {
    if (!row.path) {
      add("blocker", "gate_missing_accepted_path", "gate accepted artifact row missing path", gate.path);
      continue;
    }
    const artifactPath = row.path;
    const normalized = normalizePath(artifactPath);
    if (!validateDispatchPath(args, artifactPath, gate.path, add)) continue;
    if (normalized.includes("/round-") && !normalized.includes(`/round-${args.round ?? ""}/`) && args.round) {
      add("blocker", "gate_accepts_nonselected_round_artifact", `gate accepted path outside selected round-${args.round}: ${artifactPath}`, gate.path);
    }
    const resolved = resolveArtifactPath(args.repo, artifactPath);
    if (!existsSync(resolved)) {
      add("blocker", "gate_accepted_artifact_missing", `gate accepted artifact missing: ${artifactPath}`, gate.path);
      continue;
    }
  }

  if (!isLocalDoneDecision(gate.decision)) return;
  if (gate.acceptedPaths.length === 0) {
    add("blocker", "gate_missing_evidence_paths", "gate done requires evidence artifact paths", gate.path);
  }

  const execute = reports.find((report) => report.role === "execute");
  const implement = reports.find((report) => report.role === "implement");
  const reviews = reports.filter((report) => report.role === "review");
  const verifies = reports.filter((report) => report.role === "verify");

  if (execute?.verdict !== "pass" || !isLocalDoneDecision(execute.recommendation)) {
    add("blocker", "gate_done_execute_precondition", "gate done requires latest Execute verdict pass and recommendation done", gate.path);
  }
  if (implement?.outcome !== "done") add("blocker", "gate_done_implement_precondition", "gate done requires Implement outcome done", gate.path);
  if (reviews.length === 0 || reviews.some((report) => report.verdict !== "pass")) {
    add("blocker", "gate_done_review_precondition", "gate done requires Review verdict pass", gate.path);
  }
  if (verifies.length === 0 || verifies.some((report) => report.verdict !== "pass")) {
    add("blocker", "gate_done_verify_precondition", "gate done requires latest round Verify verdict pass", gate.path);
  }
  if (statuses.some((status) => !status.clean)) {
    add("blocker", "gate_done_dirty_child", "gate done requires clean child status validation", gate.path);
  }
  const gateText = readFileSync(gate.path, "utf8");
  if (!/dirty guard|dirty paths|known dirty/i.test(gateText)) {
    add("warning", "gate_missing_dirty_guard_text", "gate done should record dirty guard result", gate.path);
  }
  validateGateDirtyGuard(args, gate.path, gateText, add);
}

function validateGateDirtyGuard(
  args: Args,
  gatePath: string,
  gateText: string,
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  const structured = parseStructuredDirtyGuard(gateText, gatePath, add);
  if (structured) {
    validateStructuredDirtyGuard(args, gatePath, structured, add);
    return;
  }

  const queueMutations = repoDirtyQueuePaths(args);
  if (queueMutations && queueMutations.length > 0) {
    add("blocker", "gate_queue_mutation_dirty", `dispatch-work must not mutate queue state paths: ${queueMutations.join(", ")}`, gatePath);
  }

  const actual = repoDirtyImplementationPaths(args);
  if (!actual) {
    add("warning", "gate_dirty_guard_unchecked", "git status unavailable; dirty guard path match not checked", gatePath);
    return;
  }
  if (actual.length === 0) return;
  const expected = parseGateExpectedSeedPaths(gateText, args.repo);
  if (expected.length === 0) {
    add("blocker", "gate_dirty_guard_missing_actual_paths", `gate dirty guard lists no implementation paths, but git status has ${actual.join(", ")}`, gatePath);
    return;
  }
  for (const path of actual) {
    if (expected.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
    add(
      "blocker",
      "gate_dirty_guard_path_mismatch",
      `git status path ${path} is not covered by gate dirty guard paths ${expected.join(", ")}`,
      gatePath,
    );
  }
}

function parseStructuredDirtyGuard(
  gateText: string,
  gatePath: string,
  add: (level: Level, code: string, message: string, path?: string) => void,
): DirtyGuardRecord | undefined {
  const raw = structuredDirtyGuardRaw(gateText);
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = raw.trim().startsWith("{") ? JSON.parse(raw) : parseYamlLikeDirtyGuard(raw);
  } catch (error) {
    add("blocker", "gate_dirty_guard_structured_malformed", `dirty_guard.v1 parse failed: ${(error as Error).message}`, gatePath);
    return undefined;
  }
  if (!isRecord(parsed)) {
    add("blocker", "gate_dirty_guard_structured_malformed", "dirty_guard.v1 block must be object", gatePath);
    return undefined;
  }
  if (parsed.contract !== "dirty_guard.v1") {
    add("blocker", "gate_dirty_guard_structured_malformed", "dirty_guard.v1 block missing contract", gatePath);
    return undefined;
  }
  const record: Partial<DirtyGuardRecord> = { contract: "dirty_guard.v1" };
  for (const key of ["baseline_paths", "actual_impl_paths", "queue_paths", "unexpected_paths"] as const) {
    const value = parsed[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      add("blocker", "gate_dirty_guard_structured_malformed", `dirty_guard.v1 ${key} must be string array`, gatePath);
      continue;
    }
    record[key] = value.map((item) => normalizePath(item.trim()) ?? "");
  }
  if (typeof parsed.snapshot_path !== "string" || parsed.snapshot_path.trim().length === 0) {
    add("blocker", "gate_dirty_guard_structured_malformed", "dirty_guard.v1 snapshot_path must be nonempty string", gatePath);
  } else {
    record.snapshot_path = normalizePath(parsed.snapshot_path.trim()) ?? parsed.snapshot_path.trim();
  }
  return record.baseline_paths && record.actual_impl_paths && record.queue_paths && record.unexpected_paths && record.snapshot_path
    ? (record as DirtyGuardRecord)
    : undefined;
}

function structuredDirtyGuardRaw(gateText: string): string | undefined {
  const fence = /```(?:json|dirty_guard\.v1)?\s*\r?\n([\s\S]*?"contract"\s*:\s*"dirty_guard\.v1"[\s\S]*?)\r?\n```/m.exec(gateText);
  if (fence) return fence[1];
  const yaml = /(?:^|\n)dirty_guard\.v1:\s*\r?\n([\s\S]*?)(?=\n#{1,6}\s|\n```|$)/m.exec(gateText);
  if (yaml) return `contract: dirty_guard.v1\n${yaml[1]}`;
  const legacyYaml = dirtyGuardBlock(gateText);
  return /\bcontract:\s*dirty_guard\.v1\b/.test(legacyYaml) ? legacyYaml : undefined;
}

function parseYamlLikeDirtyGuard(raw: string): DirtyGuardRecord {
  const out: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const scalar = /^\s*([a-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!scalar) continue;
    const key = scalar[1];
    const value = scalar[2];
    if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = JSON.parse(value.replace(/'/g, '"'));
      continue;
    }
    if (["baseline_paths", "actual_impl_paths", "queue_paths", "unexpected_paths"].includes(key)) {
      const values: string[] = [];
      for (let j = index + 1; j < lines.length; j += 1) {
        const item = /^\s*-\s*(.*?)\s*$/.exec(lines[j]);
        if (!item) break;
        values.push(stripOptional(item[1]) ?? "");
        index = j;
      }
      out[key] = values;
    } else {
      out[key] = stripOptional(value) ?? value;
    }
  }
  return out as DirtyGuardRecord;
}

function validateStructuredDirtyGuard(
  args: Args,
  gatePath: string,
  guard: DirtyGuardRecord,
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  validateGuardPathList("baseline_paths", guard.baseline_paths, gatePath, add);
  validateGuardPathList("actual_impl_paths", guard.actual_impl_paths, gatePath, add);
  validateGuardPathList("queue_paths", guard.queue_paths, gatePath, add);
  validateGuardPathList("unexpected_paths", guard.unexpected_paths, gatePath, add);

  for (const path of guard.actual_impl_paths) {
    if (!isExpectedSeedPath(path)) {
      add("blocker", "gate_dirty_guard_invalid_impl_path", `dirty_guard.v1 actual_impl_paths contains invalid implementation path: ${path || "<blank>"}`, gatePath);
    }
  }

  const actualImpl = repoDirtyImplementationPaths(args);
  const queuePaths = repoDirtyQueuePaths(args);
  const allPaths = repoDirtyPaths(args, () => true);
  if (!actualImpl || !queuePaths || !allPaths) {
    add("warning", "gate_dirty_guard_unchecked", "git status unavailable; dirty guard path match not checked", gatePath);
    return;
  }

  comparePathSet("actual_impl_paths", guard.actual_impl_paths, actualImpl, gatePath, add);
  comparePathSet("queue_paths", guard.queue_paths, queuePaths, gatePath, add);
  comparePathSet("unexpected_paths", guard.unexpected_paths, expectedUnexpectedDirtyPaths(allPaths, guard, queuePaths, actualImpl), gatePath, add);

  if (args.dirtyStatusFile) {
    const expectedSnapshot = normalizeRepoRelative(args.repo, args.dirtyStatusFile);
    if (normalizeRepoRelative(args.repo, guard.snapshot_path) !== expectedSnapshot) {
      add(
        "blocker",
        "gate_dirty_guard_snapshot_mismatch",
        `dirty_guard.v1 snapshot_path ${guard.snapshot_path} does not match ${expectedSnapshot}`,
        gatePath,
      );
    }
  }
}

function validateGuardPathList(
  key: keyof Pick<DirtyGuardRecord, "baseline_paths" | "actual_impl_paths" | "queue_paths" | "unexpected_paths">,
  paths: string[],
  gatePath: string,
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  for (const path of paths) {
    if (isPlaceholderPath(path)) {
      add("blocker", "gate_dirty_guard_placeholder_path", `dirty_guard.v1 ${key} contains placeholder path: ${path || "<blank>"}`, gatePath);
    }
  }
}

function expectedUnexpectedDirtyPaths(allPaths: string[], guard: DirtyGuardRecord, queuePaths: string[], actualImpl: string[]): string[] {
  const known = new Set([...guard.baseline_paths, ...queuePaths, ...actualImpl]);
  return allPaths
    .filter((path) => !known.has(path))
    .filter((path) => path !== ".seeds/knowledge.jsonl")
    .filter((path) => !path.startsWith("tmp/dispatch-work/") && !path.startsWith("tmp/seedstack/"))
    .sort();
}

function comparePathSet(
  key: keyof Pick<DirtyGuardRecord, "actual_impl_paths" | "queue_paths" | "unexpected_paths">,
  actual: string[],
  expected: string[],
  gatePath: string,
  add: (level: Level, code: string, message: string, path?: string) => void,
) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (left.join("\0") === right.join("\0")) return;
  add(
    "blocker",
    "gate_dirty_guard_structured_mismatch",
    `dirty_guard.v1 ${key} ${left.join(", ") || "<none>"} does not match dirty snapshot ${right.join(", ") || "<none>"}`,
    gatePath,
  );
}

function isPlaceholderPath(path: string): boolean {
  return path.trim().length === 0 || /^(?:none|n\/a|null|undefined|todo|placeholder|path)$/i.test(path) || /[<>]/.test(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repoDirtyImplementationPaths(args: Args): string[] | undefined {
  return repoDirtyPaths(args, (path) => !path.startsWith(".seeds/") && !path.startsWith("tmp/"));
}

function repoDirtyQueuePaths(args: Args): string[] | undefined {
  return repoDirtyPaths(args, (path) => {
    if (!path.startsWith(".seeds/") || path === ".seeds/knowledge.jsonl") return false;
    if (args.queueMutationContext === "manager" && path === ".seeds/issues.jsonl") return false;
    return true;
  });
}

function repoDirtyPaths(args: Args, include: (path: string) => boolean): string[] | undefined {
  let statusText: string;
  if (args.dirtyStatusFile) {
    statusText = readDirtyStatusText(args.dirtyStatusFile);
  } else {
    const git = spawnSync("git", ["-C", args.repo, "status", "--porcelain=v1", "--untracked-files=all"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (git.status !== 0 || git.error) return undefined;
    statusText = git.stdout;
  }
  const paths = new Set<string>();
  for (const line of statusText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = line.slice(3).split(" -> ").at(-1)?.trim();
    const path = cleanStatusPath(raw, args.repo);
    if (!path || !include(path)) continue;
    paths.add(path);
  }
  return [...paths].sort();
}

function parseGateExpectedSeedPaths(text: string, repo?: string): string[] {
  const section = [
    text.match(/## Dirty Guard[\s\S]*?(?:\n## |\n# |$)/)?.[0] ?? "",
    dirtyGuardBlock(text),
  ].join("\n");
  const paths = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!bullet) continue;
    for (const match of bullet[1].matchAll(/`([^`]+)`/g)) {
      const path = cleanStatusPath(match[1]?.trim(), repo);
      if (isExpectedSeedPath(path)) paths.add(path);
    }
    for (const match of bullet[1].matchAll(/[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+/g)) {
      const path = cleanStatusPath(match[0], repo);
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

function cleanStatusPath(path: string | undefined, repo?: string): string | undefined {
  if (!path) return undefined;
  const unquoted = path.replace(/^"|"$/g, "").replace(/\\"/g, '"');
  const cleaned = unquoted.replace(/^[.]\//, "").replace(/[),.;:]+$/g, "");
  const repoName = repo?.split(/[\\/]/).filter(Boolean).at(-1);
  return repoName && cleaned.startsWith(`${repoName}/`) ? cleaned.slice(repoName.length + 1) : cleaned;
}

function isExpectedSeedPath(path: string | undefined): path is string {
  if (!path || path.startsWith(".seeds/") || path.startsWith("tmp/") || path.startsWith("/") || /\s/.test(path)) return false;
  return (
    /^(?:[A-Za-z0-9._+-]+\/)+[A-Za-z0-9._+-]+$/.test(path) ||
    /^[A-Za-z0-9._+-]+\.[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(path) ||
    /^\.[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(path)
  );
}

function hasFailureCapsule(dir: string): boolean {
  return existsSync(join(dir, BASENAMES.failureCapsule));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function normalizePath(value: string): string;
function normalizePath(value: undefined): undefined;
function normalizePath(value: string | undefined): string | undefined;
function normalizePath(value: string | undefined): string | undefined {
  return value?.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeRepoRelative(repo: string, value: string): string {
  if (isAbsolute(value)) return normalizePath(relative(repo, value)) ?? value;
  return normalizePath(value) ?? value;
}

function resolveArtifactPath(repo: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(repo, value);
}

function validateDispatchPath(
  args: Args,
  value: string,
  source: string,
  add: (level: Level, code: string, message: string, path?: string) => void,
): boolean {
  const normalized = normalizePath(value) ?? "";
  let ok = true;
  if (isAbsolute(value)) {
    add("blocker", "absolute_artifact_path", `artifact path must be repo-relative: ${value}`, source);
    ok = false;
  }
  if (normalized.split("/").includes("..")) {
    add("blocker", "artifact_path_traversal", `artifact path must not contain ..: ${value}`, source);
    ok = false;
  }
  const resolved = resolveArtifactPath(args.repo, value);
  if (!isUnder(args.repo, resolved)) {
    add("blocker", "artifact_path_outside_repo", `artifact path resolves outside repo: ${value}`, source);
    ok = false;
  }
  if (args.seed) {
    const dispatchRoot = join(args.dispatchRoot, args.seed);
    if (!isUnder(dispatchRoot, resolved)) {
      add("blocker", "artifact_path_outside_dispatch", `artifact path resolves outside tmp/dispatch-work/${args.seed}: ${value}`, source);
      ok = false;
    }
  }
  return ok;
}

function toRepoPath(repo: string, file: string): string {
  const rel = relative(repo, file);
  return normalizePath(rel) ?? file;
}

function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function writeJson(result: unknown, pretty: boolean) {
  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
}

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    writeJson({ ok: false, blockers: [{ code: "arg_error", message: String((error as Error).message) }], warnings: [], summary: {} }, false);
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.selfTest) return runSelfTest(args.pretty);

  try {
    const result = validateDispatch(args);
    writeJson(result, args.pretty);
    return result.ok ? 0 : 1;
  } catch (error) {
    writeJson(
      {
        ok: false,
        blockers: [{ code: "validator_crash", message: String((error as Error).message) }],
        warnings: [],
        summary: {},
      },
      args.pretty,
    );
    return 2;
  }
}

if (import.meta.main) process.exit(main());
