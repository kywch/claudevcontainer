#!/usr/bin/env bun
// Deterministic schema checker for read-only Seedstack operator packets.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type Operator = "preflight" | "artifacts" | "verifier" | "recovery" | "knowledge";
type Status = "ok" | "warn" | "fail" | "blocked";
type Finding = { code: string; message: string; path?: string; detail?: unknown };
type Recommendation = {
  id: string;
  owner: string;
  action: string;
  summary: string;
  queue_mutation_allowed: boolean;
  target: string | null;
  packet_operator: Operator;
};
type PacketRecord = {
  operator: Operator;
  path: string;
  status: Status;
  run_id: string;
  queue_snapshot_id: string | null;
  finding_count: number;
  recommendation_count: number;
  recommendations: Recommendation[];
};
type Options = {
  operatorDir: string;
  pretty: boolean;
  selfTest: boolean;
};
type Result = {
  contract: "operator_packets_check.v1";
  ok: boolean;
  blockers: Finding[];
  warnings: Finding[];
  inputs: { operator_dir: string };
  accepted_packets: Array<{
    operator: Operator;
    path: string;
    status: Status;
    finding_count: number;
    recommendation_count: number;
  }>;
  discarded_packets: Array<{ path: string; reason: string }>;
  missing_packets: string[];
  recommendations: Recommendation[];
  conflicts: Array<{ target: string; actions: string[]; recommendation_ids: string[] }>;
  automatic_queue_mutation_allowed: boolean;
  summary: {
    accepted_count: number;
    discarded_count: number;
    missing_count: number;
    blocker_count: number;
    warning_count: number;
    conflict_count: number;
  };
};

const OPERATORS: Operator[] = ["preflight", "artifacts", "verifier", "recovery", "knowledge"];
const STATUSES: Status[] = ["ok", "warn", "fail", "blocked"];
const DEFAULT_OPERATOR_DIR = resolve(process.cwd(), "operator");

const HELP = `check-operator-packets.ts operator_packets_check.v1

Usage:
  bun skills/seedstack/scripts/check-operator-packets.ts [--operator-dir <path>] [--pretty]
  bun skills/seedstack/scripts/check-operator-packets.ts --self-test [--pretty]

Args:
  --operator-dir <path>   Directory containing operator/*.packet.json. Default: ./operator.
  --pretty                Pretty-print JSON.
  --self-test             Run fixture tests.
  --help                  Show this help.
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

function parseArgs(argv: string[]): Options {
  const options: Options = {
    operatorDir: DEFAULT_OPERATOR_DIR,
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
        usage(0);
      case "--pretty":
        options.pretty = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      case "--operator-dir":
        options.operatorDir = take();
        break;
      default:
        if (arg.startsWith("--operator-dir=")) options.operatorDir = arg.slice("--operator-dir=".length);
        else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.operatorDir = resolve(options.operatorDir);
  return options;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function addFinding(findings: Finding[], code: string, message: string, path?: string, detail?: unknown): void {
  findings.push({ code, message, ...(path === undefined ? {} : { path }), ...(detail === undefined ? {} : { detail }) });
}

function packetPath(operatorDir: string, operator: Operator): string {
  return join(operatorDir, `${operator}.packet.json`);
}

function validateFinding(value: unknown): boolean {
  return isObject(value) && typeof value.id === "string" && typeof value.summary === "string" && Array.isArray(value.evidence_refs);
}

function validateRecommendation(value: unknown, operator: Operator, path: string, blockers: Finding[]): Recommendation | null {
  if (!isObject(value)) {
    addFinding(blockers, "invalid_recommendation_shape", "recommendation must be object", path);
    return null;
  }
  const id = stringOrNull(value.id);
  const owner = stringOrNull(value.owner);
  const action = stringOrNull(value.action);
  const summary = stringOrNull(value.summary);
  const queueMutationAllowed = value.queue_mutation_allowed;
  const target = value.target === null || typeof value.target === "string" ? value.target : null;
  if (!id || !owner || !action || !summary || typeof queueMutationAllowed !== "boolean") {
    addFinding(blockers, "invalid_recommendation_fields", "recommendation requires id, owner, action, summary, queue_mutation_allowed", path, value);
    return null;
  }
  if (queueMutationAllowed && owner !== "main_agent") {
    addFinding(blockers, "operator_queue_mutation_not_allowed", "queue mutation may be allowed only when owner is main_agent", path, {
      id,
      owner,
      action,
    });
    return null;
  }
  return {
    id,
    owner,
    action,
    summary,
    queue_mutation_allowed: queueMutationAllowed,
    target,
    packet_operator: operator,
  };
}

function validatePacket(raw: unknown, operator: Operator, path: string, blockers: Finding[]): PacketRecord | null {
  if (!isObject(raw)) {
    addFinding(blockers, "invalid_packet_shape", "packet must be object", path);
    return null;
  }
  if (raw.packet_version !== "operator.v1") {
    addFinding(blockers, "invalid_packet_version", "packet_version must be operator.v1", path, raw.packet_version);
    return null;
  }
  if (raw.operator !== operator) {
    addFinding(blockers, "operator_filename_mismatch", "packet operator must match filename", path, raw.operator);
    return null;
  }
  const runId = stringOrNull(raw.run_id);
  if (!runId) {
    addFinding(blockers, "missing_run_id", "run_id is required", path);
    return null;
  }
  if (raw.readonly !== true) {
    addFinding(blockers, "packet_not_readonly", "operator packets must be readonly true", path);
    return null;
  }
  if (!STATUSES.includes(raw.status as Status)) {
    addFinding(blockers, "invalid_packet_status", "status must be ok|warn|fail|blocked", path, raw.status);
    return null;
  }
  for (const optionalId of ["task_id", "seed", "trial_id", "queue_snapshot_id"]) {
    if (raw[optionalId] !== undefined && raw[optionalId] !== null && typeof raw[optionalId] !== "string") {
      addFinding(blockers, "invalid_optional_id", `${optionalId} must be string or null`, path, raw[optionalId]);
      return null;
    }
  }
  const findings = Array.isArray(raw.findings) ? raw.findings : null;
  if (!findings || !findings.every(validateFinding)) {
    addFinding(blockers, "invalid_findings", "findings must be array of {id, summary, evidence_refs}", path);
    return null;
  }
  const rawRecommendations = Array.isArray(raw.recommendations) ? raw.recommendations : null;
  if (!rawRecommendations) {
    addFinding(blockers, "invalid_recommendations", "recommendations must be array", path);
    return null;
  }
  const recommendationBlockers: Finding[] = [];
  const recommendations = rawRecommendations.flatMap((item) => {
    const recommendation = validateRecommendation(item, operator, path, recommendationBlockers);
    return recommendation ? [recommendation] : [];
  });
  if (recommendationBlockers.length) {
    blockers.push(...recommendationBlockers);
    return null;
  }
  return {
    operator,
    path,
    status: raw.status as Status,
    run_id: runId,
    queue_snapshot_id: raw.queue_snapshot_id === null || raw.queue_snapshot_id === undefined ? null : String(raw.queue_snapshot_id),
    finding_count: findings.length,
    recommendation_count: recommendations.length,
    recommendations,
  };
}

function detectConflicts(recommendations: Recommendation[]): Result["conflicts"] {
  const byTarget = new Map<string, Recommendation[]>();
  for (const recommendation of recommendations) {
    if (!recommendation.target || recommendation.action === "none") continue;
    const existing = byTarget.get(recommendation.target) ?? [];
    existing.push(recommendation);
    byTarget.set(recommendation.target, existing);
  }

  const conflicts: Result["conflicts"] = [];
  for (const [target, items] of byTarget.entries()) {
    const actions = [...new Set(items.map((item) => item.action))].sort();
    if (actions.length > 1) {
      conflicts.push({
        target,
        actions,
        recommendation_ids: items.map((item) => item.id).sort(),
      });
    }
  }
  return conflicts.sort((left, right) => left.target.localeCompare(right.target));
}

function check(options: Options): Result {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const accepted: PacketRecord[] = [];
  const discarded: Result["discarded_packets"] = [];
  const missing: string[] = [];

  for (const operator of OPERATORS) {
    const path = packetPath(options.operatorDir, operator);
    try {
      const packetBlockers: Finding[] = [];
      const packet = validatePacket(readJson(path), operator, path, packetBlockers);
      if (packet) {
        accepted.push(packet);
      } else {
        blockers.push(...packetBlockers);
        discarded.push({ path, reason: packetBlockers.map((item) => item.code).join(",") || "invalid_packet" });
      }
    } catch (error) {
      const message = String((error as Error).message);
      if (message.includes("ENOENT")) {
        missing.push(path);
        addFinding(blockers, "missing_operator_packet", "required operator packet missing", path);
      } else {
        addFinding(blockers, "operator_packet_read_error", "failed to read operator packet", path, message);
        discarded.push({ path, reason: "read_error" });
      }
    }
  }

  const runIds = [...new Set(accepted.map((packet) => packet.run_id))];
  if (runIds.length > 1) addFinding(blockers, "mixed_run_ids", "accepted packets must share one run_id", undefined, runIds);

  const recommendations = accepted.flatMap((packet) => packet.recommendations);
  const conflicts = detectConflicts(recommendations);
  if (conflicts.length) addFinding(blockers, "conflicting_recommendations", "conflicting recommendations block automatic queue mutation", undefined, conflicts);

  const hasRequestedQueueMutation = recommendations.some((item) => item.queue_mutation_allowed);
  const automaticQueueMutationAllowed =
    blockers.length === 0 &&
    conflicts.length === 0 &&
    discarded.length === 0 &&
    missing.length === 0 &&
    hasRequestedQueueMutation &&
    recommendations.every((item) => !item.queue_mutation_allowed || item.owner === "main_agent");

  if (!automaticQueueMutationAllowed) {
    addFinding(warnings, "main_agent_queue_owner", "queue mutation remains main-agent/Seedstack-owned; checker does not mutate queue");
  }

  return {
    contract: "operator_packets_check.v1",
    ok: blockers.length === 0,
    blockers,
    warnings,
    inputs: { operator_dir: options.operatorDir },
    accepted_packets: accepted.map((packet) => ({
      operator: packet.operator,
      path: packet.path,
      status: packet.status,
      finding_count: packet.finding_count,
      recommendation_count: packet.recommendation_count,
    })),
    discarded_packets: discarded,
    missing_packets: missing,
    recommendations,
    conflicts,
    automatic_queue_mutation_allowed: automaticQueueMutationAllowed,
    summary: {
      accepted_count: accepted.length,
      discarded_count: discarded.length,
      missing_count: missing.length,
      blocker_count: blockers.length,
      warning_count: warnings.length,
      conflict_count: conflicts.length,
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function packet(operator: Operator, extra: Partial<JsonObject> = {}): JsonObject {
  return {
    packet_version: "operator.v1",
    operator,
    run_id: "run-test",
    task_id: null,
    seed: "seed-a",
    trial_id: null,
    queue_snapshot_id: "scan-1",
    readonly: true,
    status: "ok",
    findings: [{ id: `${operator}-finding`, summary: "fixture finding", evidence_refs: [] }],
    recommendations: [
      {
        id: `${operator}-noop`,
        owner: "main_agent",
        action: "none",
        summary: "fixture recommendation",
        queue_mutation_allowed: false,
        target: null,
      },
    ],
    ...extra,
  };
}

function writePacketSet(dir: string, overrides: Partial<Record<Operator, Partial<JsonObject>>> = {}): void {
  for (const operator of OPERATORS) writeJson(packetPath(dir, operator), packet(operator, overrides[operator] ?? {}));
}

function assertSelf(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) throw new Error(`self-test failed: ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

function selfTest(pretty: boolean): Result {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-operator-packets-"));
  try {
    writePacketSet(dir);
    const valid = check({ operatorDir: dir, pretty, selfTest: false });
    assertSelf("valid packet set passes", valid.ok && valid.accepted_packets.length === OPERATORS.length, valid);
    assertSelf("valid packet set does not auto-mutate", !valid.automatic_queue_mutation_allowed, valid);

    writeJson(packetPath(dir, "verifier"), packet("verifier", { readonly: false }));
    const invalid = check({ operatorDir: dir, pretty, selfTest: false });
    assertSelf(
      "invalid packet discarded and reported",
      !invalid.ok &&
        invalid.discarded_packets.some((item) => item.path.endsWith("verifier.packet.json")) &&
        invalid.blockers.some((item) => item.code === "packet_not_readonly"),
      invalid,
    );

    writePacketSet(dir, {
      recovery: {
        recommendations: [
          {
            id: "recovery-close",
            owner: "main_agent",
            action: "close_seed",
            summary: "close seed-a",
            queue_mutation_allowed: true,
            target: "seed-a",
          },
        ],
      },
      verifier: {
        recommendations: [
          {
            id: "verifier-retry",
            owner: "main_agent",
            action: "retry_seed",
            summary: "retry seed-a",
            queue_mutation_allowed: true,
            target: "seed-a",
          },
        ],
      },
    });
    const conflicting = check({ operatorDir: dir, pretty, selfTest: false });
    assertSelf(
      "conflicting recommendations block automatic queue mutation",
      !conflicting.ok &&
        !conflicting.automatic_queue_mutation_allowed &&
        conflicting.blockers.some((item) => item.code === "conflicting_recommendations"),
      conflicting,
    );

    writePacketSet(dir, {
      recovery: {
        recommendations: [
          {
            id: "recovery-bad-owner",
            owner: "recovery",
            action: "close_seed",
            summary: "bad owner",
            queue_mutation_allowed: true,
            target: "seed-a",
          },
        ],
      },
    });
    const badOwner = check({ operatorDir: dir, pretty, selfTest: false });
    assertSelf("non-main owner cannot allow queue mutation", !badOwner.ok && badOwner.discarded_packets.length === 1, badOwner);

    return valid;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    usage(2);
  }

  try {
    const result = options.selfTest ? selfTest(options.pretty) : check(options);
    process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const crash = {
      contract: "operator_packets_check.v1",
      ok: false,
      blockers: [{ code: "operator_packets_check_crash", message: String(error) }],
      warnings: [],
    };
    process.stderr.write(`${JSON.stringify(crash, null, 2)}\n`);
    process.exit(2);
  }
}

main();
