// Shared types, utilities, and path constants for seedstack-loop modules.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorktreeMetadata, WorktreePolicy } from "../worktree-preflight.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type JsonObject = Record<string, unknown>;
export type RunStateName = "idle" | "dispatching" | "managing" | "done" | "exhausted" | "blocked" | "escalated" | "loop_cap";

export type Options = {
  repo: string;
  originalRepo: string;
  worktreePolicy: WorktreePolicy;
  requireWorktree: boolean;
  worktree: WorktreeMetadata;
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

export type EventRecord = JsonObject & {
  ts: string;
  event: string;
};

export type LoopState = {
  contract: "seedstack_loop_state.v1";
  loop_iteration: number;
  scan_epoch: number;
  manage_epoch: number;
  total_followups: number;
  baseline_seed_count: number;
  skipped_seeds: Array<{ seed: string; reason: string; at: string; loop_cap?: string }>;
};

export type QueueOperation = {
  op_type: string;
  target_seed: string;
  rationale: string;
  source_artifact_refs: string[];
  expected_preconditions: string[];
  details: JsonObject;
  index: number;
};

export type QueueOperationCommand = {
  op_type: string;
  target_seed: string;
  argv: string[];
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
};

export type PerSeedCommitMetadata = {
  commit: string;
  worktreeRoot: string | null;
  branch: string | null;
  headBefore: string;
  headAfter: string;
  gitCommonDir: string | null;
  changedPathAllowlist: string[];
};

export type SeedTiming = {
  seed: string;
  result: "ok" | "skipped" | "failed";
  dispatch_ms?: number;
  manage_ms?: number;
  commit_ms?: number;
  reason?: string;
};

// ── Path constants ───────────────────────────────────────────────────────────

// SCRIPT_DIR points to the parent scripts/ directory (where the orchestrator lives),
// not the seedstack-loop/ subdirectory, to preserve the original path semantics.
export const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEEDSTACK_DIR = dirname(SCRIPT_DIR);
export const WORKSPACE_ROOT = resolve(SCRIPT_DIR, "../../../..");
export const DISPATCH_SEED_DIR = resolve(SEEDSTACK_DIR, "..", "dispatch-work");
export const KNOWLEDGE_STORE_SCRIPT = "/workspace/.devcontainer/skills/capture-knowledge/knowledge-store.ts";

// ── JSON / object utilities ──────────────────────────────────────────────────

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function exactStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

export function pathEntries(value: unknown): Array<{ path: string; classification: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((item) => {
    const path = stringField(item.path);
    const classification = stringField(item.classification);
    return path && classification ? [{ path, classification }] : [];
  });
}

export function unexpectedPaths(result: JsonObject): string[] {
  const direct = stringArray(result.unexpected_paths);
  if (direct.length > 0) return direct;
  return pathEntries(result.paths)
    .filter((item) => item.classification === "unexpected")
    .map((item) => item.path);
}

export function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/g, "$1"))
    .join("\n");
}

export function markdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

