#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;
type Issue = {
  id: string;
  title?: string;
  status?: string;
  labels?: string[];
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  assignee?: string | null;
  blockedBy?: string[];
  blocks?: string[];
};

type State = {
  issues: Issue[];
  health?: { ok?: boolean; summary?: JsonObject };
};

const statePath = process.env.SEEDSTACK_FIXTURE_STATE;
if (!statePath) fail("SEEDSTACK_FIXTURE_STATE missing");

const command = process.argv[2];
if (!command) fail("usage: fake-seedspec-cli.ts <health|list|ready|blocked|close> ... --json");

const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
const issues = state.issues.map(normalizeIssue);

switch (command) {
  case "health": {
    const summary = state.health?.summary ?? { error: 0, pass: 1, warning: 0 };
    print({ ok: state.health?.ok ?? true, command, data: { checks: [], summary } });
    break;
  }
  case "list":
    printIssues(command, issues);
    break;
  case "ready":
    printIssues(command, issues.filter((issue) => issue.status !== "closed" && !issue.assignee && issue.blockedBy.length === 0));
    break;
  case "blocked":
    printIssues(command, issues.filter((issue) => issue.status !== "closed" && issue.blockedBy.length > 0));
    break;
  case "close": {
    if (process.argv[4] !== "--json") fail("usage: fake-seedspec-cli.ts close <id> --json");
    const id = process.argv[3];
    const issue = state.issues.find((item) => item.id === id);
    if (!issue) fail(`unknown issue ${id}`);
    issue.status = "closed";
    issue.closedAt = "2026-01-01T00:00:01.000Z";
    issue.updatedAt = "2026-01-01T00:00:01.000Z";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    print({ ok: true, command, data: { id, status: "closed" } });
    break;
  }
  default:
    fail(`unsupported command ${command}`);
}

function normalizeIssue(issue: Issue): Required<Issue> {
  return {
    id: issue.id,
    title: issue.title ?? issue.id,
    status: issue.status ?? "open",
    labels: issue.labels ?? [],
    priority: issue.priority ?? 1,
    createdAt: issue.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: issue.updatedAt ?? "2026-01-01T00:00:00.000Z",
    closedAt: issue.closedAt ?? null,
    assignee: issue.assignee ?? null,
    blockedBy: issue.blockedBy ?? [],
    blocks: issue.blocks ?? [],
  };
}

function printIssues(commandName: string, values: Required<Issue>[]): void {
  print({ ok: true, command: commandName, data: { count: values.length, issues: values } });
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
