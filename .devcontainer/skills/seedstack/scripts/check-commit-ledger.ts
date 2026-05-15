#!/usr/bin/env bun
// Deterministic Seedstack per-seed commit ledger guard.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

type CommitPolicy = "per_seed" | "batch" | "none";

type Decision =
  | "ledger_ready"
  | "commit_ready"
  | "blocked_missing_commit"
  | "blocked_dirty"
  | "blocked_mismatch";

type Finding = {
  code: string;
  message: string;
  path?: string;
};

type LedgerRow = {
  timestamp: string;
  seed: string;
  commit: string;
  subject: string;
  gates: string;
  dirty_snapshot: string;
  policy: string;
};

type DirtyPath = {
  path?: unknown;
  classification?: unknown;
  reason?: unknown;
};

type RunState = {
  commit_policy?: unknown;
  latest_dispatch?: {
    seed_id?: unknown;
    status?: unknown;
    commit?: unknown;
    commit_pending?: unknown;
    dispatch_artifact_root?: unknown;
  };
  dirty_state?: {
    paths?: unknown;
  };
};

type DirtyResult = {
  ok?: unknown;
  summary?: unknown;
  unexpected_paths?: unknown;
  paths?: unknown;
};

type CommandRecord = {
  name: "classify-dirty-state";
  argv: string[];
  exit_code: number;
};

type Options = {
  repo: string;
  seedstackDir?: string;
  runState?: string;
  commitLedger?: string;
  seed?: string;
  commit?: string;
  commitPolicy?: CommitPolicy;
  dirtyResult?: string;
  expectedPaths: string[];
  preexisting: string[];
  skipGit: boolean;
  pretty: boolean;
  selfTest: boolean;
  gitPathsFile?: string;
  gitExistsFile?: string;
};

type Result = {
  contract: "commit_ledger_check.v1";
  ok: boolean;
  decision: Decision;
  blockers: Finding[];
  warnings: Finding[];
  seed: string | null;
  commit: string | null;
  ledger_row: LedgerRow | null;
  git: {
    exists: boolean | null;
    paths: string[];
  };
  dirty: {
    ok: boolean | null;
    summary: unknown;
    unexpected_paths: string[];
    paths: unknown[];
  };
  summary: Record<string, unknown>;
  commands: CommandRecord[];
};

const HELP = `check-commit-ledger.ts commit_ledger_check.v1

Usage:
  bun skills/seedstack/scripts/check-commit-ledger.ts [args]
  bun skills/seedstack/scripts/check-commit-ledger.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root/subdir. Default: cwd.
  --seedstack-dir <path>           Seedstack artifact dir.
  --run-state <path>               Default: <seedstack-dir>/run-state.json.
  --commit-ledger <path>           Default: <seedstack-dir>/commit-ledger.md.
  --seed <work-id>                 Default: latest_dispatch.seed_id.
  --commit <hash>                  Default: latest_dispatch.commit.
  --commit-policy <per_seed|batch|none>
                                    Expected/default from run-state.
  --dirty-result <json>            Dirty classifier JSON fixture/result.
  --expected-path <path-prefix>    Additional expected touched path prefix. Repeatable.
  --preexisting <path-prefix>      Allowed current dirty path prefix. Repeatable.
  --skip-git                       Skip git verification and dirty classifier.
  --git-paths-file <path>          Self-test fixture for commit paths.
  --git-exists-file <path>         Self-test fixture: true/false.
  --pretty                         Pretty-print JSON.
  --self-test                      Run fixture tests.
  --help                           Show this help.
`;

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

function parsePolicy(value: string, flag: string): CommitPolicy {
  if (value === "per_seed" || value === "batch" || value === "none") return value;
  throw new Error(`${flag} must be per_seed, batch, or none`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    expectedPaths: [],
    preexisting: [],
    skipGit: false,
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
        process.stdout.write(HELP);
        process.exit(0);
      case "--pretty":
        options.pretty = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      case "--skip-git":
        options.skipGit = true;
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
      case "--commit-ledger":
        options.commitLedger = take();
        break;
      case "--seed":
        options.seed = take();
        break;
      case "--commit":
        options.commit = take();
        break;
      case "--commit-policy":
        options.commitPolicy = parsePolicy(take(), arg);
        break;
      case "--dirty-result":
        options.dirtyResult = take();
        break;
      case "--expected-path":
        options.expectedPaths.push(take());
        break;
      case "--preexisting":
        options.preexisting.push(take());
        break;
      case "--git-paths-file":
        options.gitPathsFile = take();
        break;
      case "--git-exists-file":
        options.gitExistsFile = take();
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--seedstack-dir=")) options.seedstackDir = arg.slice("--seedstack-dir=".length);
        else if (arg.startsWith("--run-state=")) options.runState = arg.slice("--run-state=".length);
        else if (arg.startsWith("--commit-ledger=")) options.commitLedger = arg.slice("--commit-ledger=".length);
        else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--commit=")) options.commit = arg.slice("--commit=".length);
        else if (arg.startsWith("--commit-policy=")) options.commitPolicy = parsePolicy(arg.slice("--commit-policy=".length), "--commit-policy");
        else if (arg.startsWith("--dirty-result=")) options.dirtyResult = arg.slice("--dirty-result=".length);
        else if (arg.startsWith("--expected-path=")) options.expectedPaths.push(arg.slice("--expected-path=".length));
        else if (arg.startsWith("--preexisting=")) options.preexisting.push(arg.slice("--preexisting=".length));
        else if (arg.startsWith("--git-paths-file=")) options.gitPathsFile = arg.slice("--git-paths-file=".length);
        else if (arg.startsWith("--git-exists-file=")) options.gitExistsFile = arg.slice("--git-exists-file=".length);
        else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  if (!options.seedstackDir && options.runState) options.seedstackDir = dirname(options.runState);
  if (!options.seedstackDir && options.commitLedger) options.seedstackDir = dirname(options.commitLedger);
  if (options.seedstackDir) {
    options.seedstackDir = resolve(options.repo, options.seedstackDir);
    options.runState = options.runState ?? join(options.seedstackDir, "run-state.json");
    options.commitLedger = options.commitLedger ?? join(options.seedstackDir, "commit-ledger.md");
  }
  if (options.runState) options.runState = resolve(options.repo, options.runState);
  if (options.commitLedger) options.commitLedger = resolve(options.repo, options.commitLedger);
  if (options.dirtyResult) options.dirtyResult = resolve(options.repo, options.dirtyResult);
  if (options.gitPathsFile) options.gitPathsFile = resolve(options.repo, options.gitPathsFile);
  if (options.gitExistsFile) options.gitExistsFile = resolve(options.repo, options.gitExistsFile);
  return options;
}

function readRunState(path?: string): RunState | null {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RunState;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function policyValue(value: unknown): CommitPolicy | undefined {
  return typeof value === "string" ? parsePolicy(value, "commit_policy") : undefined;
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = body.endsWith("|") ? body.slice(0, -1) : body;
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of withoutEnd) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseLedger(path?: string): { rows: LedgerRow[]; warnings: Finding[] } {
  if (!path || !existsSync(path)) {
    return { rows: [], warnings: [{ code: "missing_ledger", message: "commit ledger not found" }] };
  }
  const rows: LedgerRow[] = [];
  const warnings: Finding[] = [];
  let header: string[] | null = null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitMarkdownRow(line);
    if (!header) {
      header = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (isSeparator(cells)) continue;
    if (cells.length < header.length) {
      warnings.push({ code: "short_ledger_row", message: "ledger row has fewer cells than header" });
      continue;
    }
    const get = (name: string) => cells[header?.indexOf(name) ?? -1] ?? "";
    rows.push({
      timestamp: get("timestamp"),
      seed: get("seed"),
      commit: get("commit"),
      subject: get("subject"),
      gates: get("gates"),
      dirty_snapshot: get("dirty snapshot"),
      policy: get("policy"),
    });
  }
  return { rows, warnings };
}

function stripDotSlash(path: string): string {
  let value = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  while (value.startsWith("./")) value = value.slice(2);
  return value;
}

function toRepoPath(path: string, repo: string): string {
  const normalized = stripDotSlash(path);
  if (!normalized || normalized === ".") return "";
  if (normalized.startsWith("/")) {
    const rel = relative(repo, normalized).replace(/\\/g, "/");
    if (rel.startsWith("../") || rel === "..") throw new Error(`path outside repo: ${path}`);
    return stripDotSlash(rel);
  }
  return normalized;
}

function matchesPrefix(path: string, prefix: string): boolean {
  const clean = stripDotSlash(prefix);
  return clean.length > 0 && (path === clean || path.startsWith(`${clean}/`));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizeGitPath(path: string, showPrefix: string): string {
  let normalized = stripDotSlash(path);
  const prefix = stripDotSlash(showPrefix);
  if (prefix && matchesPrefix(normalized, prefix)) {
    normalized = normalized === prefix ? "" : normalized.slice(prefix.length + 1);
  }
  return normalized;
}

function normalizeCommit(value: string): string {
  return value.trim().toLowerCase();
}

function isHexCommit(value: string): boolean {
  return /^[0-9a-f]+$/.test(normalizeCommit(value));
}

function isReasonableCommitPrefix(value: string): boolean {
  const commit = normalizeCommit(value);
  return commit.length >= 7 && isHexCommit(commit);
}

function ledgerCommitMatches(ledgerCommit: string, fullCommit: string): boolean {
  const ledger = normalizeCommit(ledgerCommit);
  const full = normalizeCommit(fullCommit);
  if (!isReasonableCommitPrefix(ledger) || !isReasonableCommitPrefix(full)) return false;
  return ledger === full || full.startsWith(ledger);
}

function commitsCompatible(left: string, right: string): boolean {
  const leftCommit = normalizeCommit(left);
  const rightCommit = normalizeCommit(right);
  if (!isReasonableCommitPrefix(leftCommit) || !isReasonableCommitPrefix(rightCommit)) return false;
  return leftCommit === rightCommit || leftCommit.startsWith(rightCommit) || rightCommit.startsWith(leftCommit);
}

function findLedgerRows(rows: LedgerRow[], seed: string, fullCommit: string): LedgerRow[] {
  return rows.filter((row) => row.seed === seed && ledgerCommitMatches(row.commit, fullCommit));
}

function conflictingRows(rows: LedgerRow[]): boolean {
  if (rows.length <= 1) return false;
  const first = rows[0];
  return rows.some(
    (row) =>
      row.subject !== first.subject ||
      row.policy !== first.policy ||
      row.gates !== first.gates ||
      row.dirty_snapshot !== first.dirty_snapshot,
  );
}

function expectedPathPrefixes(runState: RunState | null, options: Options): string[] {
  const paths = runState?.dirty_state?.paths;
  const prefixes: string[] = [];
  if (Array.isArray(paths)) {
    for (const item of paths as DirtyPath[]) {
      const path = stringValue(item.path);
      const classification = stringValue(item.classification);
      if (
        path &&
        (classification === "expected_seed" ||
          classification === "dispatcher_owned" ||
          classification === "expected_artifact")
      ) {
        prefixes.push(path);
      }
    }
  }
  prefixes.push(...options.expectedPaths);
  return [...new Set(prefixes.map((path) => toRepoPath(path, options.repo)))].sort(compareUtf8);
}

function resolveGitCommit(options: Options, commit: string): string | null {
  if (options.gitExistsFile) {
    return readFileSync(options.gitExistsFile, "utf8").trim() === "true" && isReasonableCommitPrefix(commit)
      ? normalizeCommit(commit)
      : null;
  }
  if (options.skipGit) return isReasonableCommitPrefix(commit) ? normalizeCommit(commit) : null;
  try {
    return execFileSync("git", ["-C", options.repo, "rev-parse", "--verify", `${commit}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim().toLowerCase();
  } catch {
    return null;
  }
}

function gitCommitPaths(options: Options, commit: string): string[] {
  if (options.gitPathsFile) {
    return readFileSync(options.gitPathsFile, "utf8")
      .split(/\r?\n/)
      .map((line) => stripDotSlash(line.trim()))
      .filter(Boolean)
      .sort(compareUtf8);
  }
  if (options.skipGit) return [];
  const showPrefix = execFileSync("git", ["-C", options.repo, "rev-parse", "--show-prefix"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const output = execFileSync(
    "git",
    ["-C", options.repo, "show", "--name-only", "--pretty=format:", commit, "--"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => normalizeGitPath(path, showPrefix))
    .filter(Boolean)
    .sort(compareUtf8);
}

function parseJsonFromOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) throw new Error("command produced no JSON");
  return JSON.parse(text);
}

function runDirtyClassifier(
  options: Options,
  seed: string,
  expectedPaths: string[],
): { dirty: DirtyResult; command: CommandRecord } {
  if (options.dirtyResult) {
    try {
      return { dirty: JSON.parse(readFileSync(options.dirtyResult, "utf8")) as DirtyResult, command: { name: "classify-dirty-state", argv: [], exit_code: 0 } };
    } catch (error) {
      return {
        dirty: { ok: false, summary: { error: (error as Error).message }, unexpected_paths: [], paths: [] },
        command: { name: "classify-dirty-state", argv: [], exit_code: 2 },
      };
    }
  }
  if (options.skipGit) {
    return { dirty: { ok: true, summary: {}, unexpected_paths: [], paths: [] }, command: { name: "classify-dirty-state", argv: [], exit_code: 0 } };
  }
  const argv = [
    "bun",
    "skills/seedstack/scripts/classify-dirty-state.ts",
    "--repo",
    options.repo,
    "--seed",
    seed,
  ];
  if (options.seedstackDir) argv.push("--seedstack-dir", options.seedstackDir);
  argv.push("--dispatch-dir", "tmp/dispatch-work");
  for (const path of expectedPaths) argv.push("--expected-seed", path);
  for (const path of options.preexisting) argv.push("--preexisting", path);
  if (options.pretty) argv.push("--pretty");
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(argv[0], argv.slice(1), {
      cwd: options.repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const execError = error as { stdout?: Buffer | string; status?: number };
    stdout = Buffer.isBuffer(execError.stdout)
      ? execError.stdout.toString("utf8")
      : execError.stdout ?? "";
    exitCode = typeof execError.status === "number" ? execError.status : 2;
  }
  try {
    return {
      dirty: parseJsonFromOutput(stdout) as DirtyResult,
      command: { name: "classify-dirty-state", argv, exit_code: exitCode },
    };
  } catch (error) {
    return {
      dirty: { ok: false, summary: { error: (error as Error).message }, unexpected_paths: [], paths: [] },
      command: { name: "classify-dirty-state", argv, exit_code: exitCode === 0 ? 2 : exitCode },
    };
  }
}

function dirtyResultShape(dirty: DirtyResult): Result["dirty"] {
  const unexpected = Array.isArray(dirty.unexpected_paths)
    ? dirty.unexpected_paths.filter((path): path is string => typeof path === "string").sort(compareUtf8)
    : [];
  return {
    ok: typeof dirty.ok === "boolean" ? dirty.ok : null,
    summary: dirty.summary ?? {},
    unexpected_paths: unexpected,
    paths: Array.isArray(dirty.paths) ? dirty.paths : [],
  };
}

function baseResult(fields: {
  ok: boolean;
  decision: Decision;
  blockers: Finding[];
  warnings: Finding[];
  seed: string | null;
  commit: string | null;
  ledgerRow: LedgerRow | null;
  gitExists: boolean | null;
  gitPaths: string[];
  dirty: Result["dirty"];
  summary: Record<string, unknown>;
  commands?: CommandRecord[];
}): Result {
  return {
    contract: "commit_ledger_check.v1",
    ok: fields.ok,
    decision: fields.decision,
    blockers: fields.blockers.sort((left, right) =>
      compareUtf8(`${left.code}\0${left.path ?? ""}\0${left.message}`, `${right.code}\0${right.path ?? ""}\0${right.message}`),
    ),
    warnings: fields.warnings.sort((left, right) =>
      compareUtf8(`${left.code}\0${left.path ?? ""}\0${left.message}`, `${right.code}\0${right.path ?? ""}\0${right.message}`),
    ),
    seed: fields.seed,
    commit: fields.commit,
    ledger_row: fields.ledgerRow,
    git: { exists: fields.gitExists, paths: fields.gitPaths },
    dirty: fields.dirty,
    summary: fields.summary,
    commands: fields.commands ?? [],
  };
}

function addDirtyBlockers(
  blockers: Finding[],
  dirty: Result["dirty"],
  command: CommandRecord,
): boolean {
  let dirtyBlocked = false;
  if (command.exit_code >= 2) {
    blockers.push({ code: "dirty_classifier_failed", message: `dirty classifier exited ${command.exit_code}` });
    dirtyBlocked = true;
  }
  if (dirty.ok === false) {
    if (dirty.unexpected_paths.length === 0) {
      blockers.push({ code: "dirty_classifier_failed", message: "dirty classifier returned ok=false without unexpected_paths" });
    }
    for (const path of dirty.unexpected_paths) {
      blockers.push({ code: "unexpected_dirty", message: "dirty classifier reported unexpected path", path });
    }
    dirtyBlocked = true;
  }
  if (dirty.ok === null) {
    blockers.push({ code: "invalid_dirty_result", message: "dirty classifier result missing boolean ok" });
    dirtyBlocked = true;
  }
  return dirtyBlocked;
}

function isClosedCleanStatus(status: string | undefined): boolean {
  return status === "closed_clean" || status === "closed/clean" || status === "closed" || status === "clean";
}

function check(options: Options): Result {
  const runState = readRunState(options.runState);
  const latest = runState?.latest_dispatch;
  const seed = options.seed ?? stringValue(latest?.seed_id) ?? null;
  const commit = options.commit ?? stringValue(latest?.commit) ?? null;
  const statePolicy = policyValue(runState?.commit_policy);
  const policy = options.commitPolicy ?? statePolicy ?? "none";
  const warnings: Finding[] = [];
  const blockers: Finding[] = [];
  const emptyDirty = { ok: null, summary: {}, unexpected_paths: [], paths: [] };

  if (!runState) warnings.push({ code: "missing_run_state", message: "run-state.json not found; using CLI args only" });
  if (options.commitPolicy === "per_seed" && statePolicy && statePolicy !== "per_seed") {
    blockers.push({
      code: "commit_policy_mismatch",
      message: `expected per_seed but run-state commit_policy is ${statePolicy}`,
    });
  }

  if (policy !== "per_seed") {
    return baseResult({
      ok: blockers.length === 0,
      decision: blockers.length === 0 ? "ledger_ready" : "blocked_mismatch",
      blockers,
      warnings: [
        ...warnings,
        { code: "non_per_seed_policy", message: `commit policy ${policy} does not require per-seed ledger guard` },
      ],
      seed,
      commit,
      ledgerRow: null,
      gitExists: null,
      gitPaths: [],
      dirty: emptyDirty,
      summary: { commit_policy: policy, run_state: options.runState ?? null, commit_ledger: options.commitLedger ?? null },
    });
  }

  if (!seed) blockers.push({ code: "missing_seed", message: "work order id missing from args and run-state latest_dispatch" });

  const status = stringValue(latest?.status);
  const commitPending = boolValue(latest?.commit_pending);
  const closedClean = isClosedCleanStatus(status);
  if (!closedClean) {
    blockers.push({ code: "dispatch_not_closed_clean", message: `latest_dispatch.status is ${status ?? "missing"}` });
  }
  const expectedPaths = expectedPathPrefixes(runState, options);
  if (expectedPaths.length === 0) {
    blockers.push({
      code: "missing_dirty_state",
      message: "per_seed committed seed requires dirty_state.paths or --expected-path allowlist",
    });
  }
  if (!commit) {
    if (commitPending === true) {
      const commands: CommandRecord[] = [];
      const dirtyRun = seed
        ? runDirtyClassifier(options, seed, expectedPaths)
        : { dirty: { ok: false, unexpected_paths: [], paths: [], summary: {} }, command: { name: "classify-dirty-state" as const, argv: [], exit_code: 2 } };
      commands.push(dirtyRun.command);
      const dirty = dirtyResultShape(dirtyRun.dirty);
      const dirtyBlocked = addDirtyBlockers(blockers, dirty, dirtyRun.command);
      const ok = blockers.length === 0;
      return baseResult({
        ok,
        decision: ok ? "commit_ready" : dirtyBlocked ? "blocked_dirty" : "blocked_mismatch",
        blockers,
        warnings,
        seed,
        commit: null,
        ledgerRow: null,
        gitExists: null,
        gitPaths: [],
        dirty,
        summary: { commit_policy: policy, status: status ?? null, commit_pending: commitPending ?? null, expected_paths: expectedPaths },
        commands,
      });
    }
    blockers.push({ code: "missing_commit", message: "per_seed policy requires latest_dispatch.commit or commit_pending true" });
    return baseResult({
      ok: false,
      decision: blockers.some((finding) => finding.code === "missing_commit")
        ? "blocked_missing_commit"
        : "blocked_mismatch",
      blockers,
      warnings,
      seed,
      commit: null,
      ledgerRow: null,
      gitExists: null,
      gitPaths: [],
      dirty: emptyDirty,
      summary: { commit_policy: policy, status: status ?? null, commit_pending: commitPending ?? null },
    });
  }

  let fullCommit = resolveGitCommit(options, commit);
  if (!fullCommit) {
    blockers.push({ code: "missing_git_commit", message: `git commit does not exist or is too short: ${commit}` });
    fullCommit = normalizeCommit(commit);
  }
  if (stringValue(latest?.commit) && options.commit) {
    const runStateCommit = stringValue(latest?.commit) ?? "";
    const fullRunStateCommit = resolveGitCommit(options, runStateCommit);
    const fullCliCommit = resolveGitCommit(options, options.commit);
    const compatible = fullRunStateCommit && fullCliCommit
      ? fullRunStateCommit === fullCliCommit
      : commitsCompatible(runStateCommit, options.commit);
    if (!compatible) {
      blockers.push({
        code: "run_state_commit_mismatch",
        message: `run-state latest_dispatch.commit ${String(latest?.commit)} does not match CLI commit ${options.commit}`,
      });
    }
  }

  const ledger = parseLedger(options.commitLedger);
  warnings.push(...ledger.warnings);
  const rows = seed ? findLedgerRows(ledger.rows, seed, fullCommit) : [];
  const ledgerRow = rows[0] ?? null;
  if (!ledgerRow) blockers.push({ code: "missing_ledger_row", message: `no ledger row for ${seed ?? "unknown"} ${commit}` });
  if (conflictingRows(rows)) blockers.push({ code: "conflicting_ledger_rows", message: `duplicate ledger rows conflict for ${seed} ${commit}` });
  if (ledgerRow && ledgerRow.policy !== "per_seed") {
    blockers.push({ code: "ledger_policy_mismatch", message: `ledger row policy is ${ledgerRow.policy}` });
  }

  const gitExists = fullCommit === normalizeCommit(commit) ? !blockers.some((finding) => finding.code === "missing_git_commit") : true;
  const gitPaths = gitExists ? gitCommitPaths(options, commit) : [];
  const unexpectedCommitPaths = gitPaths.filter(
    (path) => !expectedPaths.some((prefix) => matchesPrefix(path, prefix)),
  );
  for (const path of unexpectedCommitPaths) {
    blockers.push({ code: "unexpected_commit_path", message: "commit touched path outside expected prefixes", path });
  }

  const commands: CommandRecord[] = [];
  const dirtyRun = seed
    ? runDirtyClassifier(options, seed, expectedPaths)
    : { dirty: { ok: false, unexpected_paths: [], paths: [], summary: {} }, command: { name: "classify-dirty-state" as const, argv: [], exit_code: 2 } };
  commands.push(dirtyRun.command);
  const dirty = dirtyResultShape(dirtyRun.dirty);
  const dirtyBlocked = addDirtyBlockers(blockers, dirty, dirtyRun.command);
  const ok = blockers.length === 0;
  const decision: Decision = ok ? "ledger_ready" : dirtyBlocked ? "blocked_dirty" : "blocked_mismatch";

  return baseResult({
    ok,
    decision,
    blockers,
    warnings,
    seed,
    commit,
    ledgerRow,
    gitExists,
    gitPaths,
    dirty,
    summary: {
      commit_policy: policy,
      status: status ?? null,
      commit_pending: commitPending ?? null,
      expected_paths: expectedPaths,
      ledger_rows_matched: rows.length,
      run_state: options.runState ?? null,
      commit_ledger: options.commitLedger ?? null,
    },
    commands,
  });
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function assertDecision(name: string, result: Result, ok: boolean, decision: Decision): void {
  if (result.ok !== ok || result.decision !== decision) {
    throw new Error(`${name}: got ok=${result.ok} decision=${result.decision}`);
  }
}

function assertEqual(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`${name}: got ${String(actual)} expected ${String(expected)}`);
  }
}

function selfTest(pretty: boolean): void {
  const dir = mkdtempSync(join(tmpdir(), "commit-ledger-check-"));
  try {
    const runStatePath = join(dir, "run-state.json");
    const ledgerPath = join(dir, "commit-ledger.md");
    const gitPathsPath = join(dir, "git-paths.txt");
    const gitExistsPath = join(dir, "git-exists.txt");
    const dirtyOkPath = join(dir, "dirty-ok.json");
    const dirtyBadPath = join(dir, "dirty-bad.json");
    const dirtyFailedPath = join(dir, "dirty-failed.json");
    const writeRunState = (value: unknown) => writeFileSync(runStatePath, `${JSON.stringify(value)}\n`);
    const writeLedger = (rows: string[]) =>
      writeFileSync(
        ledgerPath,
        [
          "| timestamp | seed | commit | subject | gates | dirty snapshot | policy |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...rows,
          "",
        ].join("\n"),
      );
    const baseState = {
      commit_policy: "per_seed",
      latest_dispatch: { seed_id: "S1", status: "closed_clean", commit: "abc1234", commit_pending: false },
      dirty_state: { paths: [{ path: "src/ok.ts", classification: "expected_seed" }] },
    };
    writeFileSync(gitExistsPath, "true\n");
    writeFileSync(gitPathsPath, "src/ok.ts\n");
    writeFileSync(dirtyOkPath, JSON.stringify({ ok: true, summary: {}, unexpected_paths: [], paths: [] }));
    writeFileSync(dirtyBadPath, JSON.stringify({ ok: false, summary: {}, unexpected_paths: ["src/bad.ts"], paths: [{ path: "src/bad.ts" }] }));
    writeFileSync(dirtyFailedPath, JSON.stringify({ ok: false, summary: {}, unexpected_paths: [], paths: [] }));

    writeRunState(baseState);
    writeLedger(["| 2026-01-01T00:00:00Z | S1 | abc1234 | subject | gate | src/ok.ts expected_seed | per_seed |"]);
    const base: Options = {
      repo: dir,
      runState: runStatePath,
      commitLedger: ledgerPath,
      expectedPaths: [],
      preexisting: [],
      skipGit: true,
      pretty,
      selfTest: true,
      gitPathsFile: gitPathsPath,
      gitExistsFile: gitExistsPath,
      dirtyResult: dirtyOkPath,
    };

    const defaultPaths = parseArgs(["--repo", dir, "--seedstack-dir", "."]);
    assertEqual("default run-state path", defaultPaths.runState, runStatePath);
    assertEqual("default commit-ledger path", defaultPaths.commitLedger, ledgerPath);

    const match = check(base);
    assertDecision("ledger row match", match, true, "ledger_ready");

    writeRunState({ ...baseState, latest_dispatch: { seed_id: "S1", status: "closed_clean", commit_pending: false } });
    const missingCommit = check(base);
    assertDecision("missing commit", missingCommit, false, "blocked_missing_commit");

    writeRunState({ ...baseState, latest_dispatch: { seed_id: "S1", status: "closed_clean", commit: "abc1234", commit_pending: false } });
    writeLedger(["| 2026-01-01T00:00:00Z | S1 | abc1234 | subject | gate | src/ok.ts expected_seed | batch |"]);
    const ledgerMismatch = check(base);
    assertDecision("ledger mismatch", ledgerMismatch, false, "blocked_mismatch");

    writeLedger(["| 2026-01-01T00:00:00Z | S1 | abc1234 | subject | gate | src/ok.ts expected_seed | per_seed |"]);
    writeFileSync(gitPathsPath, "src/ok.ts\nsrc/bad.ts\n");
    const unexpectedCommit = check(base);
    assertDecision("unexpected commit path", unexpectedCommit, false, "blocked_mismatch");

    writeFileSync(gitPathsPath, "src/ok.ts\n");
    const dirtyBlocks = check({ ...base, dirtyResult: dirtyBadPath });
    assertDecision("dirty-result blocks", dirtyBlocks, false, "blocked_dirty");

    writeRunState({ ...baseState, latest_dispatch: { seed_id: "S1", status: "closed_clean", commit_pending: true } });
    const pendingDirtyBlocks = check({ ...base, dirtyResult: dirtyBadPath });
    assertDecision("pending commit dirty blocks", pendingDirtyBlocks, false, "blocked_dirty");

    writeRunState({ ...baseState, latest_dispatch: { seed_id: "S1", status: "open", commit_pending: true } });
    const pendingNonClosedBlocks = check(base);
    assertDecision("pending commit non-closed blocks", pendingNonClosedBlocks, false, "blocked_mismatch");

    writeRunState({ ...baseState, latest_dispatch: { seed_id: "S1", status: "closed_clean", commit: "abc1234", commit_pending: false } });
    writeLedger(["| 2026-01-01T00:00:00Z | S1 | a | subject | gate | src/ok.ts expected_seed | per_seed |"]);
    const shortLedgerMismatch = check(base);
    assertDecision("short ledger abbrev mismatch", shortLedgerMismatch, false, "blocked_mismatch");

    writeLedger(["| 2026-01-01T00:00:00Z | S1 | abc1234 | subject | gate | src/ok.ts expected_seed | per_seed |"]);
    const dirtyFalseNoPaths = check({ ...base, dirtyResult: dirtyFailedPath });
    assertDecision("dirty false no paths blocks", dirtyFalseNoPaths, false, "blocked_dirty");

    printJson(
      {
        contract: "commit_ledger_check_self_test.v1",
        ok: true,
        cases: [
          { name: "default seedstack dir paths", ok: true, decision: "ledger_ready" },
          { name: "ledger row match", ok: match.ok, decision: match.decision },
          { name: "missing commit", ok: missingCommit.ok, decision: missingCommit.decision },
          { name: "ledger mismatch", ok: ledgerMismatch.ok, decision: ledgerMismatch.decision },
          { name: "unexpected commit path", ok: unexpectedCommit.ok, decision: unexpectedCommit.decision },
          { name: "dirty-result blocks", ok: dirtyBlocks.ok, decision: dirtyBlocks.decision },
          { name: "pending commit dirty blocks", ok: pendingDirtyBlocks.ok, decision: pendingDirtyBlocks.decision },
          { name: "pending commit non-closed blocks", ok: pendingNonClosedBlocks.ok, decision: pendingNonClosedBlocks.decision },
          { name: "short ledger abbrev mismatch", ok: shortLedgerMismatch.ok, decision: shortLedgerMismatch.decision },
          { name: "dirty false no paths blocks", ok: dirtyFalseNoPaths.ok, decision: dirtyFalseNoPaths.decision },
        ],
      },
      pretty,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function usageError(message: string): Result {
  return {
    contract: "commit_ledger_check.v1",
    ok: false,
    decision: "blocked_mismatch",
    blockers: [{ code: "usage_error", message }],
    warnings: [],
    seed: null,
    commit: null,
    ledger_row: null,
    git: { exists: null, paths: [] },
    dirty: { ok: null, summary: {}, unexpected_paths: [], paths: [] },
    summary: {},
    commands: [],
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
    selfTest(options.pretty);
    return 0;
  }

  try {
    const result = check(options);
    printJson(result, options.pretty);
    if (result.commands.some((command) => command.exit_code >= 2)) return 2;
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson(
      {
        ...usageError((error as Error).message),
        blockers: [{ code: "crash", message: (error as Error).message }],
      },
      options.pretty,
    );
    return 2;
  }
}

process.exit(main());
