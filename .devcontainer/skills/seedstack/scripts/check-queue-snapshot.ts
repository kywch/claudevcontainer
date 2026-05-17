#!/usr/bin/env bun
// Deterministic queue snapshot drift checker for seedstack_scan.v1 artifacts.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type Finding = { code: string; message: string; detail?: unknown };
type ExpectedAction = "none" | "close";
type Options = {
  repo: string;
  priorScan?: string;
  freshScan?: string;
  adoptionSelection?: string;
  expectedTarget?: string;
  expectedAction: ExpectedAction;
  pretty: boolean;
  selfTest: boolean;
};
type RecordField = "status" | "deps" | "labels" | "priority" | "assignee";
type QueueRecord = {
  id: string;
  status: string | null;
  deps: string[] | null;
  labels: string[] | null;
  priority: number | null;
  assignee: string | null;
  source: "full" | "ids";
  available: Record<RecordField, boolean>;
};
type Snapshot = {
  path: string | null;
  contract: string | null;
  ok: boolean | null;
  ids: string[];
  records: Map<string, QueueRecord>;
};
type Result = {
  contract: "queue_snapshot_check.v1";
  ok: boolean;
  blockers: Finding[];
  warnings: Finding[];
  inputs: {
    prior_scan: string | null;
    fresh_scan: string | null;
    adoption_selection: string | null;
    expected_target: string | null;
    expected_action: ExpectedAction;
  };
  scope: {
    adopted_seed_ids: string[];
    excluded_open_seed_ids: string[];
  };
  drift: {
    added_ids: string[];
    removed_ids: string[];
    changed: Array<{ id: string; field: RecordField; prior: unknown; fresh: unknown; allowed: boolean }>;
    unavailable_fields: Array<{ id: string; fields: RecordField[] }>;
  };
  summary: {
    prior_count: number;
    fresh_count: number;
    changed_count: number;
    blocker_count: number;
    warning_count: number;
  };
};

const HELP = `check-queue-snapshot.ts queue_snapshot_check.v1

Usage:
  bun skills/seedstack/scripts/check-queue-snapshot.ts --prior-scan <json> --fresh-scan <json> [args]
  bun skills/seedstack/scripts/check-queue-snapshot.ts --self-test [--pretty]

Args:
  --repo <path>                    Repo root. Default: cwd.
  --prior-scan <json>              Prior seedstack_scan.v1 JSON.
  --fresh-scan <json>              Fresh seedstack_scan.v1 JSON.
  --adoption-selection <json>      Optional adoption/manifest JSON.
  --expected-target <work-id>      Work order allowed to mutate.
  --expected-action <none|close>   Declared mutation. Default: none.
  --pretty                         Pretty-print JSON.
  --self-test                      Run fixture tests.
  --help                           Show this help.
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

function parseAction(value: string): ExpectedAction {
  if (value === "none" || value === "close") return value;
  throw new Error("--expected-action must be none or close");
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    expectedAction: "none",
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
      case "--repo":
        options.repo = take();
        break;
      case "--prior-scan":
        options.priorScan = take();
        break;
      case "--fresh-scan":
        options.freshScan = take();
        break;
      case "--adoption-selection":
        options.adoptionSelection = take();
        break;
      case "--expected-target":
        options.expectedTarget = take();
        break;
      case "--expected-action":
        options.expectedAction = parseAction(take());
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--prior-scan=")) options.priorScan = arg.slice("--prior-scan=".length);
        else if (arg.startsWith("--fresh-scan=")) options.freshScan = arg.slice("--fresh-scan=".length);
        else if (arg.startsWith("--adoption-selection=")) {
          options.adoptionSelection = arg.slice("--adoption-selection=".length);
        } else if (arg.startsWith("--expected-target=")) options.expectedTarget = arg.slice("--expected-target=".length);
        else if (arg.startsWith("--expected-action=")) options.expectedAction = parseAction(arg.slice("--expected-action=".length));
        else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  return options;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value].sort(asciiCompare) : null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(asciiCompare);
}

function asciiCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function addFinding(findings: Finding[], code: string, message: string, detail?: unknown): void {
  findings.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function paths(options: Options): { prior: string | null; fresh: string | null; adoption: string | null } {
  return {
    prior: options.priorScan ? resolve(options.repo, options.priorScan) : null,
    fresh: options.freshScan ? resolve(options.repo, options.freshScan) : null,
    adoption: options.adoptionSelection ? resolve(options.repo, options.adoptionSelection) : null,
  };
}

function recordFromObject(value: JsonObject): QueueRecord | null {
  if (typeof value.id !== "string") return null;
  const blockedBy = stringArray(value.blockedBy);
  const dependsOn = stringArray(value.depends_on);
  const deps = blockedBy ?? dependsOn ?? stringArray(value.deps);
  const priority = typeof value.priority === "number" && Number.isFinite(value.priority) ? value.priority : null;
  const has = (field: string) => Object.prototype.hasOwnProperty.call(value, field);
  return {
    id: value.id,
    status: typeof value.status === "string" ? value.status : null,
    deps,
    labels: stringArray(value.labels),
    priority,
    assignee: typeof value.assignee === "string" ? value.assignee : null,
    source: "full",
    available: {
      status: has("status"),
      deps: has("blockedBy") || has("depends_on") || has("deps"),
      labels: has("labels"),
      priority: has("priority"),
      assignee: has("assignee"),
    },
  };
}

function objectValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value)) return Object.values(value);
  return [];
}

function extractFullRecords(scan: JsonObject): QueueRecord[] {
  const candidates = [
    scan.issues,
    scan.items,
    scan.records,
    isObject(scan.queue) ? scan.queue.issues : undefined,
    isObject(scan.queue) ? scan.queue.items : undefined,
  ];
  for (const candidate of candidates) {
    const records = objectValues(candidate).flatMap((item) => {
      if (!isObject(item)) return [];
      const record = recordFromObject(item);
      return record ? [record] : [];
    });
    if (records.length) return records;
  }
  return [];
}

function idsFrom(scan: JsonObject, key: string): string[] {
  const nested = isObject(scan.ids) ? scan.ids[key] : undefined;
  return stringArray(nested) ?? stringArray(scan[key]) ?? [];
}

function inferStatus(id: string, scan: JsonObject): string | null {
  if (idsFrom(scan, "closed_ids").includes(id) || idsFrom(scan, "adopted_closed_ids").includes(id) || idsFrom(scan, "closed_adopted").includes(id)) {
    return "closed";
  }
  if (
    idsFrom(scan, "open_ids").includes(id) ||
    idsFrom(scan, "ready_ids").includes(id) ||
    idsFrom(scan, "blocked_ids").includes(id) ||
    idsFrom(scan, "adopted_open_ids").includes(id) ||
    idsFrom(scan, "open_adopted").includes(id)
  ) {
    return "open";
  }
  return null;
}

function extractSnapshot(raw: unknown, path: string | null, blockers: Finding[]): Snapshot {
  if (!isObject(raw)) {
    addFinding(blockers, "invalid_scan_shape", "scan must be object", { path });
    return { path, contract: null, ok: null, ids: [], records: new Map() };
  }
  const contract = typeof raw.contract === "string" ? raw.contract : null;
  if (contract !== "seedstack_scan.v1") addFinding(blockers, "invalid_scan_contract", "scan contract must be seedstack_scan.v1", { path, contract });

  const records = new Map<string, QueueRecord>();
  for (const record of extractFullRecords(raw)) records.set(record.id, record);
  const listIds = idsFrom(raw, "list_ids");
  const allIds = uniqueSorted([
    ...listIds,
    ...idsFrom(raw, "open_ids"),
    ...idsFrom(raw, "closed_ids"),
    ...idsFrom(raw, "ready_ids"),
    ...idsFrom(raw, "blocked_ids"),
  ]);
  for (const id of allIds) {
    if (!records.has(id)) {
      records.set(id, {
        id,
        status: inferStatus(id, raw),
        deps: null,
        labels: null,
        priority: null,
        assignee: null,
        source: "ids",
        available: {
          status: true,
          deps: false,
          labels: false,
          priority: false,
          assignee: false,
        },
      });
    }
  }
  return {
    path,
    contract,
    ok: typeof raw.ok === "boolean" ? raw.ok : null,
    ids: records.size ? uniqueSorted([...records.keys()]) : uniqueSorted(listIds),
    records,
  };
}

function readAdoption(path: string | null, blockers: Finding[]): { adopted: string[]; excluded: string[] } {
  if (!path) return { adopted: [], excluded: [] };
  const raw = readJson(path);
  if (!isObject(raw)) {
    addFinding(blockers, "invalid_adoption_selection_shape", "adoption-selection must be object", { path });
    return { adopted: [], excluded: [] };
  }
  const manifest = isObject(raw.adoption) ? raw.adoption : raw;
  const adopted = stringArray(manifest.adopted_seed_ids);
  const excluded = stringArray(manifest.excluded_open_seed_ids);
  if (!adopted) addFinding(blockers, "invalid_adopted_seed_ids", "adopted_seed_ids must be string array", { path });
  if (!excluded) addFinding(blockers, "invalid_excluded_open_seed_ids", "excluded_open_seed_ids must be string array", { path });
  return { adopted: adopted ?? [], excluded: excluded ?? [] };
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unavailableFields(prior: QueueRecord, fresh: QueueRecord): RecordField[] {
  const fields: RecordField[] = [];
  for (const field of ["deps", "labels", "priority", "assignee"] as RecordField[]) {
    if (!prior.available[field] || !fresh.available[field]) fields.push(field);
  }
  return fields;
}

function allowedTargetClose(id: string, field: RecordField, prior: unknown, fresh: unknown, options: Options): boolean {
  return id === options.expectedTarget && options.expectedAction === "close" && field === "status" && prior !== "closed" && fresh === "closed";
}

function check(options: Options): Result {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const resolved = paths(options);
  if (!resolved.prior) addFinding(blockers, "missing_prior_scan_arg", "--prior-scan is required");
  if (!resolved.fresh) addFinding(blockers, "missing_fresh_scan_arg", "--fresh-scan is required");
  if (options.expectedAction !== "none" && !options.expectedTarget) {
    addFinding(blockers, "expected_action_without_target", "--expected-action requires --expected-target");
  }

  const prior = resolved.prior ? extractSnapshot(readJson(resolved.prior), resolved.prior, blockers) : { path: null, contract: null, ok: null, ids: [], records: new Map<string, QueueRecord>() };
  const fresh = resolved.fresh ? extractSnapshot(readJson(resolved.fresh), resolved.fresh, blockers) : { path: null, contract: null, ok: null, ids: [], records: new Map<string, QueueRecord>() };
  const adoption = readAdoption(resolved.adoption, blockers);

  const addedIds = difference(fresh.ids, prior.ids);
  const removedIds = difference(prior.ids, fresh.ids);
  const changed: Result["drift"]["changed"] = [];
  const unavailable: Result["drift"]["unavailable_fields"] = [];

  const hardAdded = addedIds;
  const hardRemoved = removedIds;
  if (hardAdded.length) addFinding(blockers, "unexpected_added_ids", "fresh scan added undeclared ids", hardAdded);
  if (hardRemoved.length) addFinding(blockers, "unexpected_removed_ids", "fresh scan removed undeclared ids", hardRemoved);

  for (const id of prior.ids.filter((value) => fresh.records.has(value))) {
    const before = prior.records.get(id);
    const after = fresh.records.get(id);
    if (!before || !after) continue;
    const fields = unavailableFields(before, after);
    if (fields.length) unavailable.push({ id, fields });
    for (const field of ["status", "deps", "labels", "priority", "assignee"] as RecordField[]) {
      const priorValue = before[field];
      const freshValue = after[field];
      if (priorValue === null || freshValue === null || sameValue(priorValue, freshValue)) continue;
      const allowed = allowedTargetClose(id, field, priorValue, freshValue, options);
      changed.push({ id, field, prior: priorValue, fresh: freshValue, allowed });
      if (!allowed) {
        addFinding(blockers, "unexpected_queue_drift", "queue field changed without declared mutation", {
          id,
          field,
          prior: priorValue,
          fresh: freshValue,
        });
      }
    }
  }

  if (unavailable.length) {
    addFinding(warnings, "partial_scan_fields", "scan lacks full records for deps/labels/priority/assignee comparison", unavailable);
  }
  const managedIds = new Set([
    ...adoption.adopted,
    ...adoption.excluded,
    ...(options.expectedTarget ? [options.expectedTarget] : []),
  ]);
  const managedUnavailable = unavailable.filter((item) => managedIds.has(item.id));
  if (managedUnavailable.length) {
    addFinding(blockers, "managed_scan_fields_unavailable", "adopted/managed ids require full deps/labels/priority/assignee records", managedUnavailable);
  }
  if (options.expectedAction === "close" && options.expectedTarget) {
    const freshTarget = fresh.records.get(options.expectedTarget);
    if (freshTarget && freshTarget.status !== "closed") {
      addFinding(blockers, "expected_target_not_closed", "expected target close did not appear in fresh scan", {
        id: options.expectedTarget,
        status: freshTarget.status,
      });
    }
  }

  return {
    contract: "queue_snapshot_check.v1",
    ok: blockers.length === 0,
    blockers,
    warnings,
    inputs: {
      prior_scan: resolved.prior,
      fresh_scan: resolved.fresh,
      adoption_selection: resolved.adoption,
      expected_target: options.expectedTarget ?? null,
      expected_action: options.expectedAction,
    },
    scope: {
      adopted_seed_ids: adoption.adopted,
      excluded_open_seed_ids: adoption.excluded,
    },
    drift: {
      added_ids: hardAdded,
      removed_ids: hardRemoved,
      changed,
      unavailable_fields: unavailable,
    },
    summary: {
      prior_count: prior.ids.length,
      fresh_count: fresh.ids.length,
      changed_count: changed.length,
      blocker_count: blockers.length,
      warning_count: warnings.length,
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function scan(records: QueueRecord[]): JsonObject {
  return {
    contract: "seedstack_scan.v1",
    ok: true,
    ids: {
      list_ids: records.map((record) => record.id),
      open_ids: records.filter((record) => record.status !== "closed").map((record) => record.id),
      closed_ids: records.filter((record) => record.status === "closed").map((record) => record.id),
      ready_ids: records.filter((record) => record.status !== "closed").map((record) => record.id),
      blocked_ids: [],
    },
    issues: records,
  };
}

function record(id: string, extra: Partial<QueueRecord> = {}): QueueRecord {
  return {
    id,
    status: "open",
    deps: [],
    labels: ["net-test"],
    priority: 1,
    assignee: "codex",
    source: "full",
    available: { status: true, deps: true, labels: true, priority: true, assignee: true },
    ...extra,
  };
}

function assertSelf(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) throw new Error(`self-test failed: ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

function selfTest(pretty: boolean): Result {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-queue-snapshot-"));
  try {
    const prior = join(dir, "prior.json");
    const fresh = join(dir, "fresh.json");
    const adoption = join(dir, "adoption-selection.json");
    const base = [record("seed-a"), record("seed-b", { deps: ["seed-a"], priority: 2 })];
    writeJson(prior, scan(base));
    writeJson(fresh, scan(base));
    writeJson(adoption, { adoption: { adopted_seed_ids: ["seed-a", "seed-b"], excluded_open_seed_ids: [] } });

    const same = check({ repo: dir, priorScan: prior, freshScan: fresh, adoptionSelection: adoption, expectedAction: "none", pretty, selfTest: false });
    assertSelf("same snapshot passes", same.ok, same);
    assertSelf("manifest loaded", same.scope.adopted_seed_ids.join(",") === "seed-a,seed-b", same.scope);

    writeJson(fresh, scan([record("seed-a", { status: "blocked" }), record("seed-b", { deps: ["seed-a"], priority: 2 })]));
    const statusDrift = check({ repo: dir, priorScan: prior, freshScan: fresh, expectedAction: "none", pretty, selfTest: false });
    assertSelf("status drift blocks", !statusDrift.ok && statusDrift.blockers.some((item) => item.code === "unexpected_queue_drift"), statusDrift);

    writeJson(fresh, scan([record("seed-a"), record("seed-b", { deps: ["seed-x"], priority: 2 })]));
    const depsDrift = check({ repo: dir, priorScan: prior, freshScan: fresh, expectedAction: "none", pretty, selfTest: false });
    assertSelf("deps drift blocks", !depsDrift.ok, depsDrift);

    writeJson(fresh, scan([record("seed-a"), record("seed-b", { deps: ["seed-a"], priority: 2, assignee: "other" })]));
    const assigneeDrift = check({ repo: dir, priorScan: prior, freshScan: fresh, expectedAction: "none", pretty, selfTest: false });
    assertSelf("assignee drift blocks", !assigneeDrift.ok, assigneeDrift);

    writeJson(fresh, scan([record("seed-a", { status: "closed" }), record("seed-b", { deps: ["seed-a"], priority: 2 })]));
    const expectedClose = check({
      repo: dir,
      priorScan: prior,
      freshScan: fresh,
      expectedTarget: "seed-a",
      expectedAction: "close",
      pretty,
      selfTest: false,
    });
    assertSelf("expected target close passes", expectedClose.ok, expectedClose);

    writeJson(prior, { contract: "seedstack_scan.v1", ok: true, ids: { list_ids: ["seed-a"], open_ids: ["seed-a"] } });
    writeJson(fresh, { contract: "seedstack_scan.v1", ok: true, ids: { list_ids: ["seed-a"], open_ids: ["seed-a"] } });
    const partialManaged = check({ repo: dir, priorScan: prior, freshScan: fresh, adoptionSelection: adoption, expectedAction: "none", pretty, selfTest: false });
    assertSelf(
      "managed partial scan blocks",
      !partialManaged.ok && partialManaged.blockers.some((item) => item.code === "managed_scan_fields_unavailable"),
      partialManaged,
    );

    return same;
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
      contract: "queue_snapshot_check.v1",
      ok: false,
      blockers: [{ code: "queue_snapshot_check_crash", message: String(error) }],
      warnings: [],
    };
    process.stderr.write(`${JSON.stringify(crash, null, 2)}\n`);
    process.exit(2);
  }
}

main();
