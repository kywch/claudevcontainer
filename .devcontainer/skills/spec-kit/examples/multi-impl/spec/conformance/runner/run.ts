#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type CaseResult = {
  ok: boolean;
  id: string;
  error?: string;
};

type YamlValue = string | boolean | Record<string, YamlValue> | YamlValue[];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseScalar(raw: string): string | boolean {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/^["']|["']$/g, "");
}

function parseSimpleYaml(text: string): Record<string, YamlValue> {
  const root: Record<string, YamlValue> = {};
  const stack: { indent: number; value: Record<string, YamlValue> | YamlValue[] }[] = [
    { indent: -1, value: root },
  ];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.replace(/\s+#.*$/, "");
    if (line.trim() === "") continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].value;

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error("list item without list parent");
      }
      parent.push(parseScalar(trimmed.slice(2)));
      continue;
    }

    const match = trimmed.match(/^([^:]+):(.*)$/);
    if (!match || Array.isArray(parent)) {
      throw new Error(`unsupported YAML line: ${trimmed}`);
    }

    const key = match[1].trim();
    const rest = match[2].trim();
    if (rest !== "") {
      parent[key] = parseScalar(rest);
      continue;
    }

    const nextList = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
    const container: Record<string, YamlValue> | YamlValue[] =
      nextList && nextList.trim().startsWith("- ") ? [] : {};
    parent[key] = container;
    stack.push({ indent, value: container });
  }

  return root;
}

function isObject(value: YamlValue | undefined): value is Record<string, YamlValue> {
  return value !== undefined && typeof value === "object" && !Array.isArray(value);
}

function parseCase(path: string): CaseResult {
  const text = readFileSync(path, "utf8");
  let parsed: Record<string, YamlValue>;
  try {
    parsed = parseSimpleYaml(text);
  } catch (error) {
    const id = path.split("/").pop()?.replace(/\.yaml$/, "") ?? path;
    return { ok: false, id, error: (error as Error).message };
  }

  const id = typeof parsed.id === "string" ? parsed.id : path.split("/").pop()?.replace(/\.yaml$/, "") ?? path;
  const input = isObject(parsed.input) ? parsed.input : undefined;
  const record = input && isObject(input.record) ? input.record : undefined;
  const set = input && isObject(input.set) ? input.set : undefined;
  const expect = isObject(parsed.expect) ? parsed.expect : undefined;
  const observable = expect && isObject(expect.observable) ? expect.observable : undefined;

  const missing: string[] = [];
  if (typeof parsed.id !== "string") missing.push("id");
  if (typeof parsed.title !== "string") missing.push("title");
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) missing.push("sources");
  if (parsed.operation !== "updateFlag") missing.push("operation:updateFlag");
  if (!record) missing.push("input.record");
  if (!set) missing.push("input.set");
  if (set?.enabled !== true && set?.enabled !== false) missing.push("input.set.enabled");
  if (expect?.outcome !== "success") missing.push("expect.outcome:success");
  if (!observable) missing.push("expect.observable");
  if (record && typeof record.key !== "string") missing.push("input.record.key");
  if (record && record.enabled !== true && record.enabled !== false) missing.push("input.record.enabled");
  if (observable && typeof observable.key !== "string") missing.push("expect.observable.key");
  if (observable && observable.enabled !== true && observable.enabled !== false) {
    missing.push("expect.observable.enabled");
  }

  if (missing.length > 0) {
    return { ok: false, id, error: `missing or invalid ${missing.join(", ")}` };
  }
  return { ok: true, id };
}

const impl = argValue("--impl");
if (impl) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      command: "case-shape",
      cases: 0,
      passed: 0,
      failed: 1,
      impl,
      implExecuted: false,
      failures: [
        {
          ok: false,
          id: "args",
          error: "this example runner validates case shape only and does not execute --impl",
        },
      ],
    }) + "\n",
  );
  process.exit(1);
}

const caseDir = argValue("--cases") ?? "spec/conformance/cases";
const results = readdirSync(caseDir)
  .filter((name) => name.endsWith(".yaml"))
  .sort()
  .map((name) => parseCase(join(caseDir, name)));
const failures = results.filter((result) => !result.ok);
const report = {
  ok: failures.length === 0,
  command: "case-shape",
  cases: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  implExecuted: false,
  failures,
};

process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.ok ? 0 : 1);
