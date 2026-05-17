#!/usr/bin/env bun
// Seedstack reconciliation preflight between dispatch and manage/commit.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Finding = {
  code: string;
  message: string;
  path?: string;
};

type ValidationResult = {
  contract?: string;
  ok: boolean;
  blockers?: Finding[];
  hard_blockers?: Finding[];
  soft_blockers?: Finding[];
  warnings?: Finding[];
  summary?: Record<string, unknown>;
};

type DirtyResult = {
  ok: boolean;
  summary?: Record<string, unknown>;
  unexpected_paths?: string[];
  hard_dirty_paths?: string[];
  soft_dirty_paths?: string[];
  paths?: Array<Record<string, unknown>>;
};

type Decision =
  | "manage_reconcile"
  | "commit_ready"
  | "blocked_escalation"
  | "blocked_nonclose_gate"
  | "blocked_failed_gate"
  | "blocked_missing_artifact"
  | "blocked_validation"
  | "blocked_dirty";

type CommandRecord = {
  name: "dispatch-work-validation" | "classify-dirty-state";
  argv: string[];
  exit_code: number;
};

type Options = {
  repo: string;
  seed?: string;
  dispatchRoot: string;
  round?: string;
  roundPath?: string;
  gate?: string;
  validationFile?: string;
  validationPolicy: "strict" | "loop";
  commitPolicy: "per_seed" | "none";
  seedstackDir?: string;
  expectedSeeds: string[];
  preexisting: string[];
  allowUnexpectedDirty: boolean;
  pretty: boolean;
  selfTest: boolean;
  dirtyStatusFile?: string;
};

type Result = {
  contract: "dispatch_reconcile_check.v1";
  ok: boolean;
  decision: Decision;
  blockers: Finding[];
  warnings: Finding[];
  seed: string | null;
  validation: {
    ok: boolean;
    summary: Record<string, unknown>;
    blockers: Finding[];
    hard_blockers: Finding[];
    soft_blockers: Finding[];
    warnings: Finding[];
  };
  dirty?: {
    ok: boolean;
    summary: Record<string, unknown>;
    unexpected_paths: string[];
    hard_dirty_paths: string[];
    soft_dirty_paths: string[];
    paths: Array<Record<string, unknown>>;
  };
  commands: CommandRecord[];
  inputs: Record<string, unknown>;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SEEDSTACK_DIR = dirname(SCRIPT_DIR);
const DISPATCH_WORK_VALIDATOR = resolve(SEEDSTACK_DIR, "..", "dispatch-work", "scripts", "validate-dispatch-work.ts");
const DIRTY_CLASSIFIER = resolve(SCRIPT_DIR, "classify-dirty-state.ts");

const HELP = `check-dispatch-reconcile.ts dispatch_reconcile_check.v1

Usage:
  bun skills/seedstack/scripts/check-dispatch-reconcile.ts --seed <work-id> [args]
  bun skills/seedstack/scripts/check-dispatch-reconcile.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root. Default: cwd.
  --seed <work-id>                 Work order id. Required unless --self-test.
  --dispatch-root <path>           Dispatch root. Default: tmp/dispatch-work.
  --round <N>                      Pass through to dispatch validator.
  --round-path <path>              Pass through to dispatch validator.
  --gate <path|none>               Pass through to dispatch validator.
  --validation-file <path>         Read validator JSON fixture instead of running validator.
  --validation-policy <p>          strict|loop. Default: strict.
  --commit-policy <per_seed|none>  Default: none.
  --seedstack-dir <path>           Expected Seedstack artifact dir for dirty classifier.
  --expected-seed <path-prefix>    Expected seed-owned dirty path prefix. Repeatable.
  --preexisting <path>             Preexisting dirty path. Repeatable.
  --allow-unexpected-dirty         Pass through dirty classifier allowance.
  --dirty-status-file <path>       Raw porcelain or dirty_state_snapshot.v1 for dirty checks.
  --dirty-snapshot <path>          Alias for --dirty-status-file.
  --pretty                         Pretty-print JSON.
  --self-test                      Run fixture tests.
  --help                           Show this help.
`;

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    dispatchRoot: "tmp/dispatch-work",
    commitPolicy: "none",
    validationPolicy: "strict",
    expectedSeeds: [],
    preexisting: [],
    allowUnexpectedDirty: false,
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
      case "--repo":
        options.repo = take();
        break;
      case "--seed":
        options.seed = take();
        break;
      case "--dispatch-root":
        options.dispatchRoot = take();
        break;
      case "--round":
        options.round = take();
        break;
      case "--round-path":
        options.roundPath = take();
        break;
      case "--gate":
        options.gate = take();
        break;
      case "--validation-file":
        options.validationFile = take();
        break;
      case "--validation-policy": {
        const policy = take();
        if (policy !== "strict" && policy !== "loop") throw new Error("--validation-policy must be strict or loop");
        options.validationPolicy = policy;
        break;
      }
      case "--commit-policy": {
        const policy = take();
        if (policy !== "per_seed" && policy !== "none") {
          throw new Error("--commit-policy must be per_seed or none");
        }
        options.commitPolicy = policy;
        break;
      }
      case "--seedstack-dir":
        options.seedstackDir = take();
        break;
      case "--expected-seed":
        options.expectedSeeds.push(take());
        break;
      case "--preexisting":
        options.preexisting.push(take());
        break;
      case "--allow-unexpected-dirty":
        options.allowUnexpectedDirty = true;
        break;
      case "--dirty-status-file":
      case "--dirty-snapshot":
        options.dirtyStatusFile = take();
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--dispatch-root=")) options.dispatchRoot = arg.slice("--dispatch-root=".length);
        else if (arg.startsWith("--round=")) options.round = arg.slice("--round=".length);
        else if (arg.startsWith("--round-path=")) options.roundPath = arg.slice("--round-path=".length);
        else if (arg.startsWith("--gate=")) options.gate = arg.slice("--gate=".length);
        else if (arg.startsWith("--validation-file=")) options.validationFile = arg.slice("--validation-file=".length);
        else if (arg.startsWith("--validation-policy=")) {
          const policy = arg.slice("--validation-policy=".length);
          if (policy !== "strict" && policy !== "loop") throw new Error("--validation-policy must be strict or loop");
          options.validationPolicy = policy;
        }
        else if (arg.startsWith("--commit-policy=")) {
          const policy = arg.slice("--commit-policy=".length);
          if (policy !== "per_seed" && policy !== "none") {
            throw new Error("--commit-policy must be per_seed or none");
          }
          options.commitPolicy = policy;
        } else if (arg.startsWith("--seedstack-dir=")) options.seedstackDir = arg.slice("--seedstack-dir=".length);
        else if (arg.startsWith("--expected-seed=")) options.expectedSeeds.push(arg.slice("--expected-seed=".length));
        else if (arg.startsWith("--preexisting=")) options.preexisting.push(arg.slice("--preexisting=".length));
        else if (arg.startsWith("--dirty-status-file=")) options.dirtyStatusFile = arg.slice("--dirty-status-file=".length);
        else if (arg.startsWith("--dirty-snapshot=")) options.dirtyStatusFile = arg.slice("--dirty-snapshot=".length);
        else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  return options;
}

function runJsonCommand(
  name: CommandRecord["name"],
  argv: string[],
  repo: string,
): { value: unknown; command: CommandRecord } {
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(argv[0], argv.slice(1), {
      cwd: repo,
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
  return { value: parseJsonFromOutput(stdout), command: { name, argv, exit_code: exitCode } };
}

function parseJsonFromOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) throw new Error("command produced no JSON");
  try {
    return JSON.parse(text);
  } catch {
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== "{") continue;
      try {
        return JSON.parse(text.slice(index));
      } catch {
        // Keep scanning; child tools should print one JSON object.
      }
    }
    throw new Error("command output did not contain parseable JSON");
  }
}

function runValidation(options: Options): { validation: ValidationResult; commands: CommandRecord[] } {
  if (options.validationFile) {
    return {
      validation: JSON.parse(readFileSync(options.validationFile, "utf8")) as ValidationResult,
      commands: [],
    };
  }

  const argv = [
    "bun",
    DISPATCH_WORK_VALIDATOR,
    "--seed",
    options.seed ?? "",
    "--repo",
    options.repo,
    "--dispatch-root",
    options.dispatchRoot,
    "--validation-policy",
    options.validationPolicy,
    "--pretty",
  ];
  if (options.round) argv.push("--round", options.round);
  if (options.roundPath) argv.push("--round-path", options.roundPath);
  if (options.gate) argv.push("--gate", options.gate);
  if (options.dirtyStatusFile) argv.push("--dirty-status-file", options.dirtyStatusFile);

  const output = runJsonCommand("dispatch-work-validation", argv, options.repo);
  return { validation: output.value as ValidationResult, commands: [output.command] };
}

function runDirty(options: Options): { dirty: DirtyResult; command: CommandRecord } {
  const dispatchDir = options.commitPolicy === "per_seed"
    ? options.dispatchRoot
    : join(options.dispatchRoot, options.seed ?? "");
  const argv = [
    "bun",
    DIRTY_CLASSIFIER,
    "--repo",
    options.repo,
    "--seed",
    options.seed ?? "",
    "--dispatch-dir",
    dispatchDir,
  ];
  if (options.seedstackDir) argv.push("--seedstack-dir", options.seedstackDir);
  for (const expected of options.expectedSeeds) argv.push("--expected-seed", expected);
  for (const preexisting of options.preexisting) argv.push("--preexisting", preexisting);
  if (options.allowUnexpectedDirty) argv.push("--allow-unexpected");
  argv.push("--dirty-policy", options.commitPolicy === "per_seed" ? "commit" : "strict");
  if (options.dirtyStatusFile) argv.push("--dirty-snapshot", options.dirtyStatusFile);
  if (options.pretty) argv.push("--pretty");

  const output = runJsonCommand("classify-dirty-state", argv, options.repo);
  return { dirty: output.value as DirtyResult, command: output.command };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function validationDecision(blockers: Finding[]): Decision {
  const haystack = blockers
    .map((finding) => `${finding.code} ${finding.path ?? ""} ${finding.message}`)
    .join("\n")
    .toLowerCase();
  if (/\bescalat/.test(haystack)) return "blocked_escalation";
  if (/\b(missing|artifact|status|report|hash)\b/.test(haystack)) return "blocked_missing_artifact";
  if (/\b(gate|failed|verdict|block|risk)\b/.test(haystack)) return "blocked_failed_gate";
  return "blocked_validation";
}

function normalizeFindings(findings: Finding[] | undefined): Finding[] {
  return [...(findings ?? [])].sort((left, right) =>
    compareUtf8(`${left.code}\0${left.path ?? ""}\0${left.message}`, `${right.code}\0${right.path ?? ""}\0${right.message}`),
  );
}

function validationPayload(
  ok: boolean,
  summary: Record<string, unknown>,
  blockers: Finding[],
  hardBlockers: Finding[],
  softBlockers: Finding[],
  warnings: Finding[],
): Result["validation"] {
  return {
    ok,
    summary,
    blockers,
    hard_blockers: hardBlockers,
    soft_blockers: softBlockers,
    warnings,
  };
}

function gateNonCloseBlocker(summary: Record<string, unknown>): Finding | null {
  const gate = summary.gate;
  if (!gate || typeof gate !== "object") return null;
  const decision = (gate as { decision?: unknown }).decision;
  if (typeof decision !== "string") return null;
  const normalized = decision.toLowerCase();
  if (normalized !== "retry" && normalized !== "escalate") return null;
  return {
    code: normalized === "escalate" ? "gate_escalation" : "gate_retry",
    message: `gate decision ${decision} requires manage reconciliation`,
  };
}

function gateCloseBlocker(summary: Record<string, unknown>): Finding | null {
  const gate = summary.gate;
  if (!gate || typeof gate !== "object") {
    return {
      code: "missing_close_gate",
      message: "manage reconciliation requires validator summary with gate decision close",
    };
  }
  const decision = (gate as { decision?: unknown }).decision;
  if (typeof decision !== "string") {
    return {
      code: "missing_close_gate_decision",
      message: "manage reconciliation requires gate decision close",
    };
  }
  if (decision.toLowerCase() !== "close") {
    return {
      code: "gate_nonclose_decision",
      message: `gate decision ${decision} is not reconciled; manage reconciliation requires close`,
    };
  }
  const acceptedPaths = (gate as { acceptedPaths?: unknown }).acceptedPaths;
  if (typeof acceptedPaths !== "number" || acceptedPaths < 1) {
    return {
      code: "gate_missing_evidence_paths",
      message: "manage reconciliation requires close gate evidence paths",
    };
  }
  return null;
}

function validationContractBlocker(validation: ValidationResult): Finding | null {
  if (validation.contract === "dispatch-work-validation.v1") return null;
  return {
    code: "invalid_validation_contract",
    message: `manage reconciliation requires dispatch-work-validation.v1, got ${validation.contract ?? "<missing>"}`,
  };
}

function dirtyStatusBlocker(summary: Record<string, unknown>): Finding | null {
  const statuses = summary.statuses;
  if (!statuses || typeof statuses !== "object") return null;
  const hardDirty = (statuses as { hard_dirty?: unknown }).hard_dirty;
  if (typeof hardDirty === "number") {
    if (hardDirty <= 0) return null;
    return {
      code: "validator_hard_dirty_status",
      message: `validator summary reports ${hardDirty} hard dirty status artifact${hardDirty === 1 ? "" : "s"}`,
    };
  }
  const dirty = (statuses as { dirty?: unknown }).dirty;
  if (typeof dirty !== "number" || dirty <= 0) return null;
  return {
    code: "validator_dirty_status",
    message: `validator summary reports ${dirty} dirty status artifact${dirty === 1 ? "" : "s"}`,
  };
}

function isQueueMutationBlocker(finding: Finding): boolean {
  return finding.code === "gate_queue_mutation_dirty";
}

function pathValue(path: Record<string, unknown>): string {
  return typeof path.path === "string" ? path.path : "";
}

function statusValue(path: Record<string, unknown>): string {
  return typeof path.status === "string" ? path.status : "";
}

function classificationValue(path: Record<string, unknown>): string {
  return typeof path.classification === "string" ? path.classification : "";
}

function isQueuePath(path: string): boolean {
  return path.startsWith(".seeds/");
}

function isConflictStatus(status: string): boolean {
  const code = status.trim();
  return ["UU", "AA", "DD", "AU", "UA", "DU", "UD"].includes(code) || code.includes("U");
}

function isDeletedQueuePath(path: Record<string, unknown>): boolean {
  return isQueuePath(pathValue(path)) && statusValue(path).includes("D");
}

function normalizedCommitDirty(dirty: DirtyResult): DirtyResult {
  const paths = (dirty.paths ?? []).map((entry) => {
    const path = pathValue(entry);
    if (!isQueuePath(path)) return entry;
    return {
      ...entry,
      classification: "expected_queue_mutation",
      reason: "Seedstack per_seed commit reconcile allows manager-owned queue mutation",
    };
  });
  const unexpected = paths
    .filter((entry) => classificationValue(entry) === "unexpected")
    .map((entry) => pathValue(entry))
    .filter(Boolean);
  const hardDirty = paths
    .filter((entry) => {
      const status = statusValue(entry);
      if (isConflictStatus(status) || isDeletedQueuePath(entry)) return true;
      return classificationValue(entry) === "unexpected";
    })
    .map((entry) => pathValue(entry))
    .filter(Boolean);
  const softDirty = paths
    .filter((entry) => classificationValue(entry) === "unexpected" && !hardDirty.includes(pathValue(entry)))
    .map((entry) => pathValue(entry))
    .filter(Boolean);
  const summary: Record<string, unknown> = { ...(dirty.summary ?? {}) };
  summary.expected_queue_mutation = paths.filter((entry) => classificationValue(entry) === "expected_queue_mutation").length;
  summary.unexpected = unexpected.length;
  return {
    ...dirty,
    ok: hardDirty.length === 0,
    summary,
    paths,
    unexpected_paths: unexpected,
    hard_dirty_paths: hardDirty,
    soft_dirty_paths: softDirty,
  };
}

function commitDirtyAllowsValidationQueueMutation(dirty: DirtyResult): boolean {
  const paths = dirty.paths ?? [];
  if (paths.length === 0) return false;
  if (!paths.some((entry) => isQueuePath(pathValue(entry)))) return false;
  return paths.every((entry) => {
    const classification = classificationValue(entry);
    const path = pathValue(entry);
    return classification === "expected_seed" ||
      classification === "expected_artifact" ||
      classification === "preexisting_user" ||
      classification === "expected_queue_mutation" ||
      isQueuePath(path);
  });
}

function check(options: Options): Result {
  if (!options.seed) throw new Error("--seed required unless --self-test");

  const commands: CommandRecord[] = [];
  const { validation, commands: validationCommands } = runValidation(options);
  commands.push(...validationCommands);

  const validationHardBlockers = normalizeFindings(validation.hard_blockers ?? validation.blockers);
  const validationSoftBlockers = normalizeFindings(validation.soft_blockers);
  const validationWarnings = normalizeFindings(validation.warnings);
  const baseWarnings = [...validationWarnings, ...validationSoftBlockers.map((finding) => ({ ...finding, code: `soft_${finding.code}` }))];
  const validationSummary = (validation.summary ?? {}) as Record<string, unknown>;
  const contractBlocker = validationContractBlocker(validation);
  const nonCloseGateBlocker = gateNonCloseBlocker(validationSummary);
  const loopNonCloseGate = options.validationPolicy === "loop" && options.commitPolicy === "none" && !!nonCloseGateBlocker;

  if (contractBlocker) {
    return {
      contract: "dispatch_reconcile_check.v1",
      ok: false,
      decision: "blocked_validation",
      blockers: [contractBlocker],
      warnings: baseWarnings,
      seed: options.seed,
      validation: validationPayload(false, validationSummary, [contractBlocker], [contractBlocker], validationSoftBlockers, validationWarnings),
      commands,
      inputs: inputSummary(options),
    };
  }

  if (nonCloseGateBlocker && !loopNonCloseGate) {
    const blockers = [nonCloseGateBlocker, ...validationHardBlockers];
    return {
      contract: "dispatch_reconcile_check.v1",
      ok: false,
      decision: nonCloseGateBlocker.code === "gate_escalation" ? "blocked_escalation" : "blocked_nonclose_gate",
      blockers,
      warnings: baseWarnings,
      seed: options.seed,
      validation: validationPayload(validation.ok, validationSummary, blockers, blockers, validationSoftBlockers, validationWarnings),
      commands,
      inputs: inputSummary(options),
    };
  }

  const validationQueueMutationOnly = options.commitPolicy === "per_seed" &&
    validationHardBlockers.length > 0 &&
    validationHardBlockers.every(isQueueMutationBlocker);

  if ((!validation.ok || validationHardBlockers.length > 0) && !loopNonCloseGate && !validationQueueMutationOnly) {
    const decision = validationDecision(validationHardBlockers);
    return {
      contract: "dispatch_reconcile_check.v1",
      ok: false,
      decision,
      blockers: validationHardBlockers,
      warnings: baseWarnings,
      seed: options.seed,
      validation: validationPayload(false, validationSummary, validationHardBlockers, validationHardBlockers, validationSoftBlockers, validationWarnings),
      commands,
      inputs: inputSummary(options),
    };
  }

  const nonCloseGateWarnings = loopNonCloseGate
    ? [
        nonCloseGateBlocker,
        ...validationHardBlockers.map((finding) => ({ ...finding, code: `loop_validation_${finding.code}` })),
      ].filter((finding): finding is Finding => !!finding)
    : [];

  const closeBlocker = gateCloseBlocker(validationSummary);
  const dirtyBlocker = dirtyStatusBlocker(validationSummary);
  if ((closeBlocker || dirtyBlocker) && !loopNonCloseGate) {
    const blockers = [closeBlocker, dirtyBlocker].flatMap((finding) => (finding ? [finding] : []));
    return {
      contract: "dispatch_reconcile_check.v1",
      ok: false,
      decision: closeBlocker?.code === "gate_nonclose_decision" ? "blocked_nonclose_gate" : "blocked_missing_artifact",
      blockers,
      warnings: baseWarnings,
      seed: options.seed,
      validation: validationPayload(false, validationSummary, blockers, blockers, validationSoftBlockers, validationWarnings),
      commands,
      inputs: inputSummary(options),
    };
  }

  if (options.commitPolicy === "none") {
    return {
      contract: "dispatch_reconcile_check.v1",
      ok: true,
      decision: "manage_reconcile",
      blockers: [],
      warnings: [...baseWarnings, ...nonCloseGateWarnings],
      seed: options.seed,
      validation: validationPayload(
        !loopNonCloseGate,
        validationSummary,
        [],
        [],
        validationSoftBlockers,
        [...validationWarnings, ...nonCloseGateWarnings],
      ),
      commands,
      inputs: inputSummary(options),
    };
  }

  const dirtyRun = runDirty(options);
  const dirty = normalizedCommitDirty(dirtyRun.dirty);
  const command = dirtyRun.command;
  commands.push(command);
  const unexpected = dirty.unexpected_paths ?? [];
  const hardDirty = dirty.hard_dirty_paths ?? [];
  const softDirty = dirty.soft_dirty_paths ?? [];
  const dirtySummary = (dirty.summary ?? {}) as Record<string, unknown>;
  const queueMutationAccepted = validationQueueMutationOnly && commitDirtyAllowsValidationQueueMutation(dirty);
  const expectedQueueMutationWarnings = queueMutationAccepted
    ? validationHardBlockers.map((finding) => ({
        ...finding,
        code: "expected_queue_mutation",
        message: "Seedstack per_seed commit reconcile accepted manager-owned .seeds/** mutation",
      }))
    : [];
  const dirtyWarnings = options.allowUnexpectedDirty && unexpected.length > 0
    ? [{ code: "unexpected_dirty_allowed", message: "--allow-unexpected-dirty permitted unexpected paths" }]
    : [];
  const effectiveDirtyOk = dirty.ok && (!validationQueueMutationOnly || queueMutationAccepted);
  const dirtyBlockers = effectiveDirtyOk
    ? []
    : [
        ...(validationQueueMutationOnly && !queueMutationAccepted
          ? validationHardBlockers.map((finding) => ({
              ...finding,
              message: `${finding.message}; dirty classifier did not confirm only expected .seeds/** queue paths plus expected seed paths`,
            }))
          : []),
        ...(hardDirty.length > 0 ? hardDirty : unexpected).map((path) => ({
          code: hardDirty.includes(path) ? "hard_dirty" : "unexpected_dirty",
          message: hardDirty.includes(path) ? "dirty classifier reported hard dirty path" : "dirty classifier reported unexpected path",
          path,
        })),
      ];
  if (!effectiveDirtyOk && dirtyBlockers.length === 0) {
    dirtyBlockers.push({ code: "dirty_classifier_failed", message: "dirty classifier returned ok=false without path blockers" });
  }

  return {
    contract: "dispatch_reconcile_check.v1",
    ok: effectiveDirtyOk,
    decision: effectiveDirtyOk ? "commit_ready" : "blocked_dirty",
    blockers: dirtyBlockers,
    warnings: [...baseWarnings, ...expectedQueueMutationWarnings, ...dirtyWarnings],
    seed: options.seed,
    validation: validationPayload(true, validationSummary, [], [], validationSoftBlockers, validationWarnings),
    dirty: {
      ok: effectiveDirtyOk,
      summary: dirtySummary,
      unexpected_paths: unexpected,
      hard_dirty_paths: hardDirty,
      soft_dirty_paths: softDirty,
      paths: dirty.paths ?? [],
    },
    commands,
    inputs: inputSummary(options),
  };
}

function inputSummary(options: Options): Record<string, unknown> {
  return {
    repo: options.repo,
    seed: options.seed ?? null,
    dispatch_root: options.dispatchRoot,
    round: options.round ?? null,
    round_path: options.roundPath ?? null,
    gate: options.gate ?? null,
    validation_file: options.validationFile ?? null,
    validation_policy: options.validationPolicy,
    commit_policy: options.commitPolicy,
    seedstack_dir: options.seedstackDir ?? null,
    expected_seed: options.expectedSeeds,
    preexisting: options.preexisting,
    allow_unexpected_dirty: options.allowUnexpectedDirty,
    dirty_status_file: options.dirtyStatusFile ?? null,
  };
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function exitCodeFor(result: Result): 0 | 1 | 2 {
  if (result.commands.some((command) => command.exit_code >= 2)) return 2;
  return result.ok ? 0 : 1;
}

function assertDecision(name: string, result: Result, ok: boolean, decision: Decision): void {
  if (result.ok !== ok || result.decision !== decision) {
    throw new Error(`${name}: got ok=${result.ok} decision=${result.decision}`);
  }
}

function selfTest(pretty: boolean): void {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-reconcile-"));
  try {
    const writeFixture = (name: string, value: unknown) => {
      const path = join(dir, name);
      writeFileSync(path, `${JSON.stringify(value)}\n`);
      return path;
    };

    const missingFixture = writeFixture("missing.json", {
      contract: "dispatch-work-validation.v1",
      ok: false,
      blockers: [{ code: "missing_status_files", message: "no status artifacts found" }],
      warnings: [],
      summary: { seed: "S1" },
    });
    const gateFixture = writeFixture("gate.json", {
      contract: "dispatch-work-validation.v1",
      ok: false,
      blockers: [{ code: "gate_verdict_block", message: "gate verdict block" }],
      warnings: [],
      summary: { seed: "S1" },
    });
    const missingGateFixture = writeFixture("missing-gate.json", {
      contract: "dispatch-work-validation.v1",
      ok: false,
      blockers: [{ code: "missing_gate", message: "gate artifact missing" }],
      warnings: [],
      summary: { seed: "S1" },
    });
    const okFixture = writeFixture("ok.json", {
      contract: "dispatch-work-validation.v1",
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 4, dirty: 0 }, gate: { present: true, decision: "close", acceptedPaths: 1 } },
    });
    const queueMutationFixture = writeFixture("queue-mutation.json", {
      contract: "dispatch-work-validation.v1",
      ok: false,
      blockers: [{ code: "gate_queue_mutation_dirty", message: "dispatch-work must not mutate queue state paths: .seeds/issues.jsonl" }],
      hard_blockers: [{ code: "gate_queue_mutation_dirty", message: "dispatch-work must not mutate queue state paths: .seeds/issues.jsonl" }],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 4, dirty: 0 }, gate: { present: true, decision: "close", acceptedPaths: 1 } },
    });
    const retryFixture = writeFixture("retry.json", {
      contract: "dispatch-work-validation.v1",
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 4, dirty: 0 }, gate: { present: true, decision: "retry", acceptedPaths: 1 } },
    });
    const noGateFixture = writeFixture("no-gate.json", {
      contract: "dispatch-work-validation.v1",
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 4, dirty: 0 }, gate: { present: false, acceptedPaths: 0 } },
    });
    const emptyEvidenceFixture = writeFixture("empty-evidence.json", {
      contract: "dispatch-work-validation.v1",
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 4, dirty: 0 }, gate: { present: true, decision: "close", acceptedPaths: 0 } },
    });
    const dirtyOkFixture = writeFixture("dirty-ok.json", {
      contract: "dispatch-work-validation.v1",
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 3, dirty: 1 }, gate: { present: true, decision: "close", acceptedPaths: 1 } },
    });
    const escalationFixture = writeFixture("escalation.json", {
      contract: "dispatch-work-validation.v1",
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", gate: { present: true, decision: "escalate", acceptedPaths: 1 } },
    });
    const legacyFixture = writeFixture("legacy.json", {
      ok: true,
      blockers: [],
      warnings: [],
      summary: { seed: "S1", reports: { checked: 4 }, statuses: { checked: 4, clean: 4, dirty: 0 }, gate: { present: true, decision: "close", acceptedPaths: 1 } },
    });
    const statusFile = join(dir, "status.txt");
    writeFileSync(statusFile, " M src/unexpected.ts\n");
    const queueMutationStatusFile = join(dir, "queue-mutation-status.txt");
    writeFileSync(queueMutationStatusFile, " M .seeds/issues.jsonl\n M src/owned.ts\n");
    const hardDirtyStatusFile = join(dir, "hard-status.txt");
    writeFileSync(hardDirtyStatusFile, "UU src/expected.ts\n");

    const base: Options = {
      repo: resolve("."),
      seed: "S1",
      dispatchRoot: "tmp/dispatch-work",
      validationPolicy: "strict",
      commitPolicy: "none",
      expectedSeeds: [],
      preexisting: [],
      allowUnexpectedDirty: false,
      pretty,
      selfTest: true,
    };

    const cases = [
      { name: "missing artifact", result: check({ ...base, validationFile: missingFixture }), ok: false, decision: "blocked_missing_artifact" as Decision },
      { name: "missing gate artifact", result: check({ ...base, validationFile: missingGateFixture }), ok: false, decision: "blocked_missing_artifact" as Decision },
      { name: "failed gate", result: check({ ...base, validationFile: gateFixture }), ok: false, decision: "blocked_failed_gate" as Decision },
      { name: "gate escalation", result: check({ ...base, validationFile: escalationFixture }), ok: false, decision: "blocked_escalation" as Decision },
      {
        name: "loop gate escalation",
        result: check({ ...base, validationFile: escalationFixture, validationPolicy: "loop" }),
        ok: true,
        decision: "manage_reconcile" as Decision,
      },
      { name: "manage reconcile", result: check({ ...base, validationFile: okFixture }), ok: true, decision: "manage_reconcile" as Decision },
      {
        name: "loop retry gate manages",
        result: check({ ...base, validationFile: retryFixture, validationPolicy: "loop" }),
        ok: true,
        decision: "manage_reconcile" as Decision,
      },
      { name: "retry gate blocks", result: check({ ...base, validationFile: retryFixture }), ok: false, decision: "blocked_nonclose_gate" as Decision },
      { name: "no close gate blocks", result: check({ ...base, validationFile: noGateFixture }), ok: false, decision: "blocked_missing_artifact" as Decision },
      { name: "empty gate evidence blocks", result: check({ ...base, validationFile: emptyEvidenceFixture }), ok: false, decision: "blocked_missing_artifact" as Decision },
      { name: "dirty summary blocks", result: check({ ...base, validationFile: dirtyOkFixture }), ok: false, decision: "blocked_missing_artifact" as Decision },
      { name: "legacy validator json blocks", result: check({ ...base, validationFile: legacyFixture }), ok: false, decision: "blocked_validation" as Decision },
      { name: "queue mutation manage blocks", result: check({ ...base, validationFile: queueMutationFixture }), ok: false, decision: "blocked_validation" as Decision },
      {
        name: "queue mutation commit ready",
        result: check({
          ...base,
          validationFile: queueMutationFixture,
          commitPolicy: "per_seed",
          dirtyStatusFile: queueMutationStatusFile,
          expectedSeeds: ["src/owned.ts"],
        }),
        ok: true,
        decision: "commit_ready" as Decision,
      },
      {
        name: "dirty unexpected",
        result: check({
          ...base,
          validationFile: okFixture,
          commitPolicy: "per_seed",
          dirtyStatusFile: statusFile,
        }),
        ok: false,
        decision: "blocked_dirty" as Decision,
      },
      {
        name: "dirty hard expected",
        result: check({
          ...base,
          validationFile: okFixture,
          commitPolicy: "per_seed",
          dirtyStatusFile: hardDirtyStatusFile,
          expectedSeeds: ["src/expected.ts"],
        }),
        ok: false,
        decision: "blocked_dirty" as Decision,
      },
    ];

    for (const item of cases) assertDecision(item.name, item.result, item.ok, item.decision);
    const gateEscalation = cases.find((item) => item.name === "gate escalation")?.result;
    if (!gateEscalation?.blockers.some((finding) => finding.code === "gate_escalation")) {
      throw new Error("gate escalation: missing gate_escalation blocker");
    }
    const loopGateEscalation = cases.find((item) => item.name === "loop gate escalation")?.result;
    if (!loopGateEscalation?.warnings.some((finding) => finding.code === "gate_escalation")) {
      throw new Error("loop gate escalation: missing gate_escalation warning");
    }
    const dirtyUnexpected = cases.find((item) => item.name === "dirty unexpected")?.result;
    if (dirtyUnexpected?.dirty?.paths?.[0]?.path !== "src/unexpected.ts") {
      throw new Error("dirty unexpected: dirty.paths passthrough missing");
    }
    const queueMutationCommitReady = cases.find((item) => item.name === "queue mutation commit ready")?.result;
    if (!queueMutationCommitReady?.warnings.some((finding) => finding.code === "expected_queue_mutation")) {
      throw new Error("queue mutation commit ready: missing expected_queue_mutation warning");
    }
    if (!queueMutationCommitReady?.dirty?.paths?.some((path) =>
      path.path === ".seeds/issues.jsonl" && path.classification === "expected_queue_mutation"
    )) {
      throw new Error("queue mutation commit ready: queue path was not normalized");
    }
    const dirtyHardExpected = cases.find((item) => item.name === "dirty hard expected")?.result;
    if (!dirtyHardExpected?.blockers.some((finding) => finding.code === "hard_dirty" && finding.path === "src/expected.ts")) {
      throw new Error("dirty hard expected: missing hard_dirty blocker");
    }
    const sortedFindings = normalizeFindings([
      { code: "same", message: "é" },
      { code: "same", message: "z" },
    ]);
    if (sortedFindings.map((finding) => finding.message).join(",") !== "z,é") {
      throw new Error("utf8 sort: expected byte order z before é");
    }
    printJson(
      {
        contract: "dispatch_reconcile_check_self_test.v1",
        ok: true,
        cases: cases.map((item) => ({
          name: item.name,
          ok: item.result.ok,
          decision: item.result.decision,
        })),
      },
      pretty,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): number {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    printJson(
      {
        contract: "dispatch_reconcile_check.v1",
        ok: false,
        decision: "blocked_validation",
        blockers: [{ code: "usage_error", message: (error as Error).message }],
        warnings: [],
        seed: null,
        validation: { ok: false, summary: {}, blockers: [], hard_blockers: [], soft_blockers: [], warnings: [] },
        commands: [],
        inputs: {},
      },
      false,
    );
    return 2;
  }

  if (options.selfTest) {
    selfTest(options.pretty);
    return 0;
  }

  try {
    const result = check(options);
    printJson(result, options.pretty);
    return exitCodeFor(result);
  } catch (error) {
    printJson(
      {
        contract: "dispatch_reconcile_check.v1",
        ok: false,
        decision: "blocked_validation",
        blockers: [{ code: "checker_crash", message: (error as Error).message }],
        warnings: [],
        seed: options.seed ?? null,
        validation: { ok: false, summary: {}, blockers: [], hard_blockers: [], soft_blockers: [], warnings: [] },
        commands: [],
        inputs: inputSummary(options),
      },
      options.pretty,
    );
    return 2;
  }
}

process.exit(main());
