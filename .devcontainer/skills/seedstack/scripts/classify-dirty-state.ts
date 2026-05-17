#!/usr/bin/env bun
// Deterministic Seedstack dirty-state classifier.
//
// Classifies git porcelain v1 paths at run/auto loop boundaries without
// external dependencies.

import { execFileSync } from "node:child_process";
import { resolve, relative } from "node:path";
import { readDirtyStatusText } from "./snapshot-dirty-state.ts";

type Classification =
  | "preexisting_user"
  | "dispatcher_owned"
  | "capture_owned"
  | "expected_artifact"
  | "expected_seed"
  | "unexpected";

type StatusPath = {
  path: string;
  status: string;
  classification: Classification;
  reason: string;
};

type Options = {
  repo: string;
  seed?: string;
  dispatchDir?: string;
  seedstackDir?: string;
  expectedSeeds: string[];
  preexisting: string[];
  dirtyPolicy: "strict" | "loop" | "commit";
  pretty: boolean;
  selfTest: boolean;
  statusFile?: string;
  allowUnexpected: boolean;
};

type Result = {
  contract: "dirty_state_classification.v1";
  ok: boolean;
  repo: string;
  seed: string | null;
  paths: StatusPath[];
  summary: Record<Classification | "total", number>;
  unexpected_paths: string[];
  hard_dirty_paths: string[];
  soft_dirty_paths: string[];
  policy: "strict" | "loop" | "commit";
};

function usage(exitCode: 0 | 2): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(
    [
      "usage: classify-dirty-state.ts [--repo <path>] [--seed <work-id>]",
      "       [--dispatch-dir <path>] [--seedstack-dir <path>]",
      "       [--expected-seed <path-prefix>]... [--preexisting <path>]...",
      "       [--status-file <path>] [--dirty-snapshot <path>] [--dirty-policy strict|loop|commit]",
      "       [--pretty] [--allow-unexpected] [--self-test]",
      "",
    ].join("\n"),
  );
  process.exit(exitCode);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    expectedSeeds: [],
    preexisting: [],
    dirtyPolicy: "strict",
    pretty: false,
    selfTest: false,
    allowUnexpected: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage(0);
    }
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (arg === "--allow-unexpected") {
      options.allowUnexpected = true;
      continue;
    }
    if (arg === "--dirty-policy") {
      const policy = requireValue(argv, index, arg);
      if (policy !== "strict" && policy !== "loop" && policy !== "commit") {
        throw new Error("--dirty-policy must be strict, loop, or commit");
      }
      options.dirtyPolicy = policy;
      index++;
      continue;
    }
    if (arg.startsWith("--dirty-policy=")) {
      const policy = arg.slice("--dirty-policy=".length);
      if (policy !== "strict" && policy !== "loop" && policy !== "commit") {
        throw new Error("--dirty-policy must be strict, loop, or commit");
      }
      options.dirtyPolicy = policy;
      continue;
    }
    if (arg === "--repo") {
      options.repo = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }
    if (arg === "--seed") {
      options.seed = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--seed=")) {
      options.seed = arg.slice("--seed=".length);
      continue;
    }
    if (arg === "--dispatch-dir") {
      options.dispatchDir = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--dispatch-dir=")) {
      options.dispatchDir = arg.slice("--dispatch-dir=".length);
      continue;
    }
    if (arg === "--seedstack-dir") {
      options.seedstackDir = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--seedstack-dir=")) {
      options.seedstackDir = arg.slice("--seedstack-dir=".length);
      continue;
    }
    if (arg === "--expected-seed") {
      options.expectedSeeds.push(requireValue(argv, index, arg));
      index++;
      continue;
    }
    if (arg.startsWith("--expected-seed=")) {
      options.expectedSeeds.push(arg.slice("--expected-seed=".length));
      continue;
    }
    if (arg === "--preexisting") {
      options.preexisting.push(requireValue(argv, index, arg));
      index++;
      continue;
    }
    if (arg.startsWith("--preexisting=")) {
      options.preexisting.push(arg.slice("--preexisting=".length));
      continue;
    }
    if (arg === "--status-file") {
      options.statusFile = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--status-file=")) {
      options.statusFile = arg.slice("--status-file=".length);
      continue;
    }
    if (arg === "--dirty-snapshot") {
      options.statusFile = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--dirty-snapshot=")) {
      options.statusFile = arg.slice("--dirty-snapshot=".length);
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  options.repo = resolve(options.repo);
  if (!options.dispatchDir && options.seed) {
    options.dispatchDir = `tmp/dispatch-work/${options.seed}`;
  }
  return options;
}

function toRepoPath(path: string, repo: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized || normalized === ".") {
    return "";
  }
  if (normalized.startsWith("/")) {
    const rel = relative(repo, normalized).replace(/\\/g, "/");
    if (rel.startsWith("../") || rel === "..") {
      throw new Error(`path is outside repo: ${path}`);
    }
    return stripDotSlash(rel);
  }
  return stripDotSlash(normalized);
}

function stripDotSlash(path: string): string {
  let value = path;
  while (value.startsWith("./")) {
    value = value.slice(2);
  }
  return value;
}

function matchesPrefix(path: string, prefix: string): boolean {
  const cleanPrefix = prefix.replace(/\/+$/g, "");
  if (!cleanPrefix) {
    return false;
  }
  return path === cleanPrefix || path.startsWith(`${cleanPrefix}/`);
}

function unquoteGitPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  const bytes: number[] = [];
  for (let index = 1; index < trimmed.length - 1; index++) {
    const char = trimmed[index];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }

    const next = trimmed[index + 1];
    if (next === undefined) {
      bytes.push(0x5c);
      continue;
    }

    if (/[0-7]/.test(next)) {
      let octal = next;
      let consumed = 1;
      while (
        consumed < 3 &&
        index + consumed + 1 < trimmed.length - 1 &&
        /[0-7]/.test(trimmed[index + consumed + 1])
      ) {
        octal += trimmed[index + consumed + 1];
        consumed++;
      }
      bytes.push(Number.parseInt(octal, 8));
      index += consumed;
      continue;
    }

    const escapes: Record<string, number> = {
      a: 0x07,
      b: 0x08,
      f: 0x0c,
      n: 0x0a,
      r: 0x0d,
      t: 0x09,
      v: 0x0b,
      "\\": 0x5c,
      '"': 0x22,
    };
    if (next in escapes) {
      bytes.push(escapes[next]);
    } else {
      bytes.push(...Buffer.from(next, "utf8"));
    }
    index++;
  }
  return Buffer.from(bytes).toString("utf8");
}

function splitRenameDestination(pathPart: string): string {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index <= pathPart.length - 4; index++) {
    const char = pathPart[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inQuote && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && pathPart.slice(index, index + 4) === " -> ") {
      return pathPart.slice(index + 4);
    }
  }
  return pathPart;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function parsePorcelain(
  text: string,
  stripPrefix?: string,
): Array<{ status: string; path: string }> {
  const entries: Array<{ status: string; path: string }> = [];
  const prefix = stripPrefix ? stripDotSlash(stripPrefix).replace(/\/+$/g, "") : "";
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }
    if (rawLine.length < 4 || rawLine[2] !== " ") {
      throw new Error(`invalid porcelain line: ${rawLine}`);
    }
    const status = rawLine.slice(0, 2);
    const pathPart = rawLine.slice(3);
    const isRenameOrCopy =
      status[0] === "R" || status[1] === "R" || status[0] === "C" || status[1] === "C";
    const path = isRenameOrCopy ? splitRenameDestination(pathPart) : pathPart;
    let normalizedPath = stripDotSlash(unquoteGitPath(path)).replace(/\/+$/g, "");
    if (prefix && matchesPrefix(normalizedPath, prefix)) {
      normalizedPath =
        normalizedPath === prefix ? "" : normalizedPath.slice(prefix.length + 1);
    }
    entries.push({ status, path: normalizedPath });
  }
  return entries;
}

function classifyPath(
  path: string,
  options: Options,
  normalized: {
    dispatchDir?: string;
    seedstackDir?: string;
    expectedSeeds: string[];
    preexisting: Set<string>;
  },
): { classification: Classification; reason: string } {
  if (normalized.preexisting.has(path)) {
    return {
      classification: "preexisting_user",
      reason: "matched --preexisting exact path",
    };
  }
  if (normalized.dispatchDir && matchesPrefix(path, normalized.dispatchDir)) {
    return { classification: "expected_artifact", reason: `under ${normalized.dispatchDir}/` };
  }
  if (normalized.seedstackDir && matchesPrefix(path, normalized.seedstackDir)) {
    return { classification: "expected_artifact", reason: `under ${normalized.seedstackDir}/` };
  }
  if (options.seed && path === ".seeds/issues.jsonl") {
    return { classification: "dispatcher_owned", reason: ".seeds/issues.jsonl with --seed" };
  }
  if (path === ".seeds/knowledge.jsonl") {
    return { classification: "capture_owned", reason: ".seeds/knowledge.jsonl is capture-owned" };
  }
  for (const prefix of normalized.expectedSeeds) {
    if (matchesPrefix(path, prefix)) {
      return { classification: "expected_seed", reason: `matched --expected-seed ${prefix}` };
    }
    if (matchesPrefix(prefix, path)) {
      return { classification: "expected_seed", reason: `matched parent of --expected-seed ${prefix}` };
    }
  }
  return { classification: "unexpected", reason: "no classifier rule matched" };
}

function emptySummary(): Record<Classification | "total", number> {
  return {
    total: 0,
    preexisting_user: 0,
    dispatcher_owned: 0,
    capture_owned: 0,
    expected_artifact: 0,
    expected_seed: 0,
    unexpected: 0,
  };
}

function isConflictStatus(status: string): boolean {
  const code = status.trim();
  return ["UU", "AA", "DD", "AU", "UA", "DU", "UD"].includes(code) || code.includes("U");
}

function isDeletedSeedStore(path: StatusPath): boolean {
  return path.path.startsWith(".seeds/") && path.status.includes("D");
}

function hardDirtyPath(path: StatusPath, policy: Options["dirtyPolicy"]): boolean {
  if (isConflictStatus(path.status) || isDeletedSeedStore(path)) return true;
  if (path.classification !== "unexpected") return false;
  return policy !== "loop";
}

function classifyStatus(statusText: string, options: Options, stripPrefix?: string): Result {
  const normalized = {
    dispatchDir: options.dispatchDir ? toRepoPath(options.dispatchDir, options.repo) : undefined,
    seedstackDir: options.seedstackDir ? toRepoPath(options.seedstackDir, options.repo) : undefined,
    expectedSeeds: options.expectedSeeds.map((path) => toRepoPath(path, options.repo)),
    preexisting: new Set(options.preexisting.map((path) => toRepoPath(path, options.repo))),
  };
  const paths = parsePorcelain(statusText, stripPrefix).map((entry) => {
    const classified = classifyPath(entry.path, options, normalized);
    return {
      path: entry.path,
      status: entry.status,
      classification: classified.classification,
      reason: classified.reason,
    };
  });
  paths.sort(
    (left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.status, right.status),
  );

  const summary = emptySummary();
  for (const path of paths) {
    summary.total++;
    summary[path.classification]++;
  }
  const unexpectedPaths = paths
    .filter((path) => path.classification === "unexpected")
    .map((path) => path.path);
  const hardDirtyPaths = paths
    .filter((path) => hardDirtyPath(path, options.dirtyPolicy))
    .map((path) => path.path);
  const softDirtyPaths = paths
    .filter((path) => path.classification === "unexpected" && !hardDirtyPath(path, options.dirtyPolicy))
    .map((path) => path.path);
  return {
    contract: "dirty_state_classification.v1",
    ok: hardDirtyPaths.length === 0,
    repo: options.repo,
    seed: options.seed ?? null,
    paths,
    summary,
    unexpected_paths: unexpectedPaths,
    hard_dirty_paths: hardDirtyPaths,
    soft_dirty_paths: softDirtyPaths,
    policy: options.dirtyPolicy,
  };
}

function readStatus(options: Options): { text: string; stripPrefix?: string } {
  if (options.statusFile) {
    return { text: readDirtyStatusText(options.statusFile) };
  }
  const stripPrefix = execFileSync("git", ["-C", options.repo, "rev-parse", "--show-prefix"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const text = execFileSync("git", ["-C", options.repo, "status", "--porcelain=v1", "--untracked-files=all", "--", "."], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { text, stripPrefix };
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function assertCase(
  name: string,
  actual: Result,
  expected: Partial<Record<Classification, number>> & { ok: boolean },
): void {
  if (actual.ok !== expected.ok) {
    throw new Error(`${name}: ok=${actual.ok}, expected ${expected.ok}`);
  }
  for (const classification of [
    "preexisting_user",
    "dispatcher_owned",
    "capture_owned",
    "expected_artifact",
    "expected_seed",
    "unexpected",
  ] as Classification[]) {
    const wanted = expected[classification] ?? 0;
    if (actual.summary[classification] !== wanted) {
      throw new Error(
        `${name}: ${classification}=${actual.summary[classification]}, expected ${wanted}`,
      );
    }
  }
}

function assertPaths(name: string, actual: Result, expected: string[]): void {
  const paths = actual.paths.map((path) => path.path);
  if (JSON.stringify(paths) !== JSON.stringify(expected)) {
    throw new Error(`${name}: paths=${JSON.stringify(paths)}, expected ${JSON.stringify(expected)}`);
  }
}

function selfTest(pretty: boolean): void {
  const base: Options = {
    repo: "/repo",
    seed: "S1",
    dispatchDir: "tmp/dispatch-work/S1",
    seedstackDir: "tmp/seedstack/demo",
    expectedSeeds: [],
    preexisting: [],
    dirtyPolicy: "strict",
    pretty,
    selfTest: true,
    allowUnexpected: false,
  };
  const cases: Array<{ name: string; result: Result }> = [];

  const clean = classifyStatus("", base);
  assertCase("clean", clean, { ok: true });
  cases.push({ name: "clean", result: clean });

  const expected = classifyStatus(
    [
      "?? tmp/dispatch-work/S1/gate.md",
      " M tmp/seedstack/demo/run-state.json",
      " M .seeds/issues.jsonl",
      " M .seeds/knowledge.jsonl",
      " M src/owned.ts",
      "",
    ].join("\n"),
    { ...base, expectedSeeds: ["src/owned.ts"] },
  );
  assertCase("expected", expected, {
    ok: true,
    dispatcher_owned: 1,
    capture_owned: 1,
    expected_artifact: 2,
    expected_seed: 1,
  });
  cases.push({ name: "expected", result: expected });

  const unexpected = classifyStatus(" M src/app.ts\n", base);
  assertCase("unexpected", unexpected, { ok: false, unexpected: 1 });
  cases.push({ name: "unexpected", result: unexpected });

  const softLoopDirty = classifyStatus(" M src/app.ts\n", { ...base, dirtyPolicy: "loop" });
  assertCase("loop soft unexpected", softLoopDirty, { ok: true, unexpected: 1 });
  if (softLoopDirty.soft_dirty_paths[0] !== "src/app.ts") {
    throw new Error("loop soft unexpected: expected soft_dirty_paths to include src/app.ts");
  }
  cases.push({ name: "loop soft unexpected", result: softLoopDirty });

  const hardLoopDirty = classifyStatus("UU src/app.ts\n D .seeds/issues.jsonl\n", { ...base, dirtyPolicy: "loop" });
  assertCase("loop hard dirty", hardLoopDirty, { ok: false, unexpected: 1, dispatcher_owned: 1 });
  if (hardLoopDirty.hard_dirty_paths.length !== 2) {
    throw new Error("loop hard dirty: expected two hard_dirty_paths");
  }
  cases.push({ name: "loop hard dirty", result: hardLoopDirty });

  const allowedHardDirty = classifyStatus("UU src/app.ts\n", { ...base, allowUnexpected: true });
  assertCase("allow unexpected does not waive hard dirty", allowedHardDirty, { ok: false, unexpected: 1 });
  cases.push({ name: "allow unexpected does not waive hard dirty", result: allowedHardDirty });

  const preexisting = classifyStatus(" M src/app.ts\n?? tmp/dispatch-work/S1/gate.md\n", {
    ...base,
    preexisting: ["src/app.ts"],
  });
  assertCase("preexisting", preexisting, {
    ok: true,
    preexisting_user: 1,
    expected_artifact: 1,
  });
  cases.push({ name: "preexisting", result: preexisting });

  const octalQuoted = classifyStatus(' M "caf\\303\\251.txt"\n', {
    ...base,
    preexisting: ["café.txt"],
  });
  assertCase("octal quoted path", octalQuoted, { ok: true, preexisting_user: 1 });
  assertPaths("octal quoted path", octalQuoted, ["café.txt"]);
  cases.push({ name: "octal quoted path", result: octalQuoted });

  const quotedRename = classifyStatus('R  "src/old -> name.ts" -> "src/new -> name.ts"\n', {
    ...base,
    expectedSeeds: ["src/new -> name.ts"],
  });
  assertCase("quoted rename destination arrow", quotedRename, { ok: true, expected_seed: 1 });
  assertPaths("quoted rename destination arrow", quotedRename, ["src/new -> name.ts"]);
  cases.push({ name: "quoted rename destination arrow", result: quotedRename });

  const collapsedUntrackedParent = classifyStatus("?? src/owned-dir\n", {
    ...base,
    expectedSeeds: ["src/owned-dir/file.ts"],
  });
  assertCase("collapsed untracked parent expected", collapsedUntrackedParent, { ok: true, expected_seed: 1 });
  cases.push({ name: "collapsed untracked parent expected", result: collapsedUntrackedParent });

  printJson(
    {
      contract: "dirty_state_classifier_self_test.v1",
      ok: true,
      cases: cases.map((item) => ({
        name: item.name,
        ok: item.result.ok,
        summary: item.result.summary,
        unexpected_paths: item.result.unexpected_paths,
        hard_dirty_paths: item.result.hard_dirty_paths,
        soft_dirty_paths: item.result.soft_dirty_paths,
      })),
    },
    pretty,
  );
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTest) {
      selfTest(options.pretty);
      return;
    }
    const status = readStatus(options);
    const result = classifyStatus(status.text, options, status.stripPrefix);
    printJson(result, options.pretty);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`classify-dirty-state: ${message}`);
    process.exit(2);
  }
}

main();
