// CLI parsing for seedstack-loop.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  DEFAULT_CHILD_SILENT_PROBE_MS,
  DEFAULT_CHILD_SILENT_TIMEOUT_MS,
  DEFAULT_CHILD_TOTAL_TIMEOUT_MS,
} from "../child-supervisor.ts";
import { preflightRepo } from "../worktree-preflight.ts";
import { runStatePath as statePath } from "../seedstack-paths.ts";
import { readJson, isObject, stringField } from "./types.ts";
import type { Options } from "./types.ts";

const HELP = `seedstack-loop.ts seedstack_loop.v1

Usage:
  bun skills/seedstack/scripts/seedstack-loop.ts --seedstack-dir <dir> --adoption-selection <json> [args]
  bun skills/seedstack/scripts/seedstack-loop.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root. Default: cwd.
  --worktree-policy <linked-ok|allow-same-branch>
                                    Default: linked-ok. Accept linked worktrees but block same-branch duplicates.
  --allow-same-branch-worktree      Alias for --worktree-policy allow-same-branch.
  --require-worktree                Require --repo to resolve to a linked git worktree.
  --seedstack-dir <path>           Stack artifact dir containing run-state.json.
  --adoption-selection <path>      Active adoption manifest.
  --seed-cli <path>                work queue CLI. Default: sd.
  --mode <auto|manual>             Default: auto.
  --commit-policy <none|per_seed>   Default: per_seed in auto, none in manual.
  --knowledge-capture <off|audit|record>
                                    Knowledge capture policy before clean-close queue mutations. Default: audit.
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

export function usage(exitCode: 0 | 2): never {
  (exitCode === 0 ? process.stdout : process.stderr).write(HELP);
  process.exit(exitCode);
}

export function take(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

export function parsePositive(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (parsed <= 0) throw new Error(`${flag} must be positive`);
  return parsed;
}

export function parseNonNegative(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  return Number(value);
}

export function parseReasoningEffort(value: string): Options["codexReasoningEffort"] {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new Error("--codex-reasoning-effort must be low, medium, high, or xhigh");
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    originalRepo: process.cwd(),
    worktreePolicy: "linked-ok",
    requireWorktree: false,
    worktree: {
      original_repo_input: process.cwd(),
      original_repo_path: process.cwd(),
      repo: process.cwd(),
      git_common_dir: null,
      git_dir: null,
      worktree_root: null,
      branch: null,
      head: null,
      linked: false,
      policy: "linked-ok",
      require_worktree: false,
    },
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
      case "--worktree-policy": {
        const policy = take(argv, index, arg);
        if (policy !== "linked-ok" && policy !== "allow-same-branch") {
          throw new Error("--worktree-policy must be linked-ok or allow-same-branch");
        }
        options.worktreePolicy = policy;
        index += 1;
        break;
      }
      case "--allow-same-branch-worktree":
        options.worktreePolicy = "allow-same-branch";
        break;
      case "--require-worktree":
        options.requireWorktree = true;
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
        else if (arg.startsWith("--worktree-policy=")) {
          const policy = arg.slice("--worktree-policy=".length);
          if (policy !== "linked-ok" && policy !== "allow-same-branch") {
            throw new Error("--worktree-policy must be linked-ok or allow-same-branch");
          }
          options.worktreePolicy = policy;
        }
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

  const callerCwd = process.cwd();
  const originalRepo = options.repo;
  if (options.seedstackDir) options.seedstackDir = resolve(callerCwd, options.seedstackDir);
  if (options.adoptionSelection) options.adoptionSelection = resolve(callerCwd, options.adoptionSelection);
  const persistedRepo = persistedRepoFromRunState(options.seedstackDir);
  const preflight = preflightRepo({
    repoInput: persistedRepo ?? originalRepo,
    cwd: callerCwd,
    policy: options.worktreePolicy,
    requireWorktree: options.requireWorktree,
  });
  options.originalRepo = originalRepo;
  options.repo = preflight.repo;
  options.worktree = {
    ...preflight.metadata,
    original_repo_input: originalRepo,
    original_repo_path: resolve(callerCwd, originalRepo),
  };
  if (options.mode === "auto" && !options.commitPolicyExplicit) options.commitPolicy = "per_seed";
  if (options.maxSeedTarget >= options.splitCandidate) {
    throw new Error("--max-seed-target must be lower than --split-candidate");
  }
  options.childSilentProbeMs = Math.min(options.childSilentProbeMs, options.childSilentTimeoutMs);
  return options;
}

export function ensureInputs(options: Options): asserts options is Options & { seedstackDir: string; adoptionSelection: string } {
  if (!options.seedstackDir) throw new Error("--seedstack-dir required");
  if (!options.adoptionSelection) throw new Error("--adoption-selection required");
  if (options.followupsPerManage > options.followupCap) {
    throw new Error("--followups-per-manage cannot exceed --followup-cap");
  }
}

export function persistedRepoFromRunState(seedstackDir: string | undefined): string | null {
  if (!seedstackDir) return null;
  const path = statePath(seedstackDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readJson(path);
    if (!isObject(raw)) return null;
    const repo = stringField(raw.repo);
    return repo && isAbsolute(repo) ? repo : null;
  } catch {
    return null;
  }
}
