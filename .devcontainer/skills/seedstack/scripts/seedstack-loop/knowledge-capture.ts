// Knowledge capture audit, candidate extraction, and store operations.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWLEDGE_RECORD_TYPES,
  validateKnowledgeCaptureText,
} from "../../../dispatch-work/scripts/knowledge-capture-validation.ts";
import {
  type JsonObject,
  type Options,
  KNOWLEDGE_STORE_SCRIPT,
  isObject,
  readJson,
  stringField,
  stringArray,
  stripJsonComments,
} from "./types.ts";

export function knowledgeCapturePath(repo: string, seed: string): string {
  return join(repo, "tmp", "dispatch-work", seed, "knowledge-capture.md");
}

export function knowledgeStorePath(repo: string): string {
  return join(repo, ".seeds", "knowledge.jsonl");
}

export function knowledgeStoreLineCount(path: string): { valid: boolean; count: number; error?: string } {
  if (!existsSync(path)) return { valid: true, count: 0 };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  try {
    for (const line of lines) JSON.parse(line) as unknown;
    return { valid: true, count: lines.length };
  } catch (error) {
    return { valid: false, count: lines.length, error: (error as Error).message };
  }
}

export function knowledgeStoreGitState(repo: string, runGit: (args: string[], allowFailure?: boolean) => { status: number; stdout: string; stderr: string }): { dirty: boolean; status: string } {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all", "--", ".seeds/knowledge.jsonl"], true).stdout;
  return { dirty: status.length > 0, status };
}

export function knowledgeMergeUnionConfigured(repo: string): boolean {
  const path = join(repo, ".seeds", ".gitattributes");
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").split(/\r?\n/).some((line) => /^\s*knowledge\.jsonl\s+.*\bmerge=union\b/.test(line));
}

export function parseKnowledgeCaptureState(text: string): string | null {
  const match = text.match(/\bcapture_state\b\s*[:=]\s*`?([a-z_]+)/i);
  return match?.[1] ?? null;
}

export function parseAcceptedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!/\baccepted(?:_|\s+)ids?\b/i.test(line)) continue;
    for (const match of line.matchAll(/\bex-[a-f0-9]{6}\b/g)) ids.add(match[0]);
  }
  return [...ids].sort();
}

export function asKnowledgeCandidate(value: unknown): { type: string; content: string } | null {
  if (!isObject(value)) return null;
  const type = stringField(value.type);
  const content = stringField(value.content);
  if (type && content && KNOWLEDGE_RECORD_TYPES.has(type) && !("evidence" in value)) return { type, content };
  return null;
}

export function addDirectKnowledgeCandidate(value: unknown, out: Array<{ type: string; content: string }>): void {
  if (Array.isArray(value)) {
    for (const item of value) addDirectKnowledgeCandidate(item, out);
    return;
  }
  const candidate = asKnowledgeCandidate(value);
  if (candidate) out.push(candidate);
}

export function addAcceptedRecords(value: unknown, out: Array<{ type: string; content: string }>): void {
  if (!isObject(value)) return;
  if (Array.isArray(value.accepted_records)) {
    for (const item of value.accepted_records) addDirectKnowledgeCandidate(item, out);
  }
}

export function extractStructuredKnowledgeCandidates(text: string): Array<{ type: string; content: string }> {
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

export function acceptedRecordsSections(text: string): string[] {
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

export function markdownSectionLabel(line: string): string | null {
  const trimmed = line.trim();
  const heading = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/);
  const raw = heading?.[1] ?? trimmed.match(/^([A-Za-z][A-Za-z0-9 _-]{1,80}):?\s*$/)?.[1];
  return raw ? raw.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ") : null;
}

export function baseKnowledgeCaptureCheck(
  repo: string,
  seed: string,
  mode: Options["knowledgeCapture"],
  runGit: (args: string[], allowFailure?: boolean) => { status: number; stdout: string; stderr: string },
): JsonObject {
  const auditPath = knowledgeCapturePath(repo, seed);
  const auditPresent = existsSync(auditPath);
  const auditText = auditPresent ? readFileSync(auditPath, "utf8") : "";
  const storePath = knowledgeStorePath(repo);
  const store = knowledgeStoreLineCount(storePath);
  const gitState = knowledgeStoreGitState(repo, runGit);
  const auditValidation = validateKnowledgeCaptureText(auditText, auditPresent);
  const captureState = auditValidation.captureState;
  const candidates = auditValidation.structuredCandidates;
  const acceptedIds = auditValidation.acceptedIds;
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
      marker_count: auditValidation.audit.markerCount,
      store_count: auditValidation.audit.storeCount ?? null,
      merge_union: auditValidation.audit.mergeUnion ?? null,
      artifacts_reviewed: auditValidation.audit.artifactsReviewed ?? null,
      candidate_count: auditValidation.audit.candidateCount ?? null,
      rejected_count: auditValidation.audit.rejectedCount ?? null,
      rationale_present: auditValidation.audit.rationalePresent,
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
      merge_union: knowledgeMergeUnionConfigured(repo),
    },
  };
}

export function recordKnowledgeCandidates(
  repo: string,
  check: JsonObject,
): JsonObject {
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
  if (!existsSync(KNOWLEDGE_STORE_SCRIPT) || !existsSync(join(repo, ".seeds"))) {
    return { ...check, ok: false, state: "store_missing" };
  }
  if (candidates.length === 0) return check;

  const before = knowledgeStoreLineCount(knowledgeStorePath(repo)).count;
  const outputs: JsonObject[] = [];
  for (const candidate of candidates) {
    const proc = spawnSync(process.execPath, [KNOWLEDGE_STORE_SCRIPT, "record", ".seeds/knowledge.jsonl", "--stdin"], {
      cwd: repo,
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
  const after = knowledgeStoreLineCount(knowledgeStorePath(repo)).count;
  return {
    ...baseKnowledgeCaptureCheck(repo, String(check.seed), "record", () => ({ status: 0, stdout: "", stderr: "" })),
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

export function knowledgeCaptureBlocksRequired(check: JsonObject, knowledgeRequired: boolean): boolean {
  return check.ok !== true && knowledgeRequired;
}
