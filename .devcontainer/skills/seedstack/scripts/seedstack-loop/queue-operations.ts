// Queue operation normalization, validation, and execution.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ChildResult } from "../child-supervisor.ts";
import {
  type JsonObject,
  type QueueOperation,
  type QueueOperationCommand,
  isObject,
  stringField,
  stringArray,
  exactStringArray,
} from "./types.ts";

export function queueDirtyPathsFromStatus(statusText: string): string[] {
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

export function queueDirtyPaths(repo: string): string[] {
  const proc = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", ".seeds"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(`queue_dirty_preflight_git_status_failed: ${(proc.stderr || "").trim() || "git status failed"}`);
  }
  return queueDirtyPathsFromStatus(proc.stdout);
}

export function proposedQueueOperations(result: ChildResult): JsonObject[] {
  return Array.isArray(result.proposed_queue_operations) ? result.proposed_queue_operations.filter(isObject) : [];
}

export function normalizeQueueOperation(value: JsonObject, index: number): QueueOperation | { error: string; detail?: unknown } {
  const opType = stringField(value.op_type);
  const targetSeed = stringField(value.target_seed);
  const rationale = stringField(value.rationale);
  if (!opType) return { error: "missing_op_type", detail: value };
  if (!targetSeed) return { error: "missing_target_seed", detail: value };
  if (!rationale) return { error: "missing_rationale", detail: value };
  const sourceArtifactRefs = exactStringArray(value.source_artifact_refs);
  if (!sourceArtifactRefs) return { error: "invalid_source_artifact_refs", detail: value.source_artifact_refs };
  const expectedPreconditions = exactStringArray(value.expected_preconditions);
  if (!expectedPreconditions) return { error: "invalid_expected_preconditions", detail: value.expected_preconditions };
  return {
    op_type: opType,
    target_seed: targetSeed,
    rationale,
    source_artifact_refs: sourceArtifactRefs,
    expected_preconditions: expectedPreconditions,
    details: isObject(value.details) ? value.details : {},
    index,
  };
}

export function scanIssueById(scan: JsonObject, id: string): JsonObject | null {
  const issues = Array.isArray(scan.issues) ? scan.issues : [];
  for (const issue of issues) {
    if (isObject(issue) && issue.id === id) return issue;
  }
  return null;
}

export function validateQueueOperationPreconditions(
  op: QueueOperation,
  seed: string,
  preScan: JsonObject,
  reconcilePath: string,
  repo: string,
): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const supported = new Set(["close-current", "create-follow-up", "add-dependency", "adjust-labels", "no-op"]);
  if (!supported.has(op.op_type)) blockers.push(`unsupported operation ${op.op_type}`);
  const target = op.op_type === "create-follow-up" ? null : scanIssueById(preScan, op.target_seed);
  if (op.op_type === "close-current" && op.target_seed !== seed) {
    blockers.push(`close-current target ${op.target_seed} is not current seed ${seed}`);
  }
  if (op.op_type === "close-current" && target && stringField(target.status) === "closed") {
    blockers.push(`close-current target ${op.target_seed} is closed in fresh scan`);
  }
  if (op.op_type === "close-current" && target && stringField(target.status) !== "open") {
    blockers.push(`close-current target ${op.target_seed} is not open in fresh scan`);
  }
  if (op.op_type !== "create-follow-up" && !target) {
    if (!target) blockers.push(`target seed ${op.target_seed} not present in fresh scan`);
  }
  for (const ref of op.source_artifact_refs) {
    const absolute = isAbsolute(ref) ? ref : resolve(repo, ref);
    if (!existsSync(absolute)) blockers.push(`source artifact missing: ${ref}`);
  }
  for (const precondition of op.expected_preconditions) {
    const lower = precondition.toLowerCase();
    if (lower.includes("still open")) {
      const match = /\bseed\s+([A-Za-z0-9._-]+)\s+is\s+still\s+open\b/i.exec(precondition);
      const targetId = match?.[1] ?? op.target_seed;
      const target = scanIssueById(preScan, targetId);
      if (!target) blockers.push(`precondition target ${targetId} missing from fresh scan`);
      else if (stringField(target.status) === "closed") blockers.push(`precondition target ${targetId} is closed`);
    } else if (lower.includes("dispatch reconcile result") || lower.includes("reconcile")) {
      if (!existsSync(reconcilePath)) blockers.push(`reconcile artifact missing: ${reconcilePath}`);
    } else {
      warnings.push(`unsupported precondition treated as advisory: ${precondition}`);
    }
  }
  return { blockers, warnings };
}

export function buildQueueOperationArgv(op: QueueOperation, seedCli: string): string[] | { error: string } {
  switch (op.op_type) {
    case "no-op":
      return [];
    case "close-current":
      return [seedCli, "close", op.target_seed, "--json"];
    case "create-follow-up": {
      const title = stringField(op.details.title);
      if (!title) return { error: "create-follow-up requires details.title" };
      const argv = [seedCli, "create", "--title", title, "--type", stringField(op.details.type) ?? "task"];
      if (typeof op.details.priority === "number" && Number.isFinite(op.details.priority)) {
        argv.push("--priority", String(op.details.priority));
      }
      const labels = stringArray(op.details.labels);
      if (labels.length > 0) argv.push("--labels", labels.join(","));
      const description = stringField(op.details.description) ?? stringField(op.details.body);
      if (description) argv.push("--description", description);
      argv.push("--json");
      return argv;
    }
    case "add-dependency": {
      const dependsOn = stringField(op.details.depends_on) ?? stringField(op.details.dependency) ?? stringField(op.details.blocked_by);
      if (!dependsOn) return { error: "add-dependency requires details.depends_on" };
      return [seedCli, "dep", "add", op.target_seed, dependsOn, "--json"];
    }
    case "adjust-labels": {
      const add = stringArray(op.details.add);
      const remove = stringArray(op.details.remove);
      if (add.length === 0 && remove.length === 0) return { error: "adjust-labels requires details.add or details.remove" };
      const argv = [seedCli, "update", op.target_seed];
      for (const label of add) argv.push("--add-label", label);
      for (const label of remove) argv.push("--remove-label", label);
      argv.push("--json");
      return argv;
    }
    default:
      return { error: `unsupported operation ${op.op_type}` };
  }
}

export function runQueueOperationCommand(op: QueueOperation, argv: string[], repo: string): QueueOperationCommand {
  if (argv.length === 0) {
    return { op_type: op.op_type, target_seed: op.target_seed, argv, cwd: repo, exit_code: 0, stdout: "", stderr: "" };
  }
  const proc: SpawnSyncReturns<string> = spawnSync(argv[0], argv.slice(1), {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    op_type: op.op_type,
    target_seed: op.target_seed,
    argv,
    cwd: repo,
    exit_code: proc.status,
    stdout: (proc.stdout || "").trim(),
    stderr: (proc.stderr || proc.error?.message || "").trim(),
  };
}

export function applyManageQueueOperations(
  seedstackDir: string,
  iteration: number,
  seed: string,
  childPreScan: JsonObject,
  reconcilePath: string,
  proposals: JsonObject[],
  repo: string,
  seedCli: string,
  runScan: (seedstackDir: string, iteration: number, label: string) => JsonObject,
  ok: (result: JsonObject) => boolean,
  latestArtifactPath: (result: JsonObject) => string,
  scanListIds: (scan: JsonObject) => string[],
): JsonObject {
  const preApplyScan = runScan(seedstackDir, iteration, `pre-apply-queue-scan-${seed}`);
  if (!ok(preApplyScan)) {
    return {
      contract: "manage_queue_operations.v1",
      ok: false,
      seed,
      proposal_count: proposals.length,
      applied_count: 0,
      blockers: ["fresh queue scan failed before applying proposed operations"],
      warnings: [],
      before_seed_ids: [],
      after_seed_ids: [],
      queue_dirty_paths: queueDirtyPaths(repo),
      planned_commands: [],
      commands: [],
      scans: {
        child_pre_manage_scan: latestArtifactPath(childPreScan),
        pre_apply_scan: latestArtifactPath(preApplyScan),
      },
    };
  }
  const normalized: QueueOperation[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  proposals.forEach((proposal, index) => {
    const op = normalizeQueueOperation(proposal, index);
    if ("error" in op) {
      blockers.push(`proposal ${index}: ${op.error}`);
      return;
    }
    normalized.push(op);
    const validation = validateQueueOperationPreconditions(op, seed, preApplyScan, reconcilePath, repo);
    blockers.push(...validation.blockers.map((item) => `proposal ${index}: ${item}`));
    warnings.push(...validation.warnings.map((item) => `proposal ${index}: ${item}`));
  });
  const beforeIds = scanListIds(preApplyScan);
  const commands: QueueOperationCommand[] = [];
  const plannedArgv: Array<{ op_type: string; target_seed: string; argv: string[] }> = [];
  for (const op of normalized) {
    const argv = buildQueueOperationArgv(op, seedCli);
    if ("error" in argv) blockers.push(`proposal ${op.index}: ${argv.error}`);
    else plannedArgv.push({ op_type: op.op_type, target_seed: op.target_seed, argv });
  }
  const mutatingCommands = plannedArgv.filter((command) => command.argv.length > 0);
  if (mutatingCommands.length > 1) {
    blockers.push("multiple mutating queue operations are not applied in one manage step; split proposals to avoid partial queue mutation");
  }
  if (blockers.length === 0) {
    for (let index = 0; index < normalized.length; index += 1) {
      const op = normalized[index];
      const argv = plannedArgv[index]?.argv ?? [];
      const command = runQueueOperationCommand(op, argv, repo);
      commands.push(command);
      if (command.exit_code !== 0) {
        blockers.push(`proposal ${op.index}: seed-cli command failed exit=${command.exit_code}`);
        break;
      }
    }
  }
  const queueDirty = queueDirtyPaths(repo);
  const afterScan = blockers.length === 0 || commands.length > 0 ? runScan(seedstackDir, iteration, `post-queue-ops-scan-${seed}`) : null;
  return {
    contract: "manage_queue_operations.v1",
    ok: blockers.length === 0,
    seed,
    proposal_count: proposals.length,
    applied_count: commands.length,
    partial_applied: blockers.length > 0 && commands.length > 0,
    blockers,
    warnings,
    before_seed_ids: beforeIds,
    after_seed_ids: afterScan ? scanListIds(afterScan) : beforeIds,
    queue_dirty_paths: queueDirty,
    planned_commands: plannedArgv,
    commands,
    scans: {
      child_pre_manage_scan: latestArtifactPath(childPreScan),
      pre_apply_scan: latestArtifactPath(preApplyScan),
      ...(afterScan ? { post_apply_scan: latestArtifactPath(afterScan) } : {}),
    },
  };
}
