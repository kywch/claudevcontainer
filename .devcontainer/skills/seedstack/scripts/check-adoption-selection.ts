#!/usr/bin/env bun
// Deterministic Seedstack adoption-selection checker.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Finding = { code: string; message: string; detail?: unknown };
type JsonObject = Record<string, unknown>;

type Options = {
  repo: string;
  adoptionSelection?: string;
  scanFile?: string;
  expectedAdopted: string[];
  expectedExcluded: string[];
  expectNoExcluded?: boolean;
  expectedFirstReady?: string;
  sharedLabel?: string;
  requireCommitPolicy?: "per_seed" | "batch" | "none";
  pretty: boolean;
  selfTest: boolean;
};

type Result = {
  contract: "adoption_selection_check.v1";
  ok: boolean;
  blockers: Finding[];
  warnings: Finding[];
  adoption: {
    path: string | null;
    adopted_seed_ids: string[];
    planned_order: string[];
    excluded_open_seed_ids: string[];
    baseline_ready_ids: string[];
    baseline_blocked_ids: string[];
    selected_label: string | null;
    shared_label: string | null;
    commit_policy: string | null;
    assignee: string | null;
  };
  scan: null | {
    path: string;
    adopted_ready_ids: string[];
    excluded_ready_ids: string[];
    adopted_blocked_ids: string[];
    source_shape: string;
  };
  explicit_candidate_ids: string[];
  summary: JsonObject;
};

const HELP = `check-adoption-selection.ts adoption_selection_check.v1

Usage:
  bun skills/seedstack/scripts/check-adoption-selection.ts --adoption-selection <path> [args]
  bun skills/seedstack/scripts/check-adoption-selection.ts --self-test [--pretty]

Args:
  --repo <path>                            Repo root. Default: cwd.
  --adoption-selection <path>              adoption-selection.json path. Required unless --self-test.
  --scan-file <json>                       Scan/run-state/pre_dispatch_scan JSON fixture.
  --expected-adopted <work-id>             Exact adopted set member. Repeatable.
  --expected-excluded <work-id>            Exact excluded set member. Repeatable.
  --expect-no-excluded                     Require excluded_open_seed_ids to be empty.
  --expected-first-ready <work-id>         Expected first adopted ready id from scan.
  --shared-label <label>                   Require selected_label or shared_label match.
  --require-commit-policy <per_seed|batch|none>
  --pretty                                 Pretty-print JSON.
  --self-test                              Run fixture tests.
  --help                                   Show this help.
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
    repo: process.cwd(),
    expectedAdopted: [],
    expectedExcluded: [],
    expectNoExcluded: false,
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
      case "--adoption-selection":
        options.adoptionSelection = take();
        break;
      case "--scan-file":
        options.scanFile = take();
        break;
      case "--expected-adopted":
        options.expectedAdopted.push(take());
        break;
      case "--expected-excluded":
        options.expectedExcluded.push(take());
        break;
      case "--expect-no-excluded":
        options.expectNoExcluded = true;
        break;
      case "--expected-first-ready":
        options.expectedFirstReady = take();
        break;
      case "--shared-label":
        options.sharedLabel = take();
        break;
      case "--require-commit-policy":
        options.requireCommitPolicy = parseCommitPolicy(take());
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--adoption-selection=")) {
          options.adoptionSelection = arg.slice("--adoption-selection=".length);
        } else if (arg.startsWith("--scan-file=")) options.scanFile = arg.slice("--scan-file=".length);
        else if (arg.startsWith("--expected-adopted=")) {
          options.expectedAdopted.push(arg.slice("--expected-adopted=".length));
        } else if (arg.startsWith("--expected-excluded=")) {
          options.expectedExcluded.push(arg.slice("--expected-excluded=".length));
        } else if (arg === "--expect-no-excluded") {
          options.expectNoExcluded = true;
        } else if (arg.startsWith("--expected-first-ready=")) {
          options.expectedFirstReady = arg.slice("--expected-first-ready=".length);
        } else if (arg.startsWith("--shared-label=")) options.sharedLabel = arg.slice("--shared-label=".length);
        else if (arg.startsWith("--require-commit-policy=")) {
          options.requireCommitPolicy = parseCommitPolicy(arg.slice("--require-commit-policy=".length));
        } else throw new Error(`unknown arg: ${arg}`);
    }
  }

  options.repo = resolve(options.repo);
  return options;
}

function parseCommitPolicy(value: string): "per_seed" | "batch" | "none" {
  if (value !== "per_seed" && value !== "batch" && value !== "none") {
    throw new Error("--require-commit-policy must be per_seed, batch, or none");
  }
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function orderByManifest(ids: string[], manifestOrder: string[]): string[] {
  const order = new Map<string, number>();
  manifestOrder.forEach((id, index) => {
    if (!order.has(id)) order.set(id, index);
  });
  return [...ids].sort((left, right) => {
    const leftRank = order.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = order.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function exactSetMismatch(actual: string[], expected: string[]): null | { missing: string[]; extra: string[] } {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  return missing.length || extra.length ? { missing, extra } : null;
}

function orderedSeedIdsFromManifestField(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  if (!Array.isArray(value)) return null;
  const entries: Array<{ id: string; rank: number; index: number }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isObject(item)) return null;
    const id = stringField(item.id) ?? stringField(item.seed_id) ?? stringField(item.seed);
    if (!id) return null;
    const rawRank = item.rank ?? item.order ?? item.planned_order;
    const rank = typeof rawRank === "number" && Number.isFinite(rawRank) ? rawRank : Number.MAX_SAFE_INTEGER;
    entries.push({ id, rank, index });
  }
  return entries
    .sort((left, right) => (left.rank - right.rank) || (left.index - right.index))
    .map((entry) => entry.id);
}

function addBlocker(blockers: Finding[], code: string, message: string, detail?: unknown): void {
  blockers.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function addWarning(warnings: Finding[], code: string, message: string, detail?: unknown): void {
  warnings.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function scanRoot(value: unknown): { scan: unknown; sourceShape: string } {
  if (isObject(value) && "pre_dispatch_scan" in value) {
    return { scan: value.pre_dispatch_scan, sourceShape: "run_state.pre_dispatch_scan" };
  }
  if (Array.isArray(value)) return { scan: value, sourceShape: "array" };
  return { scan: value, sourceShape: isObject(value) ? "scan_object" : typeof value };
}

function idsFromFutureScan(value: unknown, fieldNames: string[], arrayFallback: boolean): string[] | null {
  if (Array.isArray(value)) {
    if (!arrayFallback) return null;
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item === "string") ids.push(item);
      else if (isObject(item) && typeof item.id === "string") ids.push(item.id);
      else if (isObject(item) && typeof item.seed_id === "string") ids.push(item.seed_id);
    }
    return ids;
  }
  if (!isObject(value)) return null;
  for (const field of fieldNames) {
    const ids = stringArray(value[field]);
    if (ids) return ids;
  }
  const nested = value.seeds ?? value.items ?? value.issues;
  if (Array.isArray(nested)) return idsFromFutureScan(nested, fieldNames, arrayFallback);
  return null;
}

function normalizeScan(
  raw: unknown,
  adopted: string[],
  excluded: string[],
  manifestOrder: string[],
  path: string,
  blockers: Finding[],
): Result["scan"] {
  const { scan, sourceShape } = scanRoot(raw);
  const adoptedSet = new Set(adopted);
  const excludedSet = new Set(excluded);
  const objectScan = isObject(scan) ? scan : {};
  const readyIds =
    stringArray(objectScan.ready_ids) ?? idsFromFutureScan(scan, ["ready_ids", "adopted_ready_ids"], true) ?? [];
  const blockedIds =
    stringArray(objectScan.blocked_ids) ?? idsFromFutureScan(scan, ["blocked_ids", "adopted_blocked_ids"], false) ?? [];
  const rawAdoptedReady =
    stringArray(objectScan.adopted_ready_ids) ?? readyIds.filter((id) => adoptedSet.has(id));
  const rawExcludedReady =
    stringArray(objectScan.excluded_ready_ids) ?? readyIds.filter((id) => excludedSet.has(id));
  const rawAdoptedBlocked =
    stringArray(objectScan.adopted_blocked_ids) ?? blockedIds.filter((id) => adoptedSet.has(id));
  const adoptedReadyDupes = duplicateValues(rawAdoptedReady);
  const excludedReadyDupes = duplicateValues(rawExcludedReady);
  const adoptedBlockedDupes = duplicateValues(rawAdoptedBlocked);
  const adoptedReady = orderByManifest(uniqueStrings(rawAdoptedReady), manifestOrder);
  const excludedReady = uniqueStrings(rawExcludedReady);
  const adoptedBlocked = uniqueStrings(rawAdoptedBlocked);

  const badAdoptedReady = adoptedReady.filter((id) => !adoptedSet.has(id));
  const badExcludedReady = excludedReady.filter((id) => !excludedSet.has(id));
  const badAdoptedBlocked = adoptedBlocked.filter((id) => !adoptedSet.has(id));
  const readyBlockedOverlap = intersection(adoptedReady, adoptedBlocked);

  if (badAdoptedReady.length) {
    addBlocker(blockers, "scan_adopted_ready_outside_adopted", "adopted_ready_ids contains unadopted ids", badAdoptedReady);
  }
  if (adoptedReadyDupes.length) {
    addBlocker(blockers, "duplicate_scan_adopted_ready_ids", "adopted_ready_ids contains duplicates", adoptedReadyDupes);
  }
  if (badExcludedReady.length) {
    addBlocker(blockers, "scan_excluded_ready_outside_excluded", "excluded_ready_ids contains ids not excluded", badExcludedReady);
  }
  if (excludedReadyDupes.length) {
    addBlocker(blockers, "duplicate_scan_excluded_ready_ids", "excluded_ready_ids contains duplicates", excludedReadyDupes);
  }
  if (badAdoptedBlocked.length) {
    addBlocker(blockers, "scan_adopted_blocked_outside_adopted", "adopted_blocked_ids contains unadopted ids", badAdoptedBlocked);
  }
  if (adoptedBlockedDupes.length) {
    addBlocker(blockers, "duplicate_scan_adopted_blocked_ids", "adopted_blocked_ids contains duplicates", adoptedBlockedDupes);
  }
  if (readyBlockedOverlap.length) {
    addBlocker(blockers, "scan_ready_blocked_overlap", "adopted ready and blocked ids overlap", readyBlockedOverlap);
  }

  return {
    path,
    adopted_ready_ids: adoptedReady,
    excluded_ready_ids: excludedReady,
    adopted_blocked_ids: adoptedBlocked,
    source_shape: sourceShape,
  };
}

function check(options: Options): Result {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const adoptionPath = options.adoptionSelection ? resolve(options.repo, options.adoptionSelection) : null;
  let adoptionObject: JsonObject | null = null;

  if (!adoptionPath) {
    addBlocker(blockers, "missing_adoption_selection_arg", "--adoption-selection is required");
  } else if (!existsSync(adoptionPath)) {
    addBlocker(blockers, "missing_adoption_selection", "adoption-selection file does not exist", adoptionPath);
  } else {
    try {
      const parsed = readJson(adoptionPath);
      if (isObject(parsed)) adoptionObject = parsed;
      else addBlocker(blockers, "invalid_adoption_selection_shape", "adoption-selection must be a JSON object");
    } catch (error) {
      addBlocker(blockers, "invalid_adoption_selection_json", "adoption-selection is not valid JSON", String(error));
    }
  }

  const adopted = adoptionObject ? stringArray(adoptionObject.adopted_seed_ids) : null;
  const plannedOrder = adoptionObject ? orderedSeedIdsFromManifestField(adoptionObject.planned_order) : null;
  const excluded = adoptionObject ? stringArray(adoptionObject.excluded_open_seed_ids) : null;
  const baselineReady = adoptionObject ? stringArray(adoptionObject.baseline_ready_ids) ?? [] : [];
  const baselineBlocked = adoptionObject ? stringArray(adoptionObject.baseline_blocked_ids) ?? [] : [];
  const selectedLabel = stringField(adoptionObject?.selected_label);
  const sharedLabel = stringField(adoptionObject?.shared_label);
  const commitPolicy = stringField(adoptionObject?.commit_policy);

  if (adoptionObject && !adopted) addBlocker(blockers, "invalid_adopted_seed_ids", "adopted_seed_ids must be a string array");
  if (adoptionObject && adoptionObject.planned_order !== undefined && !plannedOrder) {
    addBlocker(blockers, "invalid_planned_order", "planned_order must be string array or array of {id|seed_id|seed, rank?}");
  }
  if (adoptionObject && adopted && adopted.length === 0) {
    addBlocker(blockers, "empty_adopted_seed_ids", "adopted_seed_ids must be nonempty");
  }
  if (adoptionObject && !excluded) {
    addBlocker(blockers, "invalid_excluded_open_seed_ids", "excluded_open_seed_ids must be a string array");
  }

  const adoptedIds = adopted ?? [];
  const manifestOrder = plannedOrder?.length ? plannedOrder : adoptedIds;
  const excludedIds = excluded ?? [];
  const adoptedDupes = duplicateValues(adoptedIds);
  const excludedDupes = duplicateValues(excludedIds);
  const adoptionOverlap = intersection(adoptedIds, excludedIds);
  const baselineReadyDupes = duplicateValues(baselineReady);
  const baselineBlockedDupes = duplicateValues(baselineBlocked);
  const baselineOverlap = intersection(baselineReady, baselineBlocked);
  const baselineReadyOutside = difference(baselineReady, adoptedIds);
  const baselineBlockedOutside = difference(baselineBlocked, adoptedIds);
  const plannedOrderDupes = duplicateValues(plannedOrder ?? []);
  const plannedOrderOutside = difference(plannedOrder ?? [], adoptedIds);

  if (adoptedDupes.length) addBlocker(blockers, "duplicate_adopted_seed_ids", "adopted_seed_ids contains duplicates", adoptedDupes);
  if (excludedDupes.length) addBlocker(blockers, "duplicate_excluded_open_seed_ids", "excluded_open_seed_ids contains duplicates", excludedDupes);
  if (adoptionOverlap.length) addBlocker(blockers, "adopted_excluded_overlap", "adopted and excluded work order ids overlap", adoptionOverlap);
  if (baselineReadyDupes.length) addBlocker(blockers, "duplicate_baseline_ready_ids", "baseline_ready_ids contains duplicates", baselineReadyDupes);
  if (baselineBlockedDupes.length) addBlocker(blockers, "duplicate_baseline_blocked_ids", "baseline_blocked_ids contains duplicates", baselineBlockedDupes);
  if (baselineOverlap.length) addBlocker(blockers, "baseline_ready_blocked_overlap", "baseline ready and blocked ids overlap", baselineOverlap);
  if (baselineReadyOutside.length) {
    addBlocker(blockers, "baseline_ready_outside_adopted", "baseline_ready_ids must be subset of adopted ids", baselineReadyOutside);
  }
  if (baselineBlockedOutside.length) {
    addBlocker(blockers, "baseline_blocked_outside_adopted", "baseline_blocked_ids must be subset of adopted ids", baselineBlockedOutside);
  }
  if (plannedOrderDupes.length) addBlocker(blockers, "duplicate_planned_order_ids", "planned_order contains duplicates", plannedOrderDupes);
  if (plannedOrderOutside.length) addBlocker(blockers, "planned_order_outside_adopted", "planned_order must be subset of adopted ids", plannedOrderOutside);

  if (options.expectedAdopted.length) {
    const mismatch = exactSetMismatch(adoptedIds, options.expectedAdopted);
    if (mismatch) addBlocker(blockers, "expected_adopted_mismatch", "adopted_seed_ids does not match expected set", mismatch);
  }
  if (options.expectNoExcluded && options.expectedExcluded.length) {
    addBlocker(blockers, "conflicting_expected_excluded_args", "--expect-no-excluded cannot be combined with --expected-excluded");
  }
  if (options.expectedExcluded.length || options.expectNoExcluded) {
    const mismatch = exactSetMismatch(excludedIds, options.expectedExcluded);
    if (mismatch) addBlocker(blockers, "expected_excluded_mismatch", "excluded_open_seed_ids does not match expected set", mismatch);
  }
  if (options.sharedLabel && selectedLabel !== options.sharedLabel && sharedLabel !== options.sharedLabel) {
    addBlocker(blockers, "shared_label_mismatch", "selected_label/shared_label does not match required label", {
      expected: options.sharedLabel,
      selected_label: selectedLabel,
      shared_label: sharedLabel,
    });
  }
  if (options.requireCommitPolicy && commitPolicy !== options.requireCommitPolicy) {
    addBlocker(blockers, "commit_policy_mismatch", "commit_policy does not match required policy", {
      expected: options.requireCommitPolicy,
      actual: commitPolicy,
    });
  }
  if (!adoptionObject?.baseline_state_counts) {
    addWarning(warnings, "missing_baseline_state_counts", "baseline_state_counts not present");
  }

  let scan: Result["scan"] = null;
  if (options.scanFile) {
    const scanPath = resolve(options.repo, options.scanFile);
    if (!existsSync(scanPath)) {
      addBlocker(blockers, "missing_scan_file", "scan file does not exist", scanPath);
    } else {
      try {
        scan = normalizeScan(readJson(scanPath), adoptedIds, excludedIds, manifestOrder, scanPath, blockers);
      } catch (error) {
        addBlocker(blockers, "invalid_scan_file_json", "scan file is not valid JSON", String(error));
      }
    }
  }

  const explicitCandidateIds = scan ? orderByManifest(scan.adopted_ready_ids, manifestOrder) : [];
  if (options.expectedFirstReady) {
    if (!scan) {
      addBlocker(blockers, "expected_first_ready_without_scan", "--expected-first-ready requires --scan-file");
    } else if (!explicitCandidateIds.length) {
      addBlocker(blockers, "expected_first_ready_no_adopted_ready", "scan has no adopted ready ids", {
        expected: options.expectedFirstReady,
      });
    } else if (explicitCandidateIds[0] !== options.expectedFirstReady) {
      addBlocker(blockers, "expected_first_ready_mismatch", "first adopted ready id does not match expected", {
        expected: options.expectedFirstReady,
        actual: explicitCandidateIds[0],
      });
    }
  }

  return {
    contract: "adoption_selection_check.v1",
    ok: blockers.length === 0,
    blockers,
    warnings,
    adoption: {
      path: adoptionPath,
      adopted_seed_ids: adoptedIds,
      planned_order: plannedOrder ?? [],
      excluded_open_seed_ids: excludedIds,
      baseline_ready_ids: baselineReady,
      baseline_blocked_ids: baselineBlocked,
      selected_label: selectedLabel,
      shared_label: sharedLabel,
      commit_policy: commitPolicy,
      assignee: stringField(adoptionObject?.assignee),
    },
    scan,
    explicit_candidate_ids: explicitCandidateIds,
    summary: {
      adopted_count: adoptedIds.length,
      excluded_count: excludedIds.length,
      baseline_ready_count: baselineReady.length,
      baseline_blocked_count: baselineBlocked.length,
      explicit_candidate_count: explicitCandidateIds.length,
    },
  };
}

function assertSelf(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) throw new Error(`self-test failed: ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function selfTest(pretty: boolean): Result {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-adoption-check-"));
  const valid = {
    adopted_seed_ids: ["seed-a", "seed-b"],
    excluded_open_seed_ids: ["seed-x"],
    baseline_ready_ids: ["seed-a"],
    baseline_blocked_ids: ["seed-b"],
    baseline_state_counts: { adopted_open: 2 },
    selected_label: "net-test",
    commit_policy: "per_seed",
    assignee: "codex",
  };

  try {
    const adoption = join(dir, "adoption-selection.json");
    const duplicate = join(dir, "duplicate.json");
    const scanPass = join(dir, "scan-pass.json");
    const scanFail = join(dir, "scan-fail.json");
    const scanReadyOnly = join(dir, "scan-ready-only.json");
    const scanArray = join(dir, "scan-array.json");
    const scanDupes = join(dir, "scan-dupes.json");
    const adoptionNoExcluded = join(dir, "adoption-no-excluded.json");
    const scanReversedReady = join(dir, "scan-reversed-ready.json");
    const plannedOrderAdoption = join(dir, "planned-order.json");
    writeJson(adoption, valid);
    writeJson(adoptionNoExcluded, { ...valid, excluded_open_seed_ids: [] });
    writeJson(plannedOrderAdoption, {
      ...valid,
      adopted_seed_ids: ["seed-a", "seed-b"],
      planned_order: [{ id: "seed-b", rank: 1 }, { id: "seed-a", rank: 2 }],
    });
    writeJson(duplicate, { ...valid, adopted_seed_ids: ["seed-a", "seed-a", "seed-x"] });
    writeJson(scanPass, { adopted_ready_ids: ["seed-a"], excluded_ready_ids: ["seed-x"], adopted_blocked_ids: ["seed-b"] });
    writeJson(scanFail, { adopted_ready_ids: ["seed-b"], adopted_blocked_ids: ["seed-b"] });
    writeJson(scanReadyOnly, { ready_ids: ["seed-a", "seed-x", "seed-z"], blocked_ids: ["seed-b"] });
    writeJson(scanReversedReady, { adopted_ready_ids: ["seed-b", "seed-a"] });
    writeJson(scanArray, ["seed-a", "seed-x"]);
    writeJson(scanDupes, {
      adopted_ready_ids: ["seed-a", "seed-a"],
      excluded_ready_ids: ["seed-x", "seed-x"],
      adopted_blocked_ids: ["seed-b", "seed-b"],
    });

    assertSelf("valid current-style manifest", check({
      repo: dir,
      adoptionSelection: adoption,
      expectedAdopted: ["seed-b", "seed-a"],
      expectedExcluded: ["seed-x"],
      sharedLabel: "net-test",
      requireCommitPolicy: "per_seed",
      pretty,
      selfTest: false,
    }).ok);
    assertSelf("duplicate/overlap failure", !check({
      repo: dir,
      adoptionSelection: duplicate,
      expectedAdopted: [],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    }).ok);
    assertSelf("expected exact mismatch", !check({
      repo: dir,
      adoptionSelection: adoption,
      expectedAdopted: ["seed-a"],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    }).ok);
    assertSelf("scan first-ready pass", check({
      repo: dir,
      adoptionSelection: adoption,
      scanFile: scanPass,
      expectedAdopted: [],
      expectedExcluded: [],
      expectedFirstReady: "seed-a",
      pretty,
      selfTest: false,
    }).ok);
    assertSelf("scan first-ready fail", !check({
      repo: dir,
      adoptionSelection: adoption,
      scanFile: scanFail,
      expectedAdopted: [],
      expectedExcluded: [],
      expectedFirstReady: "seed-a",
      pretty,
      selfTest: false,
    }).ok);
    const filtered = check({
      repo: dir,
      adoptionSelection: adoption,
      scanFile: scanReadyOnly,
      expectedAdopted: [],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    });
    assertSelf("scan ready filtered from ready_ids", filtered.ok && filtered.explicit_candidate_ids.join(",") === "seed-a", filtered);
    const manifestOrdered = check({
      repo: dir,
      adoptionSelection: adoption,
      scanFile: scanReversedReady,
      expectedAdopted: [],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    });
    assertSelf(
      "explicit candidates use adoption manifest order over scan order",
      manifestOrdered.ok && manifestOrdered.explicit_candidate_ids.join(",") === "seed-a,seed-b",
      manifestOrdered,
    );
    const plannedOrdered = check({
      repo: dir,
      adoptionSelection: plannedOrderAdoption,
      scanFile: scanReversedReady,
      expectedAdopted: [],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    });
    assertSelf(
      "planned_order rank beats adopted order",
      plannedOrdered.ok && plannedOrdered.explicit_candidate_ids.join(",") === "seed-b,seed-a",
      plannedOrdered,
    );
    const arrayScan = check({
      repo: dir,
      adoptionSelection: adoption,
      scanFile: scanArray,
      expectedAdopted: [],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    });
    assertSelf(
      "array scan ready-only default",
      arrayScan.ok &&
        arrayScan.scan?.adopted_ready_ids.join(",") === "seed-a" &&
        arrayScan.scan.excluded_ready_ids.join(",") === "seed-x" &&
        arrayScan.scan.adopted_blocked_ids.length === 0,
      arrayScan,
    );
    const scanDupesResult = check({
      repo: dir,
      adoptionSelection: adoption,
      scanFile: scanDupes,
      expectedAdopted: [],
      expectedExcluded: [],
      pretty,
      selfTest: false,
    });
    assertSelf(
      "scan duplicate arrays block and dedupe output",
      !scanDupesResult.ok &&
        scanDupesResult.blockers.some((finding) => finding.code === "duplicate_scan_adopted_ready_ids") &&
        scanDupesResult.blockers.some((finding) => finding.code === "duplicate_scan_excluded_ready_ids") &&
        scanDupesResult.blockers.some((finding) => finding.code === "duplicate_scan_adopted_blocked_ids") &&
        scanDupesResult.explicit_candidate_ids.join(",") === "seed-a",
      scanDupesResult,
    );
    assertSelf("expect no excluded fails nonempty", !check({
      repo: dir,
      adoptionSelection: adoption,
      expectedAdopted: [],
      expectedExcluded: [],
      expectNoExcluded: true,
      pretty,
      selfTest: false,
    }).ok);
    assertSelf("expect no excluded passes empty", check({
      repo: dir,
      adoptionSelection: adoptionNoExcluded,
      expectedAdopted: [],
      expectedExcluded: [],
      expectNoExcluded: true,
      pretty,
      selfTest: false,
    }).ok);

    return {
      contract: "adoption_selection_check.v1",
      ok: true,
      blockers: [],
      warnings: [],
      adoption: {
        path: adoption,
        adopted_seed_ids: valid.adopted_seed_ids,
        planned_order: [],
        excluded_open_seed_ids: valid.excluded_open_seed_ids,
        baseline_ready_ids: valid.baseline_ready_ids,
        baseline_blocked_ids: valid.baseline_blocked_ids,
        selected_label: valid.selected_label,
        shared_label: null,
        commit_policy: valid.commit_policy,
        assignee: valid.assignee,
      },
      scan: null,
      explicit_candidate_ids: [],
      summary: { self_tests: 11 },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printResult(result: Result, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = options.selfTest ? selfTest(options.pretty) : check(options);
  printResult(result, options.pretty);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  const result: Result = {
    contract: "adoption_selection_check.v1",
    ok: false,
    blockers: [{ code: "usage_or_crash", message: String(error) }],
    warnings: [],
    adoption: {
      path: null,
      adopted_seed_ids: [],
      planned_order: [],
      excluded_open_seed_ids: [],
      baseline_ready_ids: [],
      baseline_blocked_ids: [],
      selected_label: null,
      shared_label: null,
      commit_policy: null,
      assignee: null,
    },
    scan: null,
    explicit_candidate_ids: [],
    summary: {},
  };
  printResult(result, process.argv.includes("--pretty"));
  process.exit(2);
}
