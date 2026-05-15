#!/usr/bin/env bun

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function write(path: string, text: string) {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(path, text);
}

function writeMinimalSpec(root: string) {
  write(
    join(root, "spec/README.md"),
    [
      "# Example 0.1",
      "## Normative Precedence",
      "1. `spec/glossary.md`",
      "2. `spec/decisions.md`",
      "3. `spec/behavior.md`",
    ].join("\n"),
  );
  write(join(root, "spec/glossary.md"), "# Glossary\n");
  write(join(root, "spec/decision-index.md"), "# Decision Index\n");
  write(
    join(root, "spec/behavior.md"),
    "# Behavior\n\n## B1 Core\n\nB1.1 Count tokens.\n",
  );
  write(
    join(root, "spec/decisions.md"),
    [
      "# Decisions",
      "",
      "## DEC-0001 Count Tokens",
      "",
      "Status: accepted",
      "Date: 2026-05-14",
      "Spec: example-0.1",
      "Area: logic",
      "Compatibility: new",
      "",
      "### Context",
      "",
      "Token counting needs one rule.",
      "",
      "### Decision",
      "",
      "Count whitespace-delimited tokens.",
      "",
      "### Consequences",
      "",
      "Simple portable behavior.",
      "",
      "### Conformance",
      "",
      "None yet. Reason: minimal fixture.",
      "",
      "### Verification Impact",
      "",
      "Add conformance before release.",
      "",
      "### Affected Artifacts",
      "",
      "- clauses: `spec/behavior.md`",
      "- schemas: none",
      "- conformance: none",
      "- models: none",
      "- implementations: none",
      "",
      "### References",
      "",
      "- Self-test fixture.",
    ].join("\n"),
  );
}

function parseOutput(proc: ReturnType<typeof Bun.spawnSync>) {
  const stdout = new TextDecoder().decode(proc.stdout);
  return { stdout, parsed: JSON.parse(stdout) };
}

function fail(message: string, data: Record<string, unknown>) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      command: "validate-spec-kit-self-test",
      data,
      error: {
        code: "SELF_TEST_FAILED",
        message,
        details: {},
      },
    }) + "\n",
  );
  process.exit(1);
}

const script = join(dirname(fileURLToPath(import.meta.url)), "validate-spec-kit.ts");

function writeSkillFiles(root: string) {
  const skillRoot = join(root, "skills/spec-kit");
  write(
    join(skillRoot, "SKILL.md"),
    "name: spec-kit\nimplementation-neutral contract\n## Source Precedence\n## Mode Selection\n## Missing Often\n",
  );
  for (const file of [
    "from-scratch.md",
    "distill-from-repo.md",
    "iteration-and-hardening.md",
    "implementation-docs.md",
    "implementation-guide-research.md",
    "review-lenses.md",
  ]) {
    write(join(skillRoot, "references", file), "# Ref\ncontent\n");
  }
  write(
    join(skillRoot, "references/artifact-templates.md"),
    "# Templates\n<placeholder intentionally allowed here>\n",
  );
}

function expectFailWithCode(
  root: string,
  code: string,
  label: string,
  mode = "--target",
) {
  const proc = Bun.spawnSync(["bun", script, mode, root]);
  const result = parseOutput(proc);
  const codes = result.parsed.data.findings.map(
    (finding: { code: string }) => finding.code,
  );
  if (proc.exitCode === 0 || result.parsed.ok !== false || !codes.includes(code)) {
    fail(`Expected invalid fixture to fail with ${code}.`, {
      label,
      stdout: result.stdout,
      exitCode: proc.exitCode,
      codes,
    });
  }
}

const sourceRoot = mkdtempSync(join(tmpdir(), "spec-kit-source-"));
writeMinimalSpec(sourceRoot);
writeSkillFiles(sourceRoot);

const sourceProc = Bun.spawnSync(["bun", script, "--skill-source", sourceRoot]);
const source = parseOutput(sourceProc);
if (sourceProc.exitCode !== 0 || source.parsed.ok !== true) {
  fail("Expected valid skill-source fixture to pass.", {
    stdout: source.stdout,
    exitCode: sourceProc.exitCode,
  });
}

const targetRoot = mkdtempSync(join(tmpdir(), "spec-kit-target-"));
writeMinimalSpec(targetRoot);
const targetProc = Bun.spawnSync(["bun", script, "--target", targetRoot]);
const target = parseOutput(targetProc);
if (targetProc.exitCode !== 0 || target.parsed.ok !== true) {
  fail("Expected valid target fixture without skills/ or docs/ to pass.", {
    stdout: target.stdout,
    exitCode: targetProc.exitCode,
  });
}

const brokenRefRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-ref-"));
writeMinimalSpec(brokenRefRoot);
write(
  join(brokenRefRoot, "spec/README.md"),
  "# Broken\n\n## Normative Precedence\n\n1. `spec/glossary.md`\n2. `spec/decisions.md`\n3. `spec/missing.md`\n",
);
expectFailWithCode(brokenRefRoot, "BROKEN_SPEC_REFERENCE", "broken markdown path");

const brokenAnchorRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-anchor-"));
writeMinimalSpec(brokenAnchorRoot);
write(
  join(brokenAnchorRoot, "spec/conformance/cases/bad-anchor.yaml"),
  "id: bad-anchor\ntitle: Bad anchor\nsources:\n  - spec/behavior.md#missing-clause\noperation: count\ninput: {}\nexpect:\n  outcome: success\n",
);
expectFailWithCode(brokenAnchorRoot, "BROKEN_SPEC_ANCHOR", "broken markdown anchor");

const prefixAnchorRoot = mkdtempSync(join(tmpdir(), "spec-kit-prefix-anchor-"));
writeMinimalSpec(prefixAnchorRoot);
write(join(prefixAnchorRoot, "spec/behavior.md"), "# Behavior\n\n## Core Extra\n\nB1.1 x.\n");
write(
  join(prefixAnchorRoot, "spec/conformance/cases/prefix-anchor.yaml"),
  "id: prefix-anchor\ntitle: Prefix anchor\nsources:\n  - spec/behavior.md#core\noperation: count\ninput: {}\nexpect:\n  outcome: success\n",
);
expectFailWithCode(prefixAnchorRoot, "BROKEN_SPEC_ANCHOR", "prefix markdown anchor");

const dottedAnchorRoot = mkdtempSync(join(tmpdir(), "spec-kit-dotted-anchor-"));
writeMinimalSpec(dottedAnchorRoot);
write(join(dottedAnchorRoot, "spec/behavior.md"), "# Behavior\n\n## B11 Core\n\nB1.1 x.\n");
write(
  join(dottedAnchorRoot, "spec/conformance/cases/dotted-anchor.yaml"),
  "id: dotted-anchor\ntitle: Dotted anchor\nsources:\n  - spec/behavior.md#b1.1\noperation: count\ninput: {}\nexpect:\n  outcome: success\n",
);
expectFailWithCode(dottedAnchorRoot, "BROKEN_SPEC_ANCHOR", "dotted markdown anchor");

const brokenDecisionRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-decision-"));
writeMinimalSpec(brokenDecisionRoot);
write(
  join(brokenDecisionRoot, "spec/decisions.md"),
  "# Decisions\n\n## DEC-0001 Missing Metadata\n\n### Context\n\nx\n",
);
expectFailWithCode(
  brokenDecisionRoot,
  "MISSING_DECISION_METADATA",
  "missing decision metadata",
);

const brokenCaseRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-case-"));
writeMinimalSpec(brokenCaseRoot);
write(
  join(brokenCaseRoot, "spec/conformance/cases/no-source.yaml"),
  "id: no-source\ntitle: No source\nsources:\noperation: count\ninput: {}\nexpect:\n  outcome: success\n",
);
expectFailWithCode(
  brokenCaseRoot,
  "MISSING_SOURCE_CITATION",
  "missing conformance source citation",
);

const emptyCaseRoot = mkdtempSync(join(tmpdir(), "spec-kit-empty-case-"));
writeMinimalSpec(emptyCaseRoot);
write(join(emptyCaseRoot, "spec/conformance/cases/empty.yaml"), "\n");
expectFailWithCode(emptyCaseRoot, "EMPTY_CONFORMANCE_CASE", "empty conformance case");

const brokenSchemaRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-schema-"));
writeMinimalSpec(brokenSchemaRoot);
write(join(brokenSchemaRoot, "spec/schemas/bad.schema.json"), "{ nope");
expectFailWithCode(brokenSchemaRoot, "INVALID_JSON_SCHEMA", "invalid schema json");

const brokenJsonRefRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-json-ref-"));
writeMinimalSpec(brokenJsonRefRoot);
write(
  join(brokenJsonRefRoot, "spec/schemas/bad-ref.schema.json"),
  JSON.stringify({ type: "object", properties: { item: { $ref: "missing.schema.json" } } }),
);
expectFailWithCode(brokenJsonRefRoot, "BROKEN_JSON_REF", "broken json schema ref");

const brokenJsonPointerRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-json-pointer-"));
writeMinimalSpec(brokenJsonPointerRoot);
write(
  join(brokenJsonPointerRoot, "spec/schemas/base.schema.json"),
  JSON.stringify({ $defs: { present: { type: "string" } } }),
);
write(
  join(brokenJsonPointerRoot, "spec/schemas/bad-pointer.schema.json"),
  JSON.stringify({ type: "object", properties: { item: { $ref: "base.schema.json#/$defs/missing" } } }),
);
expectFailWithCode(
  brokenJsonPointerRoot,
  "BROKEN_JSON_POINTER",
  "broken json schema pointer",
);

const encodedJsonPointerRoot = mkdtempSync(join(tmpdir(), "spec-kit-encoded-json-pointer-"));
writeMinimalSpec(encodedJsonPointerRoot);
write(
  join(encodedJsonPointerRoot, "spec/schemas/base.schema.json"),
  JSON.stringify({ $defs: { "foo bar": { type: "string" } } }),
);
write(
  join(encodedJsonPointerRoot, "spec/schemas/encoded-pointer.schema.json"),
  JSON.stringify({ type: "object", properties: { item: { $ref: "base.schema.json#/$defs/foo%20bar" } } }),
);
const encodedPointerProc = Bun.spawnSync(["bun", script, "--target", encodedJsonPointerRoot]);
const encodedPointer = parseOutput(encodedPointerProc);
if (encodedPointerProc.exitCode !== 0 || encodedPointer.parsed.ok !== true) {
  fail("Expected URI-encoded JSON pointer fixture to pass.", {
    stdout: encodedPointer.stdout,
    exitCode: encodedPointerProc.exitCode,
  });
}

const internalJsonPointerRoot = mkdtempSync(join(tmpdir(), "spec-kit-internal-json-pointer-"));
writeMinimalSpec(internalJsonPointerRoot);
write(
  join(internalJsonPointerRoot, "spec/schemas/internal.schema.json"),
  JSON.stringify({
    $defs: { present: { type: "string" } },
    type: "object",
    properties: { item: { $ref: "#/$defs/present" } },
  }),
);
const internalPointerProc = Bun.spawnSync(["bun", script, "--target", internalJsonPointerRoot]);
const internalPointer = parseOutput(internalPointerProc);
if (internalPointerProc.exitCode !== 0 || internalPointer.parsed.ok !== true) {
  fail("Expected internal JSON pointer fixture to pass.", {
    stdout: internalPointer.stdout,
    exitCode: internalPointerProc.exitCode,
  });
}

const quotedSourceRoot = mkdtempSync(join(tmpdir(), "spec-kit-quoted-source-"));
writeMinimalSpec(quotedSourceRoot);
write(
  join(quotedSourceRoot, "spec/conformance/cases/quoted-source.yaml"),
  "id: quoted-source\ntitle: Quoted source\nsources:\n  - \"spec/behavior.md#b1-core\"\noperation: count\ninput: {}\nexpect:\n  outcome: success\n",
);
const quotedSourceProc = Bun.spawnSync(["bun", script, "--target", quotedSourceRoot]);
const quotedSource = parseOutput(quotedSourceProc);
if (quotedSourceProc.exitCode !== 0 || quotedSource.parsed.ok !== true) {
  fail("Expected quoted YAML source fixture to pass.", {
    stdout: quotedSource.stdout,
    exitCode: quotedSourceProc.exitCode,
  });
}

const brokenPrecedenceRoot = mkdtempSync(join(tmpdir(), "spec-kit-broken-precedence-"));
writeMinimalSpec(brokenPrecedenceRoot);
write(
  join(brokenPrecedenceRoot, "spec/README.md"),
  [
    "# Broken",
    "",
    "## Normative Precedence",
    "",
    "1. `spec/glossary.md`",
    "2. `spec/decisions.md`",
    "3. numbered clauses",
    "4. non-normative guidance under `spec/`, when present",
  ].join("\n"),
);
expectFailWithCode(
  brokenPrecedenceRoot,
  "NON_NORMATIVE_IN_PRECEDENCE",
  "non-normative guidance in precedence",
);

const brokenSourceExampleRoot = mkdtempSync(join(tmpdir(), "spec-kit-source-broken-example-"));
writeMinimalSpec(brokenSourceExampleRoot);
writeSkillFiles(brokenSourceExampleRoot);
writeMinimalSpec(join(brokenSourceExampleRoot, "skills/spec-kit/examples/minimal"));
write(
  join(brokenSourceExampleRoot, "skills/spec-kit/examples/minimal/spec/decisions.md"),
  "# Decisions\n\n## DEC-0001 Missing Source Metadata\n\n### Context\n\nx\n",
);
expectFailWithCode(
  brokenSourceExampleRoot,
  "MISSING_DECISION_METADATA",
  "skill-source bundled example decision metadata",
  "--skill-source",
);

process.stdout.write(
  JSON.stringify({
    ok: true,
    command: "validate-spec-kit-self-test",
    data: {
      sourceRoot,
      targetRoot,
      negativeCases: 12,
    },
  }) + "\n",
);
