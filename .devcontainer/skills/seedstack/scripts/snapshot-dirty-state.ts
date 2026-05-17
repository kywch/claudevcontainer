#!/usr/bin/env bun
// Capture git dirty state once, then let downstream checkers consume snapshot.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { preflightRepo, type WorktreePolicy } from "./worktree-preflight.ts";

export const DIRTY_STATE_SNAPSHOT_CONTRACT = "dirty_state_snapshot.v1";

export type DirtyStateSnapshot = {
  contract: typeof DIRTY_STATE_SNAPSHOT_CONTRACT;
  ok: boolean;
  repo: string;
  captured_at: string;
  status_porcelain: string;
  paths: Array<{ status: string; path: string }>;
};

type Options = {
  repo: string;
  worktreePolicy: WorktreePolicy;
  output?: string;
  pretty: boolean;
  selfTest: boolean;
};

function usage(exitCode: 0 | 2): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(
    [
      "usage: snapshot-dirty-state.ts [--repo <path>] [--output <path>] [--pretty] [--self-test]",
      "",
    ].join("\n"),
  );
  process.exit(exitCode);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { repo: process.cwd(), worktreePolicy: "linked-ok", pretty: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") usage(0);
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (arg === "--repo") {
      options.repo = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }
    if (arg === "--worktree-policy") {
      const policy = requireValue(argv, index, arg);
      if (policy !== "linked-ok" && policy !== "allow-same-branch") throw new Error("--worktree-policy must be linked-ok or allow-same-branch");
      options.worktreePolicy = policy;
      index += 1;
      continue;
    }
    if (arg.startsWith("--worktree-policy=")) {
      const policy = arg.slice("--worktree-policy=".length);
      if (policy !== "linked-ok" && policy !== "allow-same-branch") throw new Error("--worktree-policy must be linked-ok or allow-same-branch");
      options.worktreePolicy = policy;
      continue;
    }
    if (arg === "--allow-same-branch-worktree") {
      options.worktreePolicy = "allow-same-branch";
      continue;
    }
    if (arg === "--output") {
      options.output = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  const preflight = preflightRepo({
    repoInput: options.repo,
    cwd: process.cwd(),
    policy: options.worktreePolicy,
    requireWorktree: false,
  });
  return { ...options, repo: preflight.repo };
}

export function parsePorcelainPaths(statusText: string): DirtyStateSnapshot["paths"] {
  const paths: DirtyStateSnapshot["paths"] = [];
  for (const line of statusText.split(/\r?\n/)) {
    if (!line) continue;
    if (line.length < 4 || line[2] !== " ") throw new Error(`invalid porcelain line: ${line}`);
    const status = line.slice(0, 2);
    const raw = line.slice(3).split(" -> ").at(-1)?.trim() ?? "";
    paths.push({ status, path: cleanStatusPath(raw) });
  }
  return paths.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function cleanStatusPath(path: string): string {
  return path.replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\/g, "/").replace(/^\.\//, "");
}

export function snapshotFromStatus(repo: string, statusText: string, capturedAt = new Date().toISOString()): DirtyStateSnapshot {
  return {
    contract: DIRTY_STATE_SNAPSHOT_CONTRACT,
    ok: true,
    repo: resolve(repo),
    captured_at: capturedAt,
    status_porcelain: statusText,
    paths: parsePorcelainPaths(statusText),
  };
}

export function captureDirtySnapshot(repo: string): DirtyStateSnapshot {
  const status = execFileSync("git", ["-C", repo, "status", "--porcelain=v1", "--untracked-files=all"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return snapshotFromStatus(repo, status);
}

export function readDirtyStatusText(path: string): string {
  const raw = readFileSync(path, "utf8");
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  const parsed = JSON.parse(trimmed) as Partial<DirtyStateSnapshot>;
  if (parsed.contract !== DIRTY_STATE_SNAPSHOT_CONTRACT) return raw;
  if (typeof parsed.status_porcelain !== "string") {
    throw new Error(`dirty snapshot missing status_porcelain: ${path}`);
  }
  return parsed.status_porcelain;
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function selfTest(pretty: boolean): void {
  const dir = mkdtempSync(join(tmpdir(), "dirty-snapshot-"));
  try {
    const snapshot = snapshotFromStatus(
      dir,
      " M .seeds/issues.jsonl\n?? .seeds/knowledge.jsonl\n M src/app.ts\n",
      "2026-01-01T00:00:00.000Z",
    );
    if (snapshot.paths.length !== 3) throw new Error("snapshot path count mismatch");
    if (!snapshot.paths.some((path) => path.path === ".seeds/knowledge.jsonl")) {
      throw new Error("snapshot must preserve knowledge path");
    }
    const path = join(dir, "snapshot.json");
    writeFileSync(path, `${JSON.stringify(snapshot)}\n`);
    if (readDirtyStatusText(path) !== snapshot.status_porcelain) {
      throw new Error("snapshot status text readback mismatch");
    }
    const raw = join(dir, "status.txt");
    writeFileSync(raw, " M src/live.ts\n");
    if (readDirtyStatusText(raw) !== " M src/live.ts\n") {
      throw new Error("raw status readback mismatch");
    }
    printJson({ contract: "dirty_state_snapshot_self_test.v1", ok: true }, pretty);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTest) {
      selfTest(options.pretty);
      return;
    }
    const snapshot = captureDirtySnapshot(options.repo);
    const json = `${JSON.stringify(snapshot, null, options.pretty ? 2 : 0)}\n`;
    if (options.output) writeFileSync(resolve(options.repo, options.output), json);
    process.stdout.write(json);
  } catch (error) {
    printJson({ contract: DIRTY_STATE_SNAPSHOT_CONTRACT, ok: false, error: (error as Error).message }, false);
    process.exit(2);
  }
}

if (import.meta.main) main();
