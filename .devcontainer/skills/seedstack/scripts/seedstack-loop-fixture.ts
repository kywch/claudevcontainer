#!/usr/bin/env bun
// Cheap end-to-end Seedstack loop fixture runner.

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDispatchRound } from "./fixtures/dispatch-artifacts.ts";

type JsonObject = Record<string, unknown>;
type EventAssertion = { event: string; fields?: JsonObject };
type Scenario = {
  name: string;
  seed: string;
  adopted_seeds?: string[];
  commit_policy?: "none" | "per_seed";
  prewrite_stop_after_seed?: boolean | { reason?: string };
  pre_dirty_queue_paths?: string[];
  create_stop_after_seed_after_ms?: number;
  post_seed_delay_ms?: number;
  prewrite_dispatch_round?: {
    execute_verdict?: "pass" | "block" | "risk";
    execute_recommendation?: "close" | "retry" | "escalate";
    gate_decision?: "close" | "retry" | "escalate";
  };
  must_emit?: EventAssertion[];
  event_assertions?: {
    counts?: Array<EventAssertion & { count: number }>;
    order?: EventAssertion[];
  };
  expected: {
    exit_code: number;
    final_state: string;
    reason?: string;
    final_fields?: JsonObject;
  };
  state?: JsonObject;
  run_state?: JsonObject;
};

type Options = {
  repo: string;
  scenarioFiles: string[];
  keep: boolean;
  pretty: boolean;
  selfTest: boolean;
};

type ScenarioResult = {
  name: string;
  ok: boolean;
  repo: string;
  seedstack_dir: string;
  exit_code: number | null;
  expected: Scenario["expected"];
  final_event: JsonObject | null;
  missing_assertions: string[];
  stdout_path: string;
  stderr_path: string;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SEEDSTACK_DIR = dirname(SCRIPT_DIR);
const REPO = resolve(SEEDSTACK_DIR, "..", "..");
const DEFAULT_SCENARIOS = [
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "happy-path.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "dispatch-validation-blocked.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "dispatch-child-blocked.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "dispatch-child-crashed-result.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "dispatch-escalated-enters-manage.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "dispatch-escalated-resume.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "retry-same-seed.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "unsafe-continue-after-nonclosed.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "per-seed-commit.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "per-seed-two-seeds.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "stop-after-seed.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "stop-after-seed-idle-start.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "preexisting-queue-dirty-before-auto-run.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "unexpected-dirty-before-next-seed.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "attempt-cap-skip-continues.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "manage-followup-cap.json"),
  join(SEEDSTACK_DIR, "test", "loop-scenarios", "manage-direct-queue-mutation.json"),
];

const HELP = `seedstack-loop-fixture.ts seedstack_loop_fixture.v1

Usage:
  bun skills/seedstack/scripts/seedstack-loop-fixture.ts [--scenario <json>...] [--pretty]
  bun skills/seedstack/scripts/seedstack-loop-fixture.ts --self-test [--pretty]

Args:
  --repo <path>          Source repo containing skills/. Default: inferred repo.
  --scenario <json>     Scenario fixture. Repeatable. Default: built-in scenarios.
  --keep                Keep temp repos for debugging.
  --pretty              Pretty-print JSON.
  --self-test           Run built-in scenarios.
  --help                Show help.
`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: REPO,
    scenarioFiles: [],
    keep: false,
    pretty: false,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        process.exit(0);
      case "--repo":
        options.repo = take();
        break;
      case "--scenario":
        options.scenarioFiles.push(take());
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--pretty":
        options.pretty = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--scenario=")) options.scenarioFiles.push(arg.slice("--scenario=".length));
        else throw new Error(`unknown arg: ${arg}`);
    }
  }
  options.repo = resolve(options.repo);
  if (options.selfTest) options.scenarioFiles = DEFAULT_SCENARIOS;
  else if (options.scenarioFiles.length === 0) options.scenarioFiles = DEFAULT_SCENARIOS;
  options.scenarioFiles = options.scenarioFiles.map((path) => resolve(options.repo, path));
  return options;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function defaultState(seed: string, extra?: JsonObject): JsonObject {
  return {
    issues: [
      {
        id: seed,
        title: `Fixture ${seed}`,
        status: "open",
        labels: ["fixture"],
        priority: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        closedAt: null,
        assignee: null,
        blockedBy: [],
        blocks: [],
      },
    ],
    dispatch: { decision: "closed" },
    manage: { decision: "continue", followups_requested: 0, followups_created: [] },
    ...extra,
  };
}

function setupRepo(sourceRepo: string, scenario: Scenario): { repo: string; seedstackDir: string; statePath: string; adoptionPath: string } {
  assertSafeId(scenario.name, "scenario.name");
  assertSafeId(scenario.seed, "scenario.seed");
  const adoptedSeeds = Array.isArray(scenario.adopted_seeds)
    ? scenario.adopted_seeds.filter((id): id is string => typeof id === "string")
    : [scenario.seed];
  const commitPolicy = scenario.commit_policy ?? "none";
  if (commitPolicy !== "none" && commitPolicy !== "per_seed") throw new Error(`${scenario.name}: invalid commit_policy`);
  for (const id of adoptedSeeds) assertSafeId(id, "scenario.adopted_seeds[]");
  const repo = mkdtempSync(join(tmpdir(), `seedstack-loop-${scenario.name}-`));
  symlinkSync(join(sourceRepo, "skills"), join(repo, "skills"), "dir");
  mkdirSync(join(repo, ".seeds"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  const seedstackDir = join(repo, "tmp", "seedstack", scenario.name);
  mkdirSync(seedstackDir, { recursive: true });
  writeFileSync(join(seedstackDir, ".gitkeep"), "");
  const dispatchDir = join(repo, "tmp", "dispatch", scenario.seed);
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(join(dispatchDir, ".gitkeep"), "");
  run("git", ["init", "-q"], repo);
  run("git", ["config", "user.email", "seedstack-fixture@example.invalid"], repo);
  run("git", ["config", "user.name", "Seedstack Fixture"], repo);
  run("git", ["add", "."], repo);
  run("git", ["commit", "-q", "-m", "fixture baseline"], repo);

  const statePath = join(seedstackDir, "fixture-state.json");
  const adoptionPath = join(seedstackDir, "adoption-selection.json");
  writeFileSync(statePath, `${JSON.stringify(defaultState(scenario.seed, scenario.state), null, 2)}\n`);
  writeFileSync(adoptionPath, `${JSON.stringify({
    adopted_seed_ids: adoptedSeeds,
    excluded_open_seed_ids: [],
    selected_label: "fixture",
    shared_label: "fixture",
    commit_policy: commitPolicy,
    assignee: "fixture",
  }, null, 2)}\n`);
  if (scenario.run_state) {
    writeFileSync(join(seedstackDir, "run-state.json"), `${JSON.stringify(scenario.run_state, null, 2)}\n`);
  }
  if (scenario.prewrite_dispatch_round) {
    writeDispatchRound({
      repo,
      seed: scenario.seed,
      executeVerdict: scenario.prewrite_dispatch_round.execute_verdict ?? "risk",
      executeRecommendation: scenario.prewrite_dispatch_round.execute_recommendation ?? "escalate",
      gateDecision: scenario.prewrite_dispatch_round.gate_decision ?? "escalate",
    });
    run("git", ["add", "."], repo);
    run("git", ["commit", "-q", "-m", "fixture dispatch round"], repo);
  }
  if (scenario.prewrite_stop_after_seed) {
    const reason = isObject(scenario.prewrite_stop_after_seed) && typeof scenario.prewrite_stop_after_seed.reason === "string"
      ? scenario.prewrite_stop_after_seed.reason
      : "fixture stop after seed";
    writeFileSync(join(seedstackDir, "stop-after-seed.json"), `${JSON.stringify({ reason }, null, 2)}\n`);
  }
  for (const dirtyPath of scenario.pre_dirty_queue_paths ?? []) {
    if (!dirtyPath.startsWith(".seeds/") || dirtyPath.includes("..")) {
      throw new Error(`${scenario.name}: pre_dirty_queue_paths entries must be safe .seeds paths`);
    }
    writeFileSync(join(repo, dirtyPath), `${JSON.stringify({ dirty: true })}\n`);
  }
  return { repo, seedstackDir, statePath, adoptionPath };
}

function runScenario(sourceRepo: string, scenarioPath: string, keep: boolean): ScenarioResult {
  const scenario = readJson(scenarioPath) as Scenario;
  if (!isObject(scenario) || typeof scenario.name !== "string" || typeof scenario.seed !== "string") {
    throw new Error(`${scenarioPath} must contain name and seed`);
  }
  const { repo, seedstackDir, statePath, adoptionPath } = setupRepo(sourceRepo, scenario);
  const stdoutPath = join(seedstackDir, "fixture-stdout.jsonl");
  const stderrPath = join(seedstackDir, "fixture-stderr.txt");
  const fakeCodex = writeWrapper(seedstackDir, "fake-codex", join(sourceRepo, "skills", "seedstack", "scripts", "fixtures", "fake-codex.ts"));
  const fakeSeedCli = writeWrapper(seedstackDir, "fake-seedspec-cli", join(sourceRepo, "skills", "seedstack", "scripts", "fixtures", "fake-seedspec-cli.ts"));
  if (Number.isFinite(scenario.create_stop_after_seed_after_ms)) {
    const delay = Math.max(0, Number(scenario.create_stop_after_seed_after_ms));
    const control = join(seedstackDir, "stop-after-seed.json");
    spawn(process.execPath, ["-e", `
      setTimeout(() => {
        require("node:fs").writeFileSync(${JSON.stringify(control)}, JSON.stringify({ reason: "fixture delayed stop" }) + "\\n");
      }, ${delay});
    `], {
      cwd: repo,
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  const proc = spawnSync("bun", [
    join(sourceRepo, "skills", "seedstack", "scripts", "seedstack-loop.ts"),
    "--repo",
    repo,
    "--seedstack-dir",
    seedstackDir,
    "--adoption-selection",
    adoptionPath,
    "--seed-cli",
    fakeSeedCli,
    "--codex-bin",
    fakeCodex,
    "--mode",
    "auto",
    "--commit-policy",
    scenario.commit_policy ?? "none",
    "--max-iterations",
    "12",
    "--poll-ms",
    "50",
    "--post-seed-delay-ms",
    String(scenario.post_seed_delay_ms ?? 0),
    "--child-total-timeout-ms",
    "5000",
    "--child-silent-timeout-ms",
    "5000",
    "--child-silent-probe-ms",
    "1000",
  ], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, SEEDSTACK_FIXTURE_STATE: statePath },
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(stdoutPath, proc.stdout);
  writeFileSync(stderrPath, proc.stderr);

  const events = parseEvents(proc.stdout);
  const finalEvent = latestFinalEvent(events);
  const expected = scenario.expected;
  const gotState = stringField(finalEvent?.state);
  const gotReason = stringField(finalEvent?.reason);
  const missingAssertions = [
    ...missingEventAssertions(events, scenario.must_emit ?? []),
    ...eventCountAssertionFailures(events, scenario.event_assertions?.counts ?? []),
    ...eventOrderAssertionFailures(events, scenario.event_assertions?.order ?? []),
    ...(expected.final_fields && !fieldsMatch(finalEvent ?? {}, expected.final_fields)
      ? [`final ${JSON.stringify(expected.final_fields)}`]
      : []),
  ];
  const ok =
    proc.status === expected.exit_code &&
    gotState === expected.final_state &&
    (expected.reason === undefined || gotReason === expected.reason) &&
    missingAssertions.length === 0;

  if (!keep && ok) rmSync(repo, { recursive: true, force: true });
  return {
    name: scenario.name,
    ok,
    repo,
    seedstack_dir: seedstackDir,
    exit_code: proc.status,
    expected,
    final_event: finalEvent,
    missing_assertions: missingAssertions,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
  };
}

function writeWrapper(dir: string, name: string, target: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\nexec bun ${JSON.stringify(target)} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

function parseEvents(stdout: string): JsonObject[] {
  const events: JsonObject[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isObject(parsed)) events.push(parsed);
    } catch {
      // Other tools should not print in fixture mode, but ignore stray lines.
    }
  }
  return events;
}

function latestFinalEvent(events: JsonObject[]): JsonObject | null {
  let finalEvent: JsonObject | null = null;
  for (const event of events) {
    if (event.event === "final") finalEvent = event;
  }
  return finalEvent;
}

function missingEventAssertions(events: JsonObject[], assertions: EventAssertion[]): string[] {
  return assertions.flatMap((assertion) => {
    const found = events.some((event) => event.event === assertion.event && fieldsMatch(event, assertion.fields ?? {}));
    return found ? [] : [`${assertion.event} ${JSON.stringify(assertion.fields ?? {})}`];
  });
}

function eventCountAssertionFailures(events: JsonObject[], assertions: Array<EventAssertion & { count: number }>): string[] {
  return assertions.flatMap((assertion) => {
    if (!Number.isInteger(assertion.count) || assertion.count < 0) {
      return [`${assertion.event} count must be non-negative integer`];
    }
    const count = events.filter((event) => event.event === assertion.event && fieldsMatch(event, assertion.fields ?? {})).length;
    return count === assertion.count
      ? []
      : [`${assertion.event} ${JSON.stringify(assertion.fields ?? {})} count expected ${assertion.count} got ${count}`];
  });
}

function eventOrderAssertionFailures(events: JsonObject[], assertions: EventAssertion[]): string[] {
  let cursor = 0;
  const failures: string[] = [];
  for (const assertion of assertions) {
    const index = events.findIndex((event, eventIndex) =>
      eventIndex >= cursor && event.event === assertion.event && fieldsMatch(event, assertion.fields ?? {}),
    );
    if (index < 0) {
      failures.push(`${assertion.event} ${JSON.stringify(assertion.fields ?? {})} not found after event ${cursor}`);
      break;
    }
    cursor = index + 1;
  }
  return failures;
}

function fieldsMatch(event: JsonObject, fields: JsonObject): boolean {
  return Object.entries(fields).every(([key, expected]) => JSON.stringify(event[key]) === JSON.stringify(expected));
}

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error(`${label} must be a path-safe id`);
  }
}

function run(command: string, args: string[], cwd: string): void {
  const proc = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${proc.stderr || proc.stdout}`);
  }
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  const results = options.scenarioFiles.map((scenario) => runScenario(options.repo, scenario, options.keep));
  const output = {
    contract: "seedstack_loop_fixture.v1",
    ok: results.every((result) => result.ok),
    scenarios: results,
  };
  process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
  return output.ok ? 0 : 1;
}

try {
  process.exit(main());
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    contract: "seedstack_loop_fixture.v1",
    ok: false,
    error: String((error as Error).message),
  })}\n`);
  process.exit(2);
}
