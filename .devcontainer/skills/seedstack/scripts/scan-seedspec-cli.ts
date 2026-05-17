#!/usr/bin/env bun
// Deterministic read-only work queue CLI scan normalizer.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type JsonObject = Record<string, unknown>;
type CommandName = "health" | "list" | "ready" | "blocked";
type HealthState = "pass" | "warning" | "fail" | "unknown";
type Finding = { code: string; message: string; detail?: unknown };
type Issue = {
  id: string;
  status: string | null;
  labels: string[];
  priority: number | null;
  createdAt: string | null;
  blockedBy: string[];
  blocks: string[];
  updatedAt: string | null;
  closedAt: string | null;
  assignee: string | null;
};
type CommandRun = {
  name: CommandName;
  argv: string[];
  exit_code: number | null;
  fixture_path: string | null;
  stderr?: string;
};
type Options = {
  repo: string;
  cli: string;
  adoptionSelection?: string;
  adopted: string[];
  excluded: string[];
  label?: string;
  fixtureFiles: Partial<Record<CommandName, string>>;
  pretty: boolean;
  selfTest: boolean;
};
type Scan = {
  contract: "seedstack_scan.v1";
  ok: boolean;
  blockers: Finding[];
  warnings: Finding[];
  repo: string;
  cli: string;
  commands: CommandRun[];
  health: HealthState;
  counts: JsonObject;
  ids: {
    list_ids: string[];
    open_ids: string[];
    closed_ids: string[];
    ready_ids: string[];
    blocked_ids: string[];
    adopted_ready_ids: string[];
    excluded_ready_ids: string[];
    adopted_blocked_ids: string[];
    adopted_closed_ids: string[];
    adopted_open_ids: string[];
    unadopted_ready_ids: string[];
  };
  adopted: {
    adopted_seed_ids: string[];
    excluded_open_seed_ids: string[];
    selected_label: string | null;
    source: "cli" | "adoption_selection" | "label" | "none";
    path: string | null;
  };
  ready_ids: string[];
  issues: Issue[];
  adopted_ready_ids: string[];
  excluded_ready_ids: string[];
  adopted_blocked_ids: string[];
  closed_adopted: string[];
  open_adopted: string[];
  summaries: JsonObject;
  adoption_checker_scan: {
    ready_ids: string[];
    adopted_ready_ids: string[];
    excluded_ready_ids: string[];
    adopted_blocked_ids: string[];
    closed_adopted: string[];
    open_adopted: string[];
  };
};

const HELP = `scan-seedspec-cli.ts seedstack_scan.v1

Usage:
  bun skills/seedstack/scripts/scan-seedspec-cli.ts [args]
  bun skills/seedstack/scripts/scan-seedspec-cli.ts --self-test [--pretty]

Args:
  --repo <path>                         Repo root. Default: cwd.
  --cli <path>                          work queue CLI. Default: sd.
  --adoption-selection <path>           adoption-selection.json path.
  --adopted <id>                        Active adopted work order id. Repeatable.
  --excluded <id>                       Excluded open work order id. Repeatable.
  --label <label>                       Label-derived adoption filter.
  --health-file <json>                  health fixture JSON instead of CLI.
  --list-file <json>                    list fixture JSON instead of CLI.
  --ready-file <json>                   ready fixture JSON instead of CLI.
  --blocked-file <json>                 blocked fixture JSON instead of CLI.
  --pretty                              Pretty-print JSON.
  --self-test                           Run fixture tests.
  --help                                Show this help.
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
    cli: "sd",
    adopted: [],
    excluded: [],
    fixtureFiles: {},
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
      case "--cli":
        options.cli = take();
        break;
      case "--adoption-selection":
        options.adoptionSelection = take();
        break;
      case "--adopted":
        options.adopted.push(take());
        break;
      case "--excluded":
        options.excluded.push(take());
        break;
      case "--label":
        options.label = take();
        break;
      case "--health-file":
        options.fixtureFiles.health = take();
        break;
      case "--list-file":
        options.fixtureFiles.list = take();
        break;
      case "--ready-file":
        options.fixtureFiles.ready = take();
        break;
      case "--blocked-file":
        options.fixtureFiles.blocked = take();
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--cli=")) options.cli = arg.slice("--cli=".length);
        else if (arg.startsWith("--adoption-selection=")) options.adoptionSelection = arg.slice("--adoption-selection=".length);
        else if (arg.startsWith("--adopted=")) options.adopted.push(arg.slice("--adopted=".length));
        else if (arg.startsWith("--excluded=")) options.excluded.push(arg.slice("--excluded=".length));
        else if (arg.startsWith("--label=")) options.label = arg.slice("--label=".length);
        else if (arg.startsWith("--health-file=")) options.fixtureFiles.health = arg.slice("--health-file=".length);
        else if (arg.startsWith("--list-file=")) options.fixtureFiles.list = arg.slice("--list-file=".length);
        else if (arg.startsWith("--ready-file=")) options.fixtureFiles.ready = arg.slice("--ready-file=".length);
        else if (arg.startsWith("--blocked-file=")) options.fixtureFiles.blocked = arg.slice("--blocked-file=".length);
        else throw new Error(`unknown arg: ${arg}`);
    }
  }
  options.repo = resolve(options.repo);
  options.cli = options.cli.includes("/") ? resolve(options.repo, options.cli) : options.cli;
  return options;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function exactStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dupes(values: string[]): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found].sort(asciiCompare);
}

function asciiCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function issueCompare(left: Issue, right: Issue): number {
  // Generic buckets sort by priority, createdAt, id. Ready/blocked buckets preserve CLI order.
  const lp = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rp = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (lp !== rp) return lp - rp;
  const lc = left.createdAt ?? "";
  const rc = right.createdAt ?? "";
  const created = asciiCompare(lc, rc);
  return created || asciiCompare(left.id, right.id);
}

function addFinding(target: Finding[], code: string, message: string, detail?: unknown): void {
  target.push({ code, message, ...(detail === undefined ? {} : { detail }) });
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function installHint(cli: string): string {
  return cli === "sd"
    ? "sd CLI not found. Install seed from https://github.com/jayminwest/seeds, then retry."
    : `work queue CLI not found: ${cli}. Install seed from https://github.com/jayminwest/seeds or pass --cli <path>, then retry.`;
}

function commandArg(name: CommandName): string {
  return name;
}

function runCommand(name: CommandName, options: Options): { command: CommandRun; raw: unknown; parseError?: string } {
  const fixture = options.fixtureFiles[name];
  const argv = fixture ? [resolve(options.repo, fixture)] : [options.cli, commandArg(name), "--json"];
  if (fixture) {
    const path = resolve(options.repo, fixture);
    const command = { name, argv, exit_code: 0, fixture_path: path };
    try {
      return {
        command,
        raw: readJsonFile(path),
      };
    } catch (error) {
      return { command, raw: null, parseError: String(error) };
    }
  }
  const result = spawnSync(options.cli, [commandArg(name), "--json"], {
    cwd: options.repo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(installHint(options.cli));
  const command = { name, argv, exit_code: result.status, fixture_path: null, stderr: result.stderr.trim() || undefined };
  const stdout = result.stdout.trim();
  try {
    if (!stdout) throw new Error(`${commandArg(name)} produced empty stdout`);
    return {
      command,
      raw: JSON.parse(stdout),
    };
  } catch (error) {
    return { command, raw: null, parseError: String(error) };
  }
}

function validateEnvelope(raw: unknown, expected: CommandName, blockers: Finding[]): JsonObject | null {
  if (!isObject(raw)) {
    addFinding(blockers, "invalid_envelope", `${expected} JSON must be object`);
    return null;
  }
  if (typeof raw.success === "boolean") {
    if (raw.command !== undefined && raw.command !== expected) {
      addFinding(blockers, "command_mismatch", `${expected} command field mismatch`, raw.command);
    }
    if (raw.success === false && expected !== "health") {
      addFinding(blockers, "command_not_ok", `${expected} reported success=false`);
    }
    return raw;
  }
  if (typeof raw.ok !== "boolean") addFinding(blockers, "invalid_ok", `${expected} ok must be boolean`);
  if (raw.command !== undefined && raw.command !== expected) {
    addFinding(blockers, "command_mismatch", `${expected} command field mismatch`, raw.command);
  }
  if (!isObject(raw.data)) {
    addFinding(blockers, "invalid_data", `${expected} data must be object`);
    return null;
  }
  if (raw.ok === false && expected !== "health") {
    addFinding(blockers, "command_not_ok", `${expected} reported ok=false`);
  }
  return raw.data;
}

function normalizeIssue(value: unknown, command: CommandName, blockers: Finding[]): Issue | null {
  if (!isObject(value) || typeof value.id !== "string") {
    addFinding(blockers, "invalid_issue", `${command} issue missing string id`, value);
    return null;
  }
  const priority = typeof value.priority === "number" && Number.isFinite(value.priority) ? value.priority : null;
  return {
    id: value.id,
    status: stringField(value.status),
    labels: stringArray(value.labels),
    priority,
    createdAt: stringField(value.createdAt),
    blockedBy: stringArray(value.blockedBy),
    blocks: stringArray(value.blocks),
    updatedAt: stringField(value.updatedAt),
    closedAt: stringField(value.closedAt),
    assignee: stringField(value.assignee),
  };
}

function parseIssues(data: JsonObject | null, command: CommandName, blockers: Finding[]): Issue[] {
  if (!data) return [];
  if (!Array.isArray(data.issues)) {
    addFinding(blockers, "invalid_issues", `${command} data.issues must be array`);
    return [];
  }
  const issues = data.issues.flatMap((issue) => {
    const normalized = normalizeIssue(issue, command, blockers);
    return normalized ? [normalized] : [];
  });
  const count = data.count;
  if (count !== undefined && count !== issues.length) {
    addFinding(blockers, "count_mismatch", `${command} data.count does not match issues.length`, {
      count,
      issues_length: issues.length,
    });
  }
  const duplicates = dupes(issues.map((issue) => issue.id));
  if (duplicates.length) addFinding(blockers, "duplicate_ids", `${command} contains duplicate ids`, duplicates);
  return issues;
}

function healthState(raw: unknown, data: JsonObject | null, blockers: Finding[], warnings: Finding[]): HealthState {
  if (!isObject(raw) || !data) return "unknown";
  const summary = isObject(data.summary) ? data.summary : {};
  const errorCount = typeof summary.error === "number" ? summary.error : typeof summary.fail === "number" ? summary.fail : 0;
  const warningCount = typeof summary.warning === "number" ? summary.warning : typeof summary.warn === "number" ? summary.warn : 0;
  const ok = typeof raw.ok === "boolean" ? raw.ok : typeof raw.success === "boolean" ? raw.success : true;
  if (!ok || errorCount > 0) {
    addFinding(blockers, "health_failed", "health reported failure", { ok, error: errorCount });
    return "fail";
  }
  if (warningCount > 0) {
    addFinding(warnings, "health_warning", "health reported warnings", { warning: warningCount });
    return "warning";
  }
  return "pass";
}

function adoptionFromFile(options: Options, blockers: Finding[], warnings: Finding[]): JsonObject | null {
  if (!options.adoptionSelection) return null;
  const path = resolve(options.repo, options.adoptionSelection);
  if (!existsSync(path)) {
    addFinding(blockers, "missing_adoption_selection", "adoption-selection file does not exist", path);
    return null;
  }
  try {
    const parsed = readJsonFile(path);
    if (isObject(parsed)) return parsed;
    addFinding(blockers, "invalid_adoption_selection_shape", "adoption-selection must be object");
  } catch (error) {
    addFinding(blockers, "invalid_adoption_selection_json", "adoption-selection is not valid JSON", String(error));
  }
  if (options.adopted.length || options.excluded.length) {
    addFinding(warnings, "cli_adoption_overrides_file", "--adopted/--excluded override matching adoption file sets");
  }
  return null;
}

function idsByIssueOrder(ids: string[], issueMap: Map<string, Issue>): string[] {
  return unique(ids).sort((left, right) => {
    const li = issueMap.get(left);
    const ri = issueMap.get(right);
    if (li && ri) return issueCompare(li, ri);
    if (li) return -1;
    if (ri) return 1;
    return asciiCompare(left, right);
  });
}

function classify(options: Options): Scan {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const commands: CommandRun[] = [];
  const outputs = new Map<CommandName, unknown>();
  const usingCli = !options.fixtureFiles.list && !options.fixtureFiles.ready && !options.fixtureFiles.blocked;

  if (usingCli && !existsSync(join(options.repo, ".seeds"))) {
    const probe = spawnSync(options.cli, ["--version"], { cwd: options.repo, encoding: "utf8", maxBuffer: 1024 * 1024 });
    if (probe.error) throw new Error(installHint(options.cli));
    addFinding(blockers, "seeds_store_missing", "No .seeds store found. Stop run/manage; ask user before running sd init.");
    return {
      contract: "seedstack_scan.v1",
      ok: false,
      blockers,
      warnings,
      repo: options.repo,
      cli: options.cli,
      commands,
      health: "unknown",
      counts: {
        list: 0,
        open: 0,
        closed: 0,
        ready: 0,
        blocked: 0,
        adopted: 0,
        excluded: 0,
        adopted_ready: 0,
        excluded_ready: 0,
        adopted_blocked: 0,
        adopted_open: 0,
        adopted_closed: 0,
        unadopted_ready: 0,
      },
      ids: {
        list_ids: [],
        open_ids: [],
        closed_ids: [],
        ready_ids: [],
        blocked_ids: [],
        adopted_ready_ids: [],
        excluded_ready_ids: [],
        adopted_blocked_ids: [],
        adopted_closed_ids: [],
        adopted_open_ids: [],
        unadopted_ready_ids: [],
      },
      adopted: {
        adopted_seed_ids: [],
        excluded_open_seed_ids: [],
        selected_label: options.label ?? null,
        source: options.label ? "label" : "none",
        path: null,
      },
      ready_ids: [],
      issues: [],
      adopted_ready_ids: [],
      excluded_ready_ids: [],
      adopted_blocked_ids: [],
      closed_adopted: [],
      open_adopted: [],
      summaries: {
        health: null,
        list: { count: null },
        ready: { count: null },
        blocked: { count: null },
      },
      adoption_checker_scan: {
        ready_ids: [],
        adopted_ready_ids: [],
        excluded_ready_ids: [],
        adopted_blocked_ids: [],
        closed_adopted: [],
        open_adopted: [],
      },
    };
  }

  for (const name of ["health", "list", "ready", "blocked"] as CommandName[]) {
    const output = runCommand(name, options);
    commands.push(output.command);
    outputs.set(name, output.raw);
    if (output.command.exit_code !== 0 && name !== "health") {
      const raw = isObject(output.raw) ? output.raw : {};
      const errorText = typeof raw.error === "string" ? raw.error : output.command.stderr ?? "";
      if (errorText.includes("Not in a seeds project")) {
        addFinding(blockers, "seeds_store_missing", "No .seeds store found. Stop run/manage; ask user before running sd init.", {
          command: output.command.name,
          exit_code: output.command.exit_code,
        });
      } else {
        addFinding(blockers, "command_exit_nonzero", `${name} exited nonzero`, output.command.exit_code);
      }
    }
    if (output.command.exit_code !== 0 && name === "health") {
      addFinding(warnings, "health_unavailable", "health command unavailable or nonzero; treating health as unknown", output.command.exit_code);
    }
    if (output.parseError && name !== "health") {
      addFinding(blockers, "command_parse_error", `${name} output is not valid JSON`, {
        command: output.command,
        error: output.parseError,
      });
    } else if (output.parseError) {
      addFinding(warnings, "health_parse_error", "health output unavailable or not valid JSON", {
        command: output.command,
        error: output.parseError,
      });
    }
  }

  const rawHealth = outputs.get("health");
  const healthData = rawHealth === null ? null : validateEnvelope(rawHealth, "health", blockers);
  const listData = validateEnvelope(outputs.get("list"), "list", blockers);
  const readyData = validateEnvelope(outputs.get("ready"), "ready", blockers);
  const blockedData = validateEnvelope(outputs.get("blocked"), "blocked", blockers);
  const health = healthState(outputs.get("health"), healthData, blockers, warnings);
  const listIssues = parseIssues(listData, "list", blockers);
  const readyIssues = parseIssues(readyData, "ready", blockers);
  const blockedIssues = parseIssues(blockedData, "blocked", blockers);

  const listIds = listIssues.map((issue) => issue.id);
  const listSet = new Set(listIds);
  const listIssueMap = new Map<string, Issue>();
  for (const issue of listIssues) if (!listIssueMap.has(issue.id)) listIssueMap.set(issue.id, issue);
  const issueMap = new Map<string, Issue>();
  for (const issue of listIssues) if (!issueMap.has(issue.id)) issueMap.set(issue.id, issue);
  for (const issue of readyIssues) if (!issueMap.has(issue.id)) issueMap.set(issue.id, issue);
  for (const issue of blockedIssues) if (!issueMap.has(issue.id)) issueMap.set(issue.id, issue);

  const readyIds = unique(readyIssues.map((issue) => issue.id));
  const blockedIds = unique(blockedIssues.map((issue) => issue.id));
  const readyOutsideList = readyIds.filter((id) => !listSet.has(id));
  const blockedOutsideList = blockedIds.filter((id) => !listSet.has(id));
  const readyBlockedOverlap = readyIds.filter((id) => blockedIds.includes(id));
  const readyClosed = readyIssues
    .filter((issue) => (listIssueMap.get(issue.id)?.status ?? issue.status) === "closed")
    .map((issue) => issue.id);
  const blockedClosed = blockedIssues
    .filter((issue) => (listIssueMap.get(issue.id)?.status ?? issue.status) === "closed")
    .map((issue) => issue.id);
  if (listData) {
    if (readyOutsideList.length) addFinding(blockers, "ready_id_outside_list", "ready ids missing from list", readyOutsideList);
    if (blockedOutsideList.length) addFinding(blockers, "blocked_id_outside_list", "blocked ids missing from list", blockedOutsideList);
  }
  if (readyBlockedOverlap.length) addFinding(blockers, "ready_blocked_overlap", "ready and blocked ids overlap", readyBlockedOverlap);
  if (readyClosed.length) addFinding(blockers, "ready_closed_status", "ready issues must not be closed", readyClosed);
  if (blockedClosed.length) addFinding(blockers, "blocked_closed_status", "blocked issues must not be closed", blockedClosed);

  const adoptionFile = adoptionFromFile(options, blockers, warnings);
  const adoptionPath = options.adoptionSelection ? resolve(options.repo, options.adoptionSelection) : null;
  const selectedLabel =
    options.label ?? stringField(adoptionFile?.selected_label) ?? stringField(adoptionFile?.shared_label);
  const fileAdopted = adoptionFile ? exactStringArray(adoptionFile.adopted_seed_ids) : null;
  if (adoptionFile && !fileAdopted) addFinding(blockers, "invalid_adopted_seed_ids", "adopted_seed_ids must be a string array");
  if (adoptionFile && fileAdopted && fileAdopted.length === 0) {
    addFinding(blockers, "empty_adopted_seed_ids", "adopted_seed_ids must be nonempty");
  }
  const adoptedSource: Scan["adopted"]["source"] =
    adoptionFile ? "adoption_selection" : options.adopted.length ? "cli" : selectedLabel ? "label" : "none";
  const adoptedIds =
    adoptedSource === "cli"
      ? unique(options.adopted)
      : adoptedSource === "adoption_selection"
        ? unique(fileAdopted ?? [])
        : adoptedSource === "label"
          ? listIssues.filter((issue) => issue.labels.includes(selectedLabel ?? "")).map((issue) => issue.id)
          : [];
  const excludedIds = unique(options.excluded.length ? options.excluded : stringArray(adoptionFile?.excluded_open_seed_ids));
  const adoptedSet = new Set(adoptedIds);
  const excludedSet = new Set(excludedIds);

  const openIds = idsByIssueOrder(listIssues.filter((issue) => issue.status !== "closed").map((issue) => issue.id), issueMap);
  const closedIds = idsByIssueOrder(listIssues.filter((issue) => issue.status === "closed").map((issue) => issue.id), issueMap);
  const adoptedReadyIds = readyIds.filter((id) => adoptedSet.has(id));
  const excludedReadyIds = readyIds.filter((id) => excludedSet.has(id));
  const adoptedBlockedIds = blockedIds.filter((id) => adoptedSet.has(id));
  const adoptedClosedIds = idsByIssueOrder(closedIds.filter((id) => adoptedSet.has(id)), issueMap);
  const adoptedOpenIds = idsByIssueOrder(openIds.filter((id) => adoptedSet.has(id)), issueMap);
  const unadoptedReadyIds = readyIds.filter((id) => !adoptedSet.has(id) && !excludedSet.has(id));

  return {
    contract: "seedstack_scan.v1",
    ok: blockers.length === 0 && health !== "fail",
    blockers,
    warnings,
    repo: options.repo,
    cli: options.cli,
    commands,
    health,
    counts: {
      list: listIssues.length,
      open: openIds.length,
      closed: closedIds.length,
      ready: readyIds.length,
      blocked: blockedIds.length,
      adopted: adoptedIds.length,
      excluded: excludedIds.length,
      adopted_ready: adoptedReadyIds.length,
      excluded_ready: excludedReadyIds.length,
      adopted_blocked: adoptedBlockedIds.length,
      adopted_open: adoptedOpenIds.length,
      adopted_closed: adoptedClosedIds.length,
      unadopted_ready: unadoptedReadyIds.length,
    },
    ids: {
      list_ids: listIds,
      open_ids: openIds,
      closed_ids: closedIds,
      ready_ids: readyIds,
      blocked_ids: blockedIds,
      adopted_ready_ids: adoptedReadyIds,
      excluded_ready_ids: excludedReadyIds,
      adopted_blocked_ids: adoptedBlockedIds,
      adopted_closed_ids: adoptedClosedIds,
      adopted_open_ids: adoptedOpenIds,
      unadopted_ready_ids: unadoptedReadyIds,
    },
    adopted: {
      adopted_seed_ids: adoptedIds,
      excluded_open_seed_ids: excludedIds,
      selected_label: selectedLabel ?? null,
      source: adoptedSource,
      path: adoptionPath,
    },
    ready_ids: readyIds,
    issues: idsByIssueOrder(listIssues.map((issue) => issue.id), issueMap).flatMap((id) => {
      const issue = issueMap.get(id);
      return issue ? [issue] : [];
    }),
    adopted_ready_ids: adoptedReadyIds,
    excluded_ready_ids: excludedReadyIds,
    adopted_blocked_ids: adoptedBlockedIds,
    closed_adopted: adoptedClosedIds,
    open_adopted: adoptedOpenIds,
    summaries: {
      health: isObject(healthData?.summary) ? healthData?.summary : null,
      list: { count: listData?.count ?? null },
      ready: { count: readyData?.count ?? null },
      blocked: { count: blockedData?.count ?? null },
    },
    adoption_checker_scan: {
      ready_ids: readyIds,
      adopted_ready_ids: adoptedReadyIds,
      excluded_ready_ids: excludedReadyIds,
      adopted_blocked_ids: adoptedBlockedIds,
      closed_adopted: adoptedClosedIds,
      open_adopted: adoptedOpenIds,
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(command: CommandName, data: JsonObject, ok = true): JsonObject {
  return { ok, command, data };
}

function issue(id: string, extra: JsonObject = {}): JsonObject {
  return { id, status: "open", labels: [], priority: 1, createdAt: "2026-01-01T00:00:00Z", ...extra };
}

function runFixture(dir: string, label?: string): Options {
  return {
    repo: dir,
    cli: join(dir, "seedspec"),
    adopted: [],
    excluded: [],
    label,
    fixtureFiles: {
      health: join(dir, "health.json"),
      list: join(dir, "list.json"),
      ready: join(dir, "ready.json"),
      blocked: join(dir, "blocked.json"),
    },
    pretty: false,
    selfTest: false,
  };
}

function assertSelf(name: string, condition: boolean, detail?: unknown): void {
  if (!condition) throw new Error(`self-test failed: ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

function selfTest(pretty: boolean): Scan {
  const dir = mkdtempSync(join(tmpdir(), "seedstack-scan-"));
  try {
    writeJson(join(dir, "health.json"), fixture("health", { checks: [], summary: { error: 0, pass: 1, warning: 0 } }));
    writeJson(join(dir, "list.json"), fixture("list", {
      count: 4,
      issues: [
        issue("seed-a", { labels: ["net"], priority: 0 }),
        issue("seed-b", { labels: ["net"], priority: 1, createdAt: "2026-01-02T00:00:00Z" }),
        issue("seed-x", { labels: ["other"], priority: 2 }),
        issue("seed-c", { status: "closed", labels: ["net"], priority: 3, closedAt: "2026-01-03T00:00:00Z" }),
      ],
    }));
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 2, issues: [issue("seed-a"), issue("seed-x")] }));
    writeJson(join(dir, "blocked.json"), fixture("blocked", { count: 1, issues: [issue("seed-b")] }));
    writeJson(join(dir, "adoption-selection.json"), {
      adopted_seed_ids: ["seed-a", "seed-b", "seed-c"],
      excluded_open_seed_ids: ["seed-x"],
      selected_label: "net",
    });

    const happy = classify({ ...runFixture(dir), adoptionSelection: join(dir, "adoption-selection.json"), pretty, selfTest: false });
    assertSelf("happy ok", happy.ok, happy.blockers);
    assertSelf("adopted ready", happy.ids.adopted_ready_ids.join(",") === "seed-a", happy.ids);
    assertSelf("excluded ready", happy.ids.excluded_ready_ids.join(",") === "seed-x", happy.ids);
    assertSelf("adopted blocked", happy.ids.adopted_blocked_ids.join(",") === "seed-b", happy.ids);
    assertSelf("adopted closed", happy.ids.adopted_closed_ids.join(",") === "seed-c", happy.ids);
    assertSelf("full records emitted", happy.issues.length === 4 && happy.issues[0]?.labels.includes("net"), happy.issues);

    writeJson(join(dir, "health.json"), fixture("health", { checks: [], summary: { error: 1, pass: 0, warning: 0 } }));
    assertSelf("health failure", !classify(runFixture(dir)).ok);
    writeJson(join(dir, "health.json"), fixture("health", { checks: [], summary: { error: 0, pass: 1, warning: 0 } }));
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 3, issues: [issue("seed-a")] }));
    assertSelf("count mismatch", !classify(runFixture(dir)).ok);
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 2, issues: [issue("seed-a"), issue("seed-a")] }));
    assertSelf("duplicate ids", !classify(runFixture(dir)).ok);
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 1, issues: [issue("seed-z")] }));
    assertSelf("ready outside list", !classify(runFixture(dir)).ok);
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 2, issues: [issue("seed-a"), issue("seed-x")] }));
    const labelScan = classify(runFixture(dir, "net"));
    assertSelf("label-derived adopted ids", labelScan.adopted.adopted_seed_ids.join(",") === "seed-a,seed-b,seed-c", labelScan.adopted);
    assertSelf("excluded ready classification", happy.adoption_checker_scan.excluded_ready_ids[0] === "seed-x", happy.adoption_checker_scan);

    writeJson(join(dir, "list.json"), fixture("list", { count: 0, issues: [] }));
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 1, issues: [issue("seed-a")] }));
    const emptyListReady = classify(runFixture(dir));
    assertSelf(
      "empty list still checks ready existence",
      emptyListReady.blockers.some((finding) => finding.code === "ready_id_outside_list"),
      emptyListReady.blockers,
    );

    writeJson(join(dir, "list.json"), fixture("list", {
      count: 4,
      issues: [
        issue("seed-a", { labels: ["net"], priority: 0 }),
        issue("seed-b", { labels: ["net"], priority: 1, createdAt: "2026-01-02T00:00:00Z" }),
        issue("seed-x", { labels: ["other"], priority: 2 }),
        issue("seed-c", { status: "closed", labels: ["net"], priority: 3, closedAt: "2026-01-03T00:00:00Z" }),
      ],
    }));
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 2, issues: [issue("seed-a"), issue("seed-x")] }));
    writeJson(join(dir, "adoption-selection-empty.json"), {
      adopted_seed_ids: [],
      excluded_open_seed_ids: [],
      selected_label: "net",
    });
    const emptyAdoption = classify({
      ...runFixture(dir, "net"),
      adoptionSelection: join(dir, "adoption-selection-empty.json"),
      pretty,
      selfTest: false,
    });
    assertSelf("empty adoption file source wins", emptyAdoption.adopted.source === "adoption_selection", emptyAdoption.adopted);
    assertSelf("empty adoption does not use label ids", emptyAdoption.adopted.adopted_seed_ids.length === 0, emptyAdoption.adopted);
    assertSelf(
      "empty adoption blocks",
      emptyAdoption.blockers.some((finding) => finding.code === "empty_adopted_seed_ids"),
      emptyAdoption.blockers,
    );

    writeJson(join(dir, "list.json"), fixture("list", { count: 1, issues: [issue("seed-a", { status: "closed" })] }));
    writeJson(join(dir, "ready.json"), fixture("ready", { count: 1, issues: [issue("seed-a", { status: "open" })] }));
    const closedReady = classify(runFixture(dir));
    assertSelf(
      "list closed canonical status blocks ready",
      closedReady.blockers.some((finding) => finding.code === "ready_closed_status"),
      closedReady.blockers,
    );

    writeFileSync(join(dir, "list.json"), "{");
    const invalidJson = classify(runFixture(dir));
    const parseBlocker = invalidJson.blockers.find((finding) => finding.code === "command_parse_error");
    assertSelf("invalid json command blocks", Boolean(parseBlocker), invalidJson.blockers);
    assertSelf("invalid json preserves command", invalidJson.commands.some((command) => command.name === "list"), invalidJson.commands);

    return happy;
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
    const result = options.selfTest ? selfTest(options.pretty) : classify(options);
    process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const crash = {
      contract: "seedstack_scan.v1",
      ok: false,
      blockers: [{ code: "seed_cli_unavailable", message: String(error) }],
      warnings: [],
    };
    process.stderr.write(`${JSON.stringify(crash, null, 2)}\n`);
    process.exit(2);
  }
}

main();
