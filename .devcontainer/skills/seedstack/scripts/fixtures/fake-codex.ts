#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { writeDispatchRound } from "./dispatch-artifacts.ts";

type JsonObject = Record<string, unknown>;
type ChildDecision = "closed" | "blocked" | "escalated" | "crashed" | "continue" | "continue_other_seeds" | "retry_same_seed" | "done";
type Issue = { id: string; status?: string; closedAt?: string | null; updatedAt?: string };
type DispatchConfig = {
  decision?: ChildDecision;
  execute_verdict?: "pass" | "block" | "risk";
  execute_recommendation?: "close" | "retry" | "escalate";
  gate_decision?: "close" | "retry" | "escalate";
  dirty_paths?: string[];
  write_round?: boolean;
  write_files?: Array<{ path: string; content?: string }>;
};
type State = {
  issues: Issue[];
  dispatch?: DispatchConfig;
  dispatch_by_seed?: Record<string, DispatchConfig>;
  manage?: {
    decision?: ChildDecision;
    followups_requested?: number;
    followups_created?: string[];
    blocked_reason?: string;
  };
};

const resultFile = process.env.SEEDSTACK_RESULT_FILE;
const statePath = process.env.SEEDSTACK_FIXTURE_STATE;
if (!resultFile) fail("SEEDSTACK_RESULT_FILE missing");
if (!statePath) fail("SEEDSTACK_FIXTURE_STATE missing");

process.stdin.resume();
process.stdin.on("end", () => {
  const match = /^\d+-(dispatch|manage)-(.+)\.result\.json$/.exec(basename(resultFile));
  if (!match) fail(`cannot infer child role/seed from ${resultFile}`);
  const [, role, seed] = match;
  const state = readState();
  const result = role === "dispatch" ? runDispatch(state, seed) : runManage(state, seed);
  writeState(state);
  writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
});

function runDispatch(state: State, seed: string): JsonObject {
  const dispatch = state.dispatch_by_seed?.[seed] ?? state.dispatch;
  const decision = dispatch?.decision ?? "closed";
  if (decision === "closed") {
    for (const file of dispatch?.write_files ?? []) {
      writeRepoFile(file.path, file.content ?? `fixture change for ${seed}\n`);
    }
    const roundPath = writeDispatchRound({
      repo: process.cwd(),
      seed,
      executeVerdict: dispatch?.execute_verdict ?? "pass",
      executeRecommendation: dispatch?.execute_recommendation ?? "close",
      gateDecision: dispatch?.gate_decision ?? "close",
      dirtyPaths: dispatch?.dirty_paths ?? [],
    });
    closeIssue(state, seed);
    return {
      contract: "seedstack_child_result.v1",
      ok: true,
      role: "dispatch",
      seed,
      decision,
      round_path: roundPath,
      followups_requested: 0,
      followups_created: [],
      summary: { fixture: true },
    };
  }
  const roundPath = dispatch?.write_round
    ? writeDispatchRound({
        repo: process.cwd(),
        seed,
        executeVerdict: dispatch.execute_verdict ?? "risk",
        executeRecommendation: dispatch.execute_recommendation ?? "escalate",
        gateDecision: dispatch.gate_decision ?? "escalate",
        dirtyPaths: dispatch.dirty_paths ?? [],
      })
    : undefined;
  return {
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "dispatch",
    seed,
    decision,
    round_path: roundPath,
    followups_requested: 0,
    followups_created: [],
    blocked_reason: decision === "blocked" ? "fixture_dispatch_blocked" : undefined,
    summary: { fixture: true },
  };
}

function runManage(state: State, seed: string): JsonObject {
  const decision = state.manage?.decision ?? "continue";
  return {
    contract: "seedstack_child_result.v1",
    ok: true,
    role: "manage",
    seed,
    decision,
    followups_requested: state.manage?.followups_requested ?? 0,
    followups_created: state.manage?.followups_created ?? [],
    blocked_reason: state.manage?.blocked_reason,
    summary: { fixture: true },
  };
}

function closeIssue(state: State, seed: string): void {
  const issue = state.issues.find((item) => item.id === seed);
  if (!issue) return;
  issue.status = "closed";
  issue.closedAt = "2026-01-01T00:00:01.000Z";
  issue.updatedAt = "2026-01-01T00:00:01.000Z";
}

function readState(): State {
  return JSON.parse(readFileSync(statePath as string, "utf8")) as State;
}

function writeState(state: State): void {
  writeFileSync(statePath as string, `${JSON.stringify(state, null, 2)}\n`);
}

function writeRepoFile(path: string, content: string): void {
  if (path.startsWith("/") || path.includes("..")) fail(`unsafe fixture write path ${path}`);
  const file = join(process.cwd(), path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
