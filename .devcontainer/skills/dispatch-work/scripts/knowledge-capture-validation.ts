import { existsSync, readFileSync } from "node:fs";

export const KNOWLEDGE_CAPTURE_STATES = new Set(["recorded", "none_qualified", "store_missing", "skipped_user_waived"]);
export const KNOWLEDGE_RECORD_TYPES = new Set(["convention", "pattern", "failure", "decision", "reference", "guide"]);

export const VALID_NONE_QUALIFIED_KNOWLEDGE_CAPTURE = [
  "capture_state=none_qualified",
  "store_count: 0",
  "merge_union: true",
  "marker_count: 0",
  "artifacts_reviewed: 4",
  "candidate_count: 0",
  "rejected_count: 0",
  "accepted IDs: []",
  "none_rationale: No durable cross-session knowledge candidates qualified for capture.",
  "",
].join("\n");

export type KnowledgeCandidate = { type: string; content: string };

export type KnowledgeCaptureValidation = {
  ok: boolean;
  state: string;
  errors: string[];
  captureState: string | null;
  acceptedIds: string[];
  structuredCandidates: KnowledgeCandidate[];
  audit: {
    markerCount: number;
    storeCount?: number;
    mergeUnion?: boolean;
    artifactsReviewed?: number;
    candidateCount?: number;
    rejectedCount?: number;
    rationalePresent: boolean;
  };
};

export function validateKnowledgeCaptureText(text: string, present = true): KnowledgeCaptureValidation {
  const errors: string[] = [];
  if (!present) errors.push("knowledge-capture.md missing");
  if (present && text.trim().length === 0) errors.push("knowledge-capture.md empty");

  const captureState = present ? parseKnowledgeCaptureState(text) : null;
  const acceptedIds = present ? parseAcceptedIds(text) : [];
  const structuredCandidates = present ? extractStructuredKnowledgeCandidates(text) : [];
  const audit = present ? parseKnowledgeAuditFields(text) : { markerCount: 0, rationalePresent: false };

  if (!captureState) errors.push("capture_state missing");
  else if (!KNOWLEDGE_CAPTURE_STATES.has(captureState)) errors.push(`capture_state invalid: ${captureState}`);

  if (captureState === "recorded" && structuredCandidates.length === 0 && acceptedIds.length === 0) {
    errors.push("recorded capture requires accepted_records or accepted IDs");
  }
  if (captureState === "none_qualified") {
    if (structuredCandidates.length > 0) errors.push("none_qualified capture cannot include accepted_records");
    if (acceptedIds.length > 0) errors.push("none_qualified capture cannot include accepted IDs");
    requireNumber(audit.storeCount, "store_count", errors);
    if (audit.mergeUnion === undefined) errors.push("merge_union missing");
    requireNumber(audit.markerCount, "marker_count", errors);
    requireNumber(audit.artifactsReviewed, "artifacts_reviewed", errors);
    requireNumber(audit.candidateCount, "candidate_count", errors);
    requireNumber(audit.rejectedCount, "rejected_count", errors);
    if (!audit.rationalePresent) errors.push("none_qualified rationale missing");
  }

  const valid = errors.length === 0;
  return {
    ok: valid,
    state: valid ? captureState ?? "audit_present" : present ? "audit_invalid" : "audit_missing",
    errors,
    captureState,
    acceptedIds,
    structuredCandidates,
    audit,
  };
}

export function validateKnowledgeCaptureFile(path: string): KnowledgeCaptureValidation {
  const present = existsSync(path);
  const text = present ? readFileSync(path, "utf8") : "";
  return validateKnowledgeCaptureText(text, present);
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

export function extractStructuredKnowledgeCandidates(text: string): KnowledgeCandidate[] {
  const candidates: KnowledgeCandidate[] = [];
  const parseAcceptedRecordsKey = (raw: string) => {
    try {
      addAcceptedRecords(JSON.parse(stripJsonComments(raw)) as unknown, candidates);
    } catch {
      // Ignore prose. Accepted records must be explicit JSON.
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
        // Ignore prose. Accepted records must be explicit JSON.
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

function parseKnowledgeAuditFields(text: string): KnowledgeCaptureValidation["audit"] {
  return {
    markerCount: parseNumberField(text, ["marker_count", "marker count"]) ?? (text.match(/<!--\s*KNOWLEDGE:/g) ?? []).length,
    storeCount: parseNumberField(text, ["store_count", "store count"]),
    mergeUnion: parseBooleanField(text, ["merge_union", "merge-union", "merge union"]),
    artifactsReviewed: parseNumberField(text, ["artifacts_reviewed", "artifacts reviewed"]),
    candidateCount: parseNumberField(text, ["candidate_count", "candidate count"]),
    rejectedCount: parseNumberField(text, ["rejected_count", "rejected count"]),
    rationalePresent: rationalePresent(text),
  };
}

function parseNumberField(text: string, names: string[]): number | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[ _-]+");
    const match = text.match(new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*(\\d+)`, "i"));
    if (match) return Number(match[1]);
  }
  return undefined;
}

function parseBooleanField(text: string, names: string[]): boolean | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[ _-]+");
    const match = text.match(new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*(true|false|yes|no)`, "i"));
    if (!match) continue;
    return /^(true|yes)$/i.test(match[1]);
  }
  return undefined;
}

function rationalePresent(text: string): boolean {
  for (const name of ["none_rationale", "rejected_rationale", "rationale", "none rationale", "rejected rationale"]) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[ _-]+");
    const match = text.match(new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*(\\S.*)`, "i"));
    if (match?.[1]?.trim()) return true;
  }
  return false;
}

function requireNumber(value: number | undefined, name: string, errors: string[]): void {
  if (value === undefined || !Number.isFinite(value)) errors.push(`${name} missing`);
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/g, "$1"))
    .join("\n");
}

function addAcceptedRecords(value: unknown, out: KnowledgeCandidate[]): void {
  if (!isObject(value) || !Array.isArray(value.accepted_records)) return;
  for (const item of value.accepted_records) addDirectKnowledgeCandidate(item, out);
}

function addDirectKnowledgeCandidate(value: unknown, out: KnowledgeCandidate[]): void {
  if (Array.isArray(value)) {
    for (const item of value) addDirectKnowledgeCandidate(item, out);
    return;
  }
  if (!isObject(value)) return;
  const type = typeof value.type === "string" ? value.type : "";
  const content = typeof value.content === "string" ? value.content : "";
  if (type && content && KNOWLEDGE_RECORD_TYPES.has(type) && !("evidence" in value)) out.push({ type, content });
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
