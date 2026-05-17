#!/usr/bin/env bun
// Seedstack outer loop supervisor.
//
// This script owns loop progress for run/auto mode. It keeps the LLM bounded to
// one dispatch or manage step, then enforces the outer state machine with the
// existing deterministic Seedstack checkers.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CHILD_SILENT_PROBE_MS,
  DEFAULT_CHILD_SILENT_TIMEOUT_MS,
  DEFAULT_CHILD_TOTAL_TIMEOUT_MS,
  followupCount,
  readChildResult,
  runChild,
  runChildTimeoutSelfTest,
  type ChildExit,
  type ChildResult,
  type ChildRole,
} from "./child-supervisor.ts";
import { buildDispatchPrompt, buildManagePrompt } from "./prompts.ts";
import {
  runStatePath as statePath,
  loopStatePath,
  eventsPath,
  loopDir,
  commitLedgerPath,
  dashboardPath,
  stopAfterSeedPath,
  iterationArtifactPath,
  iterationResultPath,
} from "./seedstack-paths.ts";

type JsonObject = Record<string, unknown>;
type RunStateName = "idle" | "dispatching" | "managing" | "done" | "exhausted" | "blocked" | "escalated" | "loop_cap";

type Options = {
  repo: string;
  seedstackDir?: string;
  adoptionSelection?: string;
  seedCli: string;
  mode: "auto" | "manual";
  commitPolicy: "none" | "per_seed";
  commitPolicyExplicit: boolean;
  knowledgeCapture: "off" | "audit" | "record";
  knowledgeRequired: boolean;
  codexBin: string;
  codexReasoningEffort: "low" | "medium" | "high" | "xhigh";
  runner: "codex" | "claude";
  claudeBin: string;
  claudeModel: string;
  followupCap: number;
  followupsPerManage: number;
  maxIterations: number;
  boundaryHealth: "off" | "warn" | "block";
  maxSeedTarget: number;
  hotFile: number;
  splitCandidate: number;
  pollMs: number;
  postSeedDelayMs: number;
  childTotalTimeoutMs: number;
  childSilentTimeoutMs: number;
  childSilentProbeMs: number;
  pretty: boolean;
  selfTest: boolean;
};

type EventRecord = JsonObject & {
  ts: string;
  event: string;
};

type LoopState = {
  contract: "seedstack_loop_state.v1";
  loop_iteration: number;
  scan_epoch: number;
  manage_epoch: number;
  total_followups: number;
  baseline_seed_count: number;
  skipped_seeds: Array<{ seed: string; reason: string; at: string; loop_cap?: string }>;
};

const HELP = `seedstack-loop.ts seedstack_loop.v1

Usage:
  bun skills/seedstack/scripts/seedstack-loop.ts --seedstack-dir <dir> --adoption-selection <json> [args]
  bun skills/seedstack/scripts/seedstack-loop.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root. Default: cwd.
  --seedstack-dir <path>           Stack artifact dir containing run-state.json.
  --adoption-selection <path>      Active adoption manifest.
  --seed-cli <path>                work queue CLI. Default: sd.
  --mode <auto|manual>             Default: auto.
  --commit-policy <none|per_seed>   Default: per_seed in auto, none in manual.
  --knowledge-capture <off|audit|record>
                                    Knowledge capture policy after clean close. Default: audit.
  --knowledge-required              Block when knowledge capture check fails.
  --codex-bin <path>               Codex binary for child steps. Default: codex.
  --codex-reasoning-effort <level> Codex reasoning effort for child steps.
                                    Values: low, medium, high, xhigh. Default: medium.
  --runner <codex|claude>          Child runner backend. Default: codex.
  --claude-bin <path>              Claude CLI binary. Default: claude.
  --claude-model <model>           Claude model string. Default: claude-sonnet-4-6.
  --followup-cap <n>               Total manager-created follow-up cap. Default: 5.
  --followups-per-manage <n>       Per-manage follow-up cap. Default: 2.
  --max-iterations <n>             Supervisor iteration cap. Default: 50.
  --boundary-health <off|warn|block>
                                    Boundary checker policy. Default: warn.
  --max-seed-target <n>            Boundary warning target. Default: 600.
  --hot-file <n>                   Hot-file warning target. Default: 800.
  --split-candidate <n>            Boundary blocking target. Default: 1200.
  --poll-ms <n>                    Child heartbeat interval. Default: 30000.
  --post-seed-delay-ms <n>         Delay after each seed before selecting the next. Default: 10000.
  --child-total-timeout-ms <n>     Hard child runtime cap. Default: 3600000.
  --child-silent-timeout-ms <n>    Child no-output watchdog. Default: 1200000.
  --child-silent-probe-ms <n>      Silent watchdog probe interval. Default: 600000.
  --pretty                         Pretty-print final JSON.
  --self-test                      Run lightweight self-test.
  --help                           Show this help.
`;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SEEDSTACK_DIR = dirname(SCRIPT_DIR);
const DISPATCH_SEED_DIR = resolve(SEEDSTACK_DIR, "..", "dispatch-work");
const KNOWLEDGE_STORE_SCRIPT = "/workspace/.devcontainer/skills/capture-knowledge/knowledge-store.ts";
const KNOWLEDGE_RECORD_TYPES = new Set(["convention", "pattern", "failure", "decision", "reference", "guide"]);
const KNOWLEDGE_CAPTURE_STATES = new Set(["recorded", "none_qualified", "store_missing", "skipped_user_waived"]);

function usage(exitCode: 0 | 2): never {
  (exitCode === 0 ? process.stdout : process.stderr).write(HELP);
  process.exit(exitCode);
}

function take(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

function parsePositive(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (parsed <= 0) throw new Error(`${flag} must be positive`);
  return parsed;
}

function parseNonNegative(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  return Number(value);
}

function parseReasoningEffort(value: string): Options["codexReasoningEffort"] {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new Error("--codex-reasoning-effort must be low, medium, high, or xhigh");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    seedCli: "sd",
    mode: "auto",
    commitPolicy: "none",
    commitPolicyExplicit: false,
    knowledgeCapture: "audit",
    knowledgeRequired: false,
    codexBin: "codex",
    codexReasoningEffort: "medium",
    runner: "codex",
    claudeBin: "claude",
    claudeModel: "claude-sonnet-4-6",
    followupCap: 5,
    followupsPerManage: 2,
    maxIterations: 50,
    boundaryHealth: "warn",
    maxSeedTarget: 600,
    hotFile: 800,
    splitCandidate: 1200,
    pollMs: 30000,
    postSeedDelayMs: 10000,
    childTotalTimeoutMs: DEFAULT_CHILD_TOTAL_TIMEOUT_MS,
    childSilentTimeoutMs: DEFAULT_CHILD_SILENT_TIMEOUT_MS,
    childSilentProbeMs: DEFAULT_CHILD_SILENT_PROBE_MS,
    pretty: false,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
        options.repo = take(argv, index, arg);
        index += 1;
        break;
      case "--seedstack-dir":
        options.seedstackDir = take(argv, index, arg);
        index += 1;
        break;
      case "--adoption-selection":
        options.adoptionSelection = take(argv, index, arg);
        index += 1;
        break;
      case "--seed-cli":
        options.seedCli = take(argv, index, arg);
        index += 1;
        break;
      case "--mode": {
        const mode = take(argv, index, arg);
        if (mode !== "auto" && mode !== "manual") throw new Error("--mode must be auto or manual");
        options.mode = mode;
        index += 1;
        break;
      }
      case "--commit-policy": {
        const policy = take(argv, index, arg);
        if (policy !== "none" && policy !== "per_seed") {
          throw new Error("--commit-policy must be none or per_seed");
        }
        options.commitPolicy = policy;
        options.commitPolicyExplicit = true;
        index += 1;
        break;
      }
      case "--knowledge-capture": {
        const policy = take(argv, index, arg);
        if (policy !== "off" && policy !== "audit" && policy !== "record") {
          throw new Error("--knowledge-capture must be off, audit, or record");
        }
        options.knowledgeCapture = policy;
        index += 1;
        break;
      }
      case "--knowledge-required":
        options.knowledgeRequired = true;
        break;
      case "--codex-bin":
        options.codexBin = take(argv, index, arg);
        index += 1;
        break;
      case "--codex-reasoning-effort":
        options.codexReasoningEffort = parseReasoningEffort(take(argv, index, arg));
        index += 1;
        break;
      case "--runner": {
        const r = take(argv, index, arg);
        if (r !== "codex" && r !== "claude") throw new Error("--runner must be codex or claude");
        options.runner = r;
        index += 1;
        break;
      }
      case "--claude-bin":
        options.claudeBin = take(argv, index, arg);
        index += 1;
        break;
      case "--claude-model":
        options.claudeModel = take(argv, index, arg);
        index += 1;
        break;
      case "--followup-cap":
        options.followupCap = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--followups-per-manage":
        options.followupsPerManage = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--max-iterations":
        options.maxIterations = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--boundary-health": {
        const policy = take(argv, index, arg);
        if (policy !== "off" && policy !== "warn" && policy !== "block") {
          throw new Error("--boundary-health must be off, warn, or block");
        }
        options.boundaryHealth = policy;
        index += 1;
        break;
      }
      case "--max-seed-target":
        options.maxSeedTarget = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--hot-file":
        options.hotFile = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--split-candidate":
        options.splitCandidate = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--poll-ms":
        options.pollMs = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--post-seed-delay-ms":
        options.postSeedDelayMs = parseNonNegative(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--child-total-timeout-ms":
        options.childTotalTimeoutMs = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--child-silent-timeout-ms":
        options.childSilentTimeoutMs = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--child-silent-probe-ms":
        options.childSilentProbeMs = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--seedstack-dir=")) options.seedstackDir = arg.slice("--seedstack-dir=".length);
        else if (arg.startsWith("--adoption-selection=")) options.adoptionSelection = arg.slice("--adoption-selection=".length);
        else if (arg.startsWith("--seed-cli=")) options.seedCli = arg.slice("--seed-cli=".length);
        else if (arg.startsWith("--commit-policy=")) {
          const policy = arg.slice("--commit-policy=".length);
          if (policy !== "none" && policy !== "per_seed") {
            throw new Error("--commit-policy must be none or per_seed");
          }
          options.commitPolicy = policy;
          options.commitPolicyExplicit = true;
        }
        else if (arg.startsWith("--knowledge-capture=")) {
          const policy = arg.slice("--knowledge-capture=".length);
          if (policy !== "off" && policy !== "audit" && policy !== "record") {
            throw new Error("--knowledge-capture must be off, audit, or record");
          }
          options.knowledgeCapture = policy;
        }
        else if (arg.startsWith("--codex-bin=")) options.codexBin = arg.slice("--codex-bin=".length);
        else if (arg.startsWith("--codex-reasoning-effort=")) {
          options.codexReasoningEffort = parseReasoningEffort(arg.slice("--codex-reasoning-effort=".length));
        }
        else if (arg.startsWith("--runner=")) {
          const r = arg.slice("--runner=".length);
          if (r !== "codex" && r !== "claude") throw new Error("--runner must be codex or claude");
          options.runner = r as "codex" | "claude";
        }
        else if (arg.startsWith("--claude-bin=")) options.claudeBin = arg.slice("--claude-bin=".length);
        else if (arg.startsWith("--claude-model=")) options.claudeModel = arg.slice("--claude-model=".length);
        else if (arg.startsWith("--followup-cap=")) options.followupCap = parsePositive(arg.slice("--followup-cap=".length), "--followup-cap");
        else if (arg.startsWith("--followups-per-manage=")) {
          options.followupsPerManage = parsePositive(arg.slice("--followups-per-manage=".length), "--followups-per-manage");
        } else if (arg.startsWith("--max-iterations=")) {
          options.maxIterations = parsePositive(arg.slice("--max-iterations=".length), "--max-iterations");
        } else if (arg.startsWith("--boundary-health=")) {
          const policy = arg.slice("--boundary-health=".length);
          if (policy !== "off" && policy !== "warn" && policy !== "block") {
            throw new Error("--boundary-health must be off, warn, or block");
          }
          options.boundaryHealth = policy;
        } else if (arg.startsWith("--max-seed-target=")) {
          options.maxSeedTarget = parsePositive(arg.slice("--max-seed-target=".length), "--max-seed-target");
        } else if (arg.startsWith("--hot-file=")) {
          options.hotFile = parsePositive(arg.slice("--hot-file=".length), "--hot-file");
        } else if (arg.startsWith("--split-candidate=")) {
          options.splitCandidate = parsePositive(arg.slice("--split-candidate=".length), "--split-candidate");
        } else if (arg.startsWith("--poll-ms=")) options.pollMs = parsePositive(arg.slice("--poll-ms=".length), "--poll-ms");
        else if (arg.startsWith("--post-seed-delay-ms=")) {
          options.postSeedDelayMs = parseNonNegative(arg.slice("--post-seed-delay-ms=".length), "--post-seed-delay-ms");
        }
        else if (arg.startsWith("--child-total-timeout-ms=")) {
          options.childTotalTimeoutMs = parsePositive(arg.slice("--child-total-timeout-ms=".length), "--child-total-timeout-ms");
        } else if (arg.startsWith("--child-silent-timeout-ms=")) {
          options.childSilentTimeoutMs = parsePositive(arg.slice("--child-silent-timeout-ms=".length), "--child-silent-timeout-ms");
        } else if (arg.startsWith("--child-silent-probe-ms=")) {
          options.childSilentProbeMs = parsePositive(arg.slice("--child-silent-probe-ms=".length), "--child-silent-probe-ms");
        }
        else throw new Error(`unknown argument ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  if (options.seedstackDir) options.seedstackDir = resolve(options.repo, options.seedstackDir);
  if (options.adoptionSelection) options.adoptionSelection = resolve(options.repo, options.adoptionSelection);
  if (options.mode === "auto" && !options.commitPolicyExplicit) options.commitPolicy = "per_seed";
  if (options.maxSeedTarget >= options.splitCandidate) {
    throw new Error("--max-seed-target must be lower than --split-candidate");
  }
  options.childSilentProbeMs = Math.min(options.childSilentProbeMs, options.childSilentTimeoutMs);
  return options;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function pathEntries(value: unknown): Array<{ path: string; classification: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((item) => {
    const path = stringField(item.path);
    const classification = stringField(item.classification);
    return path && classification ? [{ path, classification }] : [];
  });
}

function unexpectedPaths(result: JsonObject): string[] {
  const direct = stringArray(result.unexpected_paths);
  if (direct.length > 0) return direct;
  return pathEntries(result.paths)
    .filter((item) => item.classification === "unexpected")
    .map((item) => item.path);
}

function queueDirtyPathsFromStatus(statusText: string): string[] {
  const paths = new Set<string>();
  for (const rawLine of statusText.split(/\r?\n/)) {
    if (!rawLine || rawLine.length < 4 || rawLine[2] !== " ") continue;
    const pathPart = rawLine.slice(3);
    const candidates = pathPart.includes(" -> ") ? pathPart.split(" -> ") : [pathPart];
    for (const candidate of candidates) {
      const path = candidate.replace(/^"|"$/g, "").replace(/\\/g, "/");
      if (path.startsWith(".seeds/") && path !== ".seeds/knowledge.jsonl") paths.add(path);
    }
  }
  return [...paths].sort();
}

function queueDirtyPaths(): string[] {
  const proc = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", ".seeds"], {
    cwd: optionsGlobal.repo,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(`queue_dirty_preflight_git_status_failed: ${(proc.stderr || "").trim() || "git status failed"}`);
  }
  return queueDirtyPathsFromStatus(proc.stdout);
}

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

function ensureInputs(options: Options): asserts options is Options & { seedstackDir: string; adoptionSelection: string } {
  if (!options.seedstackDir) throw new Error("--seedstack-dir required");
  if (!options.adoptionSelection) throw new Error("--adoption-selection required");
  if (options.followupsPerManage > options.followupCap) {
    throw new Error("--followups-per-manage cannot exceed --followup-cap");
  }
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

let optionsGlobal: Options & { seedstackDir: string; adoptionSelection: string };

// ── Dashboard state ──────────────────────────────────────────────────────────
type SeedTiming = {
  seed: string;
  result: "ok" | "skipped" | "failed";
  dispatch_ms?: number;
  manage_ms?: number;
  commit_ms?: number;
  reason?: string;
};

let dashboardTimings: SeedTiming[] = [];
let dashboardLoopStartedAt = 0;
let dashboardPhaseStartedAt = 0;
let dashboardCurrentSeed: string | null = null;
let dashboardCurrentPhase: "idle" | "dispatch" | "manage" | "commit" | "scan" = "idle";
let dashboardIteration = 0;
let dashboardState = "idle";
let dashboardCurrentTiming: SeedTiming | null = null;

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

  let current = `State: **${state}**`;
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
  return runJson(seedstackDir, iteration, `update-${next}`, checkerPath("update-run-state.ts"), [
    "--repo",
    optionsGlobal.repo,
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

function knowledgeCapturePath(seed: string): string {
  return join(optionsGlobal.repo, "tmp", "dispatch-work", seed, "knowledge-capture.md");
}

function knowledgeStorePath(): string {
  return join(optionsGlobal.repo, ".seeds", "knowledge.jsonl");
}

function knowledgeStoreLineCount(path: string): { valid: boolean; count: number; error?: string } {
  if (!existsSync(path)) return { valid: true, count: 0 };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  try {
    for (const line of lines) JSON.parse(line) as unknown;
    return { valid: true, count: lines.length };
  } catch (error) {
    return { valid: false, count: lines.length, error: (error as Error).message };
  }
}

function knowledgeStoreGitState(): { dirty: boolean; status: string } {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all", "--", ".seeds/knowledge.jsonl"], true).stdout;
  return { dirty: status.length > 0, status };
}

function knowledgeMergeUnionConfigured(): boolean {
  const path = join(optionsGlobal.repo, ".seeds", ".gitattributes");
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").split(/\r?\n/).some((line) => /^\s*knowledge\.jsonl\s+.*\bmerge=union\b/.test(line));
}

function parseKnowledgeCaptureState(text: string): string | null {
  const match = text.match(/\bcapture_state\b\s*[:=]\s*`?([a-z_]+)/i);
  return match?.[1] ?? null;
}

function parseAcceptedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!/\baccepted(?:_|\s+)ids?\b/i.test(line)) continue;
    for (const match of line.matchAll(/\bex-[a-f0-9]{6}\b/g)) ids.add(match[0]);
  }
  return [...ids].sort();
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/g, "$1"))
    .join("\n");
}

function asKnowledgeCandidate(value: unknown): { type: string; content: string } | null {
  if (!isObject(value)) return null;
  const type = stringField(value.type);
  const content = stringField(value.content);
  if (type && content && KNOWLEDGE_RECORD_TYPES.has(type) && !("evidence" in value)) return { type, content };
  return null;
}

function addDirectKnowledgeCandidate(value: unknown, out: Array<{ type: string; content: string }>): void {
  if (Array.isArray(value)) {
    for (const item of value) addDirectKnowledgeCandidate(item, out);
    return;
  }
  const candidate = asKnowledgeCandidate(value);
  if (candidate) out.push(candidate);
}

function addAcceptedRecords(value: unknown, out: Array<{ type: string; content: string }>): void {
  if (!isObject(value)) return;
  if (Array.isArray(value.accepted_records)) {
    for (const item of value.accepted_records) addDirectKnowledgeCandidate(item, out);
  }
}

function extractStructuredKnowledgeCandidates(text: string): Array<{ type: string; content: string }> {
  const candidates: Array<{ type: string; content: string }> = [];
  const parseAcceptedRecordsKey = (raw: string) => {
    try {
      addAcceptedRecords(JSON.parse(stripJsonComments(raw)) as unknown, candidates);
    } catch {
      // Ignore non-JSON prose. The loop must not infer records from text.
    }
  };
  for (const match of text.matchAll(/```(?:json|jsonc)?\s*\n([\s\S]*?)```/gi)) parseAcceptedRecordsKey(match[1] ?? "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*]\s+/, "");
    if (trimmed.startsWith("{")) parseAcceptedRecordsKey(trimmed);
  }
  for (const section of acceptedRecordsSections(text)) {
    const parseDirect = (raw: string) => {
      try {
        const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
        if (Array.isArray(parsed)) addDirectKnowledgeCandidate(parsed, candidates);
        else {
          addDirectKnowledgeCandidate(parsed, candidates);
          addAcceptedRecords(parsed, candidates);
        }
      } catch {
        // Ignore non-JSON prose. Only explicit JSON records are accepted.
      }
    };
    for (const match of section.matchAll(/```(?:json|jsonc)?\s*\n([\s\S]*?)```/gi)) parseDirect(match[1] ?? "");
    for (const line of section.split(/\r?\n/)) {
      const trimmed = line.trim().replace(/^[-*]\s+/, "");
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) parseDirect(trimmed);
    }
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.type}\0${candidate.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function acceptedRecordsSections(text: string): string[] {
  const sections: string[] = [];
  const lines = text.split(/\r?\n/);
  let active: string[] | null = null;
  const flush = () => {
    if (active) sections.push(active.join("\n"));
    active = null;
  };
  for (const line of lines) {
    const label = markdownSectionLabel(line);
    if (label) {
      if (/^accepted records$/i.test(label)) {
        flush();
        active = [];
        continue;
      }
      if (active) {
        flush();
        continue;
      }
    }
    if (active) active.push(line);
  }
  flush();
  return sections;
}

function markdownSectionLabel(line: string): string | null {
  const trimmed = line.trim();
  const heading = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/);
  const raw = heading?.[1] ?? trimmed.match(/^([A-Za-z][A-Za-z0-9 _-]{1,80}):?\s*$/)?.[1];
  return raw ? raw.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ") : null;
}

function knowledgeAuditValidation(
  auditPresent: boolean,
  auditText: string,
  captureState: string | null,
  candidates: Array<{ type: string; content: string }>,
  acceptedIds: string[],
): { ok: boolean; state: string; errors: string[] } {
  if (!auditPresent) return { ok: false, state: "audit_missing", errors: ["knowledge-capture.md missing"] };
  const errors: string[] = [];
  if (auditText.trim().length === 0) errors.push("knowledge-capture.md empty");
  if (!captureState) errors.push("capture_state missing");
  else if (!KNOWLEDGE_CAPTURE_STATES.has(captureState)) errors.push(`capture_state invalid: ${captureState}`);
  if (captureState === "recorded" && candidates.length === 0 && acceptedIds.length === 0) {
    errors.push("recorded capture requires accepted_records or accepted IDs");
  }
  if (captureState === "none_qualified" && candidates.length > 0) {
    errors.push("none_qualified capture cannot include accepted_records");
  }
  return errors.length === 0 ? { ok: true, state: captureState ?? "audit_present", errors } : { ok: false, state: "audit_invalid", errors };
}

function baseKnowledgeCaptureCheck(seed: string, mode: Options["knowledgeCapture"]): JsonObject {
  const auditPath = knowledgeCapturePath(seed);
  const auditPresent = existsSync(auditPath);
  const auditText = auditPresent ? readFileSync(auditPath, "utf8") : "";
  const storePath = knowledgeStorePath();
  const store = knowledgeStoreLineCount(storePath);
  const gitState = knowledgeStoreGitState();
  const candidates = extractStructuredKnowledgeCandidates(auditText);
  const captureState = auditPresent ? parseKnowledgeCaptureState(auditText) : null;
  const acceptedIds = auditPresent ? parseAcceptedIds(auditText) : [];
  const auditValidation = knowledgeAuditValidation(auditPresent, auditText, captureState, candidates, acceptedIds);
  const captureOk = auditValidation.ok && captureState !== "store_missing";
  return {
    contract: "knowledge_capture_check.v1",
    ok: captureOk,
    mode,
    seed,
    state: auditValidation.state,
    inputs: {
      audit_path: `tmp/dispatch-work/${seed}/knowledge-capture.md`,
      audit_present: auditPresent,
      store_path: ".seeds/knowledge.jsonl",
      store_present: existsSync(storePath),
      approved_store_script: KNOWLEDGE_STORE_SCRIPT,
      approved_store_present: existsSync(KNOWLEDGE_STORE_SCRIPT),
    },
    audit: {
      capture_state: captureState,
      valid: auditValidation.ok,
      errors: auditValidation.errors,
      marker_count: (auditText.match(/<!--\s*KNOWLEDGE:/g) ?? []).length,
      accepted_ids: acceptedIds,
      structured_candidates_count: candidates.length,
      structured_candidates: candidates,
    },
    store: {
      valid: store.valid,
      count: store.count,
      ...(store.error ? { error: store.error } : {}),
      dirty: gitState.dirty,
      status_porcelain: gitState.status,
      merge_union: knowledgeMergeUnionConfigured(),
    },
  };
}

function recordKnowledgeCandidates(check: JsonObject): JsonObject {
  const audit = isObject(check.audit) ? check.audit : {};
  const candidates = Array.isArray(audit.structured_candidates)
    ? audit.structured_candidates.filter(isObject).flatMap((item) => {
        const type = stringField(item.type);
        const content = stringField(item.content);
        return type && content && KNOWLEDGE_RECORD_TYPES.has(type) ? [{ type, content }] : [];
      })
    : [];
  if (check.state === "audit_missing" || check.state === "audit_invalid") return check;
  if (check.state !== "recorded") return check;
  if (!existsSync(KNOWLEDGE_STORE_SCRIPT) || !existsSync(join(optionsGlobal.repo, ".seeds"))) {
    return { ...check, ok: false, state: "store_missing" };
  }
  if (candidates.length === 0) return check;

  const before = knowledgeStoreLineCount(knowledgeStorePath()).count;
  const outputs: JsonObject[] = [];
  for (const candidate of candidates) {
    const proc = spawnSync(process.execPath, [KNOWLEDGE_STORE_SCRIPT, "record", ".seeds/knowledge.jsonl", "--stdin"], {
      cwd: optionsGlobal.repo,
      input: JSON.stringify(candidate),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    let parsed: unknown = null;
    try {
      parsed = proc.stdout.trim() ? JSON.parse(proc.stdout.trim()) as unknown : null;
    } catch {
      parsed = null;
    }
    outputs.push({
      status: proc.status ?? 1,
      ok: isObject(parsed) ? parsed.ok === true : false,
      stdout: isObject(parsed) ? parsed : null,
      stderr: proc.stderr.trim(),
    });
  }
  const failed = outputs.filter((output) => output.ok !== true);
  const after = knowledgeStoreLineCount(knowledgeStorePath()).count;
  return {
    ...baseKnowledgeCaptureCheck(String(check.seed), "record"),
    ok: failed.length === 0,
    state: failed.length === 0 ? "recorded" : "record_failed",
    record: {
      candidates: candidates.length,
      store_count_before: before,
      store_count_after: after,
      command_outputs: outputs,
    },
  };
}

function runKnowledgeCaptureStep(seedstackDir: string, iteration: number, seed: string): void {
  const mode = optionsGlobal.knowledgeCapture;
  if (mode === "off") {
    emit(seedstackDir, "knowledge_capture", { seed, mode, ok: true, state: "off" });
    return;
  }
  let check = baseKnowledgeCaptureCheck(seed, mode);
  if (mode === "record") check = recordKnowledgeCandidates(check);
  const path = writeLoopJson(seedstackDir, iteration, `knowledge-capture-${seed}`, check);
  emit(seedstackDir, "knowledge_capture", {
    seed,
    mode,
    ok: ok(check),
    state: stringField(check.state) ?? null,
    path,
  });
  if (knowledgeCaptureBlocksRequired(check)) {
    stop(seedstackDir, iteration, "blocked", "knowledge_capture_required_failed", {
      seed,
      knowledge_capture: path,
      state: stringField(check.state) ?? null,
    });
  }
}

function knowledgeCaptureBlocksRequired(check: JsonObject): boolean {
  return !ok(check) && optionsGlobal.knowledgeRequired;
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function appendCommitLedger(seedstackDir: string, seed: string, commit: string, dirtyPath: string): void {
  const path = commitLedgerPath(seedstackDir);
  if (!existsSync(path)) {
    writeFileSync(path, "| timestamp | seed | commit | subject | gates | dirty snapshot | policy |\n| --- | --- | --- | --- | --- | --- | --- |\n");
  }
  const subject = runGit(["show", "-s", "--format=%s", commit]).stdout;
  const row = [
    new Date().toISOString(),
    seed,
    commit,
    subject,
    "dispatch-close",
    dirtyPath,
    "per_seed",
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

function createPerSeedCommit(seedstackDir: string, iteration: number, seed: string, dirtyPath: string, dirty: JsonObject): string {
  const beforeStaged = stagedPaths();
  if (beforeStaged.length > 0) {
    stop(seedstackDir, iteration, "blocked", "preexisting_staged_changes_before_auto_commit", {
      seed,
      staged_paths: beforeStaged,
    });
  }
  const paths = commitCandidatePaths(dirty);
  if (paths.length === 0) {
    stop(seedstackDir, iteration, "blocked", "no_seed_owned_paths_to_commit", { seed, dirty: dirtyPath });
  }
  try {
    runGit(["add", "-A", "--", ...paths]);
    const diff = runGit(["diff", "--cached", "--quiet"], true);
    if (diff.status === 0) {
      stop(seedstackDir, iteration, "blocked", "no_staged_seed_changes_to_commit", { seed, paths });
    }
    runGit(["commit", "-m", `seedstack: close ${seed}`]);
    const commit = runGit(["rev-parse", "HEAD"]).stdout;
    appendCommitLedger(seedstackDir, seed, commit, dirtyPath);
    return commit;
  } catch (error) {
    runGit(["reset", "-q", "--", ...paths], true);
    stop(seedstackDir, iteration, "blocked", "auto_commit_failed", {
      seed,
      paths,
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
      reconcileDispatchToManage(seedstackDir, iteration, seed, priorChild?.result, priorChild?.path);
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
      const postScan = runScan(seedstackDir, iteration, `post-manage-scan-${seed}`);
      if (!ok(postScan)) stop(seedstackDir, iteration, "blocked", "scan_failed_after_manage", { seed, scan: latestArtifactPath(postScan) });
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
      if (childResult.decision === "blocked") {
        stop(seedstackDir, iteration, "blocked", stringField(childResult.blocked_reason) ?? "manage_blocked", { seed });
      }
      if (latestDispatchNonclosed(runState) && childResult.decision !== "retry_same_seed" && childResult.decision !== "blocked") {
        stop(seedstackDir, iteration, "blocked", "manage_nonclosed_continue_blocked", {
          seed,
          manage_decision: childResult.decision ?? null,
        });
      }
      if (childResult.decision === "retry_same_seed") {
        const retryAllocation = allocateSupervisorIteration(seedstackDir);
        const retryIteration = retryAllocation.iteration;
        const retryDirty = runJson(seedstackDir, retryIteration, `retry-dirty-${seed}`, checkerPath("classify-dirty-state.ts"), [
          "--repo",
          optionsGlobal.repo,
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
        const pendingPath = writeLoopJson(seedstackDir, iteration, `latest-dispatch-pending-${seed}`, {
          status: "closed_clean",
          commit_pending: true,
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
        const commit = createPerSeedCommit(seedstackDir, iteration, seed, dirtyPath, dirty);
        const committedPath = writeLoopJson(seedstackDir, iteration, `latest-dispatch-committed-${seed}`, {
          status: "closed_clean",
          commit_pending: false,
        });
        updateRunState(seedstackDir, iteration, "managing", [
          "--seed",
          seed,
          "--decision",
          "committed",
          "--rationale",
          `per-seed commit ${commit} recorded`,
          "--latest-dispatch-file",
          committedPath,
          "--commit",
          commit,
        ]);
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
        commit,
        "--commit-policy",
        "per_seed",
        ...expectedSeedPaths.flatMap((path) => ["--expected-path", path]),
        "--pretty",
      ], true);
        emit(seedstackDir, "commit_ledger_check", { seed, ok: ok(ledger), decision: decision(ledger), commit, path: latestArtifactPath(ledger) });
        if (!ok(ledger) || decision(ledger) !== "ledger_ready") {
          stop(seedstackDir, iteration, "blocked", "commit_ledger_blocked", { seed, commit, ledger: latestArtifactPath(ledger) });
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

function assertSelfTest(condition: unknown, message: string): void {
  if (!condition) throw new Error(`self-test failed: ${message}`);
}

function runLoopIterationAllocationSelfTest(): void {
  const root = mkdtempSync(join(tmpdir(), "seedstack-loop-iteration-"));
  const adoptionSelection = join(root, "adoption-selection.json");
  const previousOptions = optionsGlobal;
  writeFileSync(adoptionSelection, JSON.stringify({ adopted_seed_ids: ["seed-test"] }));
  optionsGlobal = {
    ...parseArgs(["--repo", root, "--seedstack-dir", root, "--adoption-selection", adoptionSelection]),
    seedstackDir: root,
    adoptionSelection,
  };

  try {
    const noState = join(root, "no-state");
    mkdirSync(noState, { recursive: true });
    assertSelfTest(loadLoopState(noState).loop_iteration === 0, "loop iteration defaults to zero without state or files");
    assertSelfTest(allocateSupervisorIteration(noState).iteration === 1, "first allocation starts at one");

    const persisted = join(root, "persisted");
    mkdirSync(persisted, { recursive: true });
    writeJson(loopStatePath(persisted), {
      contract: "seedstack_loop_state.v1",
      loop_iteration: 7,
      scan_epoch: 0,
      manage_epoch: 0,
      total_followups: 0,
      baseline_seed_count: 1,
      skipped_seeds: [],
    });
    assertSelfTest(loadLoopState(persisted).loop_iteration === 7, "loop iteration loads persisted state");
    assertSelfTest(allocateSupervisorIteration(persisted).iteration === 8, "allocation follows persisted state");

    const filesOnly = join(root, "files-only");
    mkdirSync(loopDir(filesOnly), { recursive: true });
    writeFileSync(iterationArtifactPath(filesOnly, 12, "scan"), "{}\n");
    assertSelfTest(loadLoopState(filesOnly).loop_iteration === 12, "loop iteration scans existing artifact files");
    assertSelfTest(allocateSupervisorIteration(filesOnly).iteration === 13, "allocation follows existing artifact files");

    const merged = join(root, "merged");
    mkdirSync(loopDir(merged), { recursive: true });
    writeJson(loopStatePath(merged), {
      contract: "seedstack_loop_state.v1",
      loop_iteration: 7,
      scan_epoch: 0,
      manage_epoch: 0,
      total_followups: 0,
      baseline_seed_count: 1,
      skipped_seeds: [],
    });
    writeFileSync(iterationArtifactPath(merged, 12, "scan"), "{}\n");
    assertSelfTest(loadLoopState(merged).loop_iteration === 12, "loop iteration merges persisted state and file max");

    const large = join(root, "large");
    mkdirSync(loopDir(large), { recursive: true });
    writeFileSync(join(loopDir(large), "12345-scan.json"), "{}\n");
    assertSelfTest(loadLoopState(large).loop_iteration === 12345, "loop iteration scans large names");
    assertSelfTest(allocateSupervisorIteration(large).iteration === 12346, "allocation follows large existing names");

    const retry = join(root, "retry");
    mkdirSync(loopDir(retry), { recursive: true });
    const first = allocateSupervisorIteration(retry).iteration;
    const firstResult = resultPath(retry, "dispatch", "seed-test", first);
    writeFileSync(firstResult, "{}\n");
    const second = allocateSupervisorIteration(retry).iteration;
    const secondResult = resultPath(retry, "dispatch", "seed-test", second);
    assertSelfTest(second === first + 1, "retry same seed allocates fresh supervisor iteration");
    assertSelfTest(secondResult !== firstResult && existsSync(firstResult), "retry same seed does not clobber first dispatch result");
  } finally {
    optionsGlobal = previousOptions;
    rmSync(root, { recursive: true, force: true });
  }
}

async function selfTest(pretty: boolean): Promise<never> {
  const parsed = parseArgs([
    "--child-total-timeout-ms",
    "123",
    "--child-silent-timeout-ms=45",
    "--child-silent-probe-ms",
    "6",
    "--post-seed-delay-ms=25",
  ]);
  assertSelfTest(parsed.childTotalTimeoutMs === 123, "total timeout arg parse");
  assertSelfTest(parsed.childSilentTimeoutMs === 45, "silent timeout equals arg parse");
  assertSelfTest(parsed.childSilentProbeMs === 6, "silent probe arg parse");
  assertSelfTest(parsed.postSeedDelayMs === 25, "post-seed delay equals arg parse");
  assertSelfTest(parsed.commitPolicy === "per_seed", "auto commit policy default");
  assertSelfTest(parsed.knowledgeCapture === "audit", "knowledge capture default");
  const recordKnowledge = parseArgs(["--knowledge-capture", "record", "--knowledge-required"]);
  assertSelfTest(recordKnowledge.knowledgeCapture === "record", "knowledge capture arg parse");
  assertSelfTest(recordKnowledge.knowledgeRequired, "knowledge required arg parse");
  const offKnowledge = parseArgs(["--knowledge-capture=off"]);
  assertSelfTest(offKnowledge.knowledgeCapture === "off", "knowledge capture equals arg parse");
  const manualDefault = parseArgs(["--mode", "manual"]);
  assertSelfTest(manualDefault.commitPolicy === "none", "manual commit policy default");
  const explicitNone = parseArgs(["--commit-policy", "none"]);
  assertSelfTest(explicitNone.commitPolicy === "none", "explicit none commit policy");
  assertSelfTest(parsed.codexReasoningEffort === "medium", "reasoning effort default");
  const lowReasoning = parseArgs(["--codex-reasoning-effort", "low"]);
  assertSelfTest(lowReasoning.codexReasoningEffort === "low", "reasoning effort arg parse");
  const xhighReasoning = parseArgs(["--codex-reasoning-effort=xhigh"]);
  assertSelfTest(xhighReasoning.codexReasoningEffort === "xhigh", "reasoning effort equals arg parse");
  assertSelfTest(parsed.runner === "codex", "runner default");
  assertSelfTest(parsed.claudeBin === "claude", "claude bin default");
  assertSelfTest(parsed.claudeModel === "claude-sonnet-4-6", "claude model default");
  const claudeParsed = parseArgs(["--runner", "claude", "--claude-model", "claude-haiku-4-5-20251001"]);
  assertSelfTest(claudeParsed.runner === "claude", "claude runner parse");
  assertSelfTest(claudeParsed.claudeModel === "claude-haiku-4-5-20251001", "claude model parse");
  const clamped = parseArgs(["--child-silent-timeout-ms", "50"]);
  assertSelfTest(clamped.childSilentProbeMs === 50, "silent probe clamps to timeout");
  try {
    parseArgs(["--post-seed-delay-ms", "-1"]);
    assertSelfTest(false, "invalid post-seed delay rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("post-seed-delay-ms"), "invalid post-seed delay error");
  }
  try {
    parseArgs(["--child-total-timeout-ms", "0"]);
    assertSelfTest(false, "invalid timeout rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("positive"), "invalid timeout error");
  }
  try {
    parseArgs(["--codex-reasoning-effort", "turbo"]);
    assertSelfTest(false, "invalid reasoning effort rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("codex-reasoning-effort"), "invalid reasoning effort error");
  }
  try {
    parseArgs(["--knowledge-capture", "maybe"]);
    assertSelfTest(false, "invalid knowledge capture rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("knowledge-capture"), "invalid knowledge capture error");
  }
  try {
    runStateName({ state: "dispatch" });
    assertSelfTest(false, "invalid run-state rejected");
  } catch (error) {
    assertSelfTest(String((error as Error).message).includes("invalid_run_state"), "invalid run-state error");
  }
  assertSelfTest(beforeFirstDispatch({ state: "idle" }), "empty idle run-state is before first dispatch");
  assertSelfTest(!beforeFirstDispatch({ state: "idle", loop_iteration: 1 }), "loop iteration marks dispatch started");
  assertSelfTest(!beforeFirstDispatch({ state: "idle", dispatch_attempts: { S1: 1 } }), "dispatch attempt marks dispatch started");
  assertSelfTest(!beforeFirstDispatch({ state: "idle", latest_dispatch: { seed_id: "S1" } }), "latest dispatch marks dispatch started");
  runLoopIterationAllocationSelfTest();
  const queueDirty = queueDirtyPathsFromStatus([
    " M .seeds/issues.jsonl",
    "?? .seeds/knowledge.jsonl",
    " M .seeds/deps.jsonl",
    "R  .seeds/issues.jsonl -> .seeds/knowledge.jsonl",
    " M src/app.ts",
    "",
  ].join("\n"));
  assertSelfTest(
    queueDirty.length === 2 && queueDirty.includes(".seeds/issues.jsonl") && queueDirty.includes(".seeds/deps.jsonl"),
    "queue dirty preflight excludes knowledge and includes queue paths",
  );
  const commitCandidates = commitCandidatePaths({
    paths: [
      { path: ".seeds/issues.jsonl", classification: "dispatcher_owned" },
      { path: ".seeds/knowledge.jsonl", classification: "capture_owned" },
      { path: "src/owned.ts", classification: "expected_seed" },
    ],
  });
  assertSelfTest(
    commitCandidates.join(",") === ".seeds/issues.jsonl,src/owned.ts",
    "commit candidates exclude capture-owned knowledge",
  );
  const knowledgeRepo = mkdtempSync(join(tmpdir(), "seedstack-knowledge-"));
  try {
    const init = spawnSync("git", ["init"], { cwd: knowledgeRepo, encoding: "utf8" });
    assertSelfTest((init.status ?? 1) === 0, "knowledge self-test git init");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-empty"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-empty", "knowledge-capture.md"), "capture_state=none_qualified\naccepted IDs: []\n");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-invalid"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-invalid", "knowledge-capture.md"), "\n");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-recorded"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-recorded", "knowledge-capture.md"), [
      "capture_state=recorded",
      "```json",
      "{\"accepted_records\":[{\"type\":\"failure\",\"content\":\"When X, beware Y. Cause: Z. Do: W. Verify: T. Limit: L.\"}]}",
      "```",
      "",
    ].join("\n"));
    const testOptions = parseArgs([
      "--repo",
      knowledgeRepo,
      "--seedstack-dir",
      "tmp/seedstack/test",
      "--adoption-selection",
      "tmp/seedstack/test/adoption-selection.json",
      "--knowledge-required",
    ]) as Options & { seedstackDir: string; adoptionSelection: string };
    optionsGlobal = testOptions;
    const missingAudit = baseKnowledgeCaptureCheck("seed-missing", "audit");
    assertSelfTest(!ok(missingAudit) && stringField(missingAudit.state) === "audit_missing", "knowledge audit missing fails check");
    assertSelfTest(knowledgeCaptureBlocksRequired(missingAudit), "required missing audit blocks");
    const invalidAudit = baseKnowledgeCaptureCheck("seed-invalid", "audit");
    assertSelfTest(!ok(invalidAudit) && stringField(invalidAudit.state) === "audit_invalid", "knowledge invalid audit rejected");
    assertSelfTest(knowledgeCaptureBlocksRequired(invalidAudit), "required invalid audit blocks");
    const emptyAudit = baseKnowledgeCaptureCheck("seed-empty", "audit");
    assertSelfTest(ok(emptyAudit) && stringField(emptyAudit.state) === "none_qualified", "knowledge none qualified audit succeeds");
    assertSelfTest(!knowledgeCaptureBlocksRequired(emptyAudit), "required none qualified audit passes");
    const missingStore = recordKnowledgeCandidates(baseKnowledgeCaptureCheck("seed-recorded", "record"));
    assertSelfTest(!ok(missingStore) && stringField(missingStore.state) === "store_missing", "record mode missing store state");
    mkdirSync(join(knowledgeRepo, ".seeds"), { recursive: true });
    writeFileSync(join(knowledgeRepo, ".seeds", ".gitattributes"), "knowledge.jsonl merge=union\n");
    writeFileSync(join(knowledgeRepo, ".seeds", "knowledge.jsonl"), "{\"id\":\"ex-5e569a\",\"type\":\"guide\",\"content\":\"x\",\"recorded_at\":\"2026-01-01T00:00:00.000Z\"}\n");
    const noneQualified = recordKnowledgeCandidates(baseKnowledgeCaptureCheck("seed-empty", "record"));
    assertSelfTest(ok(noneQualified) && stringField(noneQualified.state) === "none_qualified", "record mode none qualified state");
    assertSelfTest(!knowledgeCaptureBlocksRequired(noneQualified), "required none qualified record passes");
    const auditOne = baseKnowledgeCaptureCheck("seed-empty", "audit");
    const auditTwo = baseKnowledgeCaptureCheck("seed-empty", "audit");
    assertSelfTest(JSON.stringify(auditOne) === JSON.stringify(auditTwo), "knowledge audit deterministic");
    const storeInfo = isObject(auditOne.store) ? auditOne.store : {};
    assertSelfTest(storeInfo.count === 1 && storeInfo.dirty === true && storeInfo.merge_union === true, "knowledge store state inspected");
    mkdirSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-candidate"), { recursive: true });
    writeFileSync(join(knowledgeRepo, "tmp", "dispatch-work", "seed-candidate", "knowledge-capture.md"), [
      "capture_state=recorded",
      "```json",
      JSON.stringify({
        accepted_records: [{ type: "failure", content: "When accepted, record this. Cause: Z. Do: W. Verify: T. Limit: L." }],
        rejected_records: [{ type: "failure", content: "Rejected record must not be appended." }],
      }),
      "```",
      "",
    ].join("\n"));
    const candidateAudit = baseKnowledgeCaptureCheck("seed-candidate", "audit");
    const candidateAuditInfo = isObject(candidateAudit.audit) ? candidateAudit.audit : {};
    assertSelfTest(candidateAuditInfo.structured_candidates_count === 1, "knowledge structured candidate parse");
    const recorded = recordKnowledgeCandidates(baseKnowledgeCaptureCheck("seed-candidate", "record"));
    assertSelfTest(ok(recorded) && stringField(recorded.state) === "recorded", "accepted_records append via store succeeds");
    const finalStore = readFileSync(join(knowledgeRepo, ".seeds", "knowledge.jsonl"), "utf8");
    assertSelfTest(finalStore.includes("When accepted, record this."), "accepted record appended");
    assertSelfTest(!finalStore.includes("Rejected record must not be appended."), "rejected record not appended");
    assertSelfTest(knowledgeStoreLineCount(knowledgeStorePath()).count === 2, "only accepted record appended");
  } finally {
    rmSync(knowledgeRepo, { recursive: true, force: true });
  }
  await runChildTimeoutSelfTest(assertSelfTest);
  const dispatchPrompt = buildDispatchPrompt("/repo", "seed-test", "/result.json");
  assertSelfTest(dispatchPrompt.includes("outer supervised exec (Codex or Claude Code CLI) managed by seedstack"), "dispatch prompt explains outer supervision");
  assertSelfTest(dispatchPrompt.includes("native agent-spawn tool (spawn_agent for Codex, Agent tool for Claude Code) only if it returns a real child id"), "dispatch prompt requires real spawn_agent id");
  assertSelfTest(dispatchPrompt.includes("Never fabricate liveness handles"), "dispatch prompt forbids fabricated liveness");
  assertSelfTest(dispatchPrompt.includes("not child_run_status evidence"), "dispatch prompt separates seedstack result from child status evidence");
  assertSelfTest(!dispatchPrompt.includes('"decision": "closed|blocked|escalated|crashed",'), "dispatch prompt avoids literal enum example");
  const managePrompt = buildManagePrompt({
    repo: "/repo",
    seedstackDir: "/stack",
    followupsPerManage: 2,
    seed: "seed-test",
    reconcileFile: "/reconcile.json",
    resultFile: "/result.json",
    remainingFollowups: 3,
  });
  assertSelfTest(managePrompt.includes("retry_same_seed, continue_other_seeds, blocked, done"), "manage prompt lists retry policy enum");
  assertSelfTest(!managePrompt.includes('"decision": "continue"'), "manage prompt avoids legacy continue decision");
  const gatePaths = parseGateExpectedSeedPaths([
    "## Dirty Guard",
    "- known dirty paths before close: `.seeds/issues.jsonl` (dispatcher claim), `impl/rust/tests/cli.rs` (implementation)",
    "- artifact: `tmp/dispatch-work/seed/gate.md`",
    "- status words: `close`, `pass`",
    "outside bullet `impl/rust/src/lib.rs`",
    "## Review",
  ].join("\n"));
  assertSelfTest(gatePaths.length === 1 && gatePaths[0] === "impl/rust/tests/cli.rs", "gate dirty paths parse");
  const yamlGatePaths = parseGateExpectedSeedPaths([
    "dirty_guard:",
    "- .seeds/issues.jsonl dirty from dispatcher claim only.",
    "- implementation changes limited to seedspec/impl_v2/rust/src/main.rs and impl_v2/rust/tests/list_labels.rs.",
    "",
    "final_rationale:",
    "- ignore impl_v2/rust/src/not_dirty.rs here.",
  ].join("\n"));
  assertSelfTest(
    yamlGatePaths.length === 2 &&
      yamlGatePaths.includes("impl_v2/rust/src/main.rs") &&
      yamlGatePaths.includes("impl_v2/rust/tests/list_labels.rs"),
    "gate dirty_guard yaml paths parse",
  );
  const devcontainerGatePaths = parseGateExpectedSeedPaths([
    "## Dirty Guard",
    "- implementation paths: .devcontainer/skills/seedstack/scripts/seedstack-loop.ts",
    "```json",
    JSON.stringify({
      contract: "dirty_guard.v1",
      actual_impl_paths: [".devcontainer/skills/seedstack/scripts/seedstack-loop.ts"],
    }),
    "```",
  ].join("\n"));
  assertSelfTest(
    devcontainerGatePaths.includes(".devcontainer/skills/seedstack/scripts/seedstack-loop.ts") &&
      !devcontainerGatePaths.includes("skills/seedstack/scripts/seedstack-loop.ts"),
    "gate dirty paths preserve dot-prefixed root",
  );

  const result = {
    contract: "seedstack_loop_self_test.v1",
    ok: true,
    checks: [
      "args_parse",
      "post_seed_delay_args_parse",
      "child_timeout_args_parse",
      "child_silent_probe_clamp",
      "child_timeout_watchdog",
      "child_total_timeout",
      "invalid_run_state",
      "preexisting_queue_dirty_before_auto_run",
      "knowledge_capture_args",
      "knowledge_capture_required",
      "knowledge_capture_audit",
      "knowledge_capture_record_none",
      "child_result_contract",
      "child_launch_provenance",
      "dispatch_prompt_launch_provenance",
      "gate_dirty_expected_paths",
      "loop_state_contract",
      "loop_iteration_allocation",
    ],
  };
  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
  process.exit(0);
}

let options: Options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.selfTest) await selfTest(options.pretty);
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
