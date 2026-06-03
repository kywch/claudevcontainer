#!/usr/bin/env bun
// Deterministic Seedstack plan checks.
//
// Reads a markdown plan and validates the mechanical seed-card checks that
// must run before pre-creation review. The parser intentionally supports the
// simple YAML subset used in seed cards and avoids external dependencies.

import { readFileSync } from "node:fs";

type Gate = { raw: string };
type CardValue = string | string[] | Gate[];
type Card = Record<string, CardValue> & { gates?: Gate[] };
type PathRef = { path: string; source: string };

function usage(exitCode: 0 | 2): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write("usage: check-plan.ts <plan> --shared-label <label>\n       check-plan.ts --self-test\n");
  process.exit(exitCode);
}

function parseArgs(): { plan?: string; sharedLabel?: string; selfTest: boolean } {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(0);
  }
  let plan: string | undefined;
  let sharedLabel: string | undefined;
  let selfTest = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--self-test") {
      selfTest = true;
      continue;
    }
    if (arg === "--shared-label") {
      sharedLabel = args[++index];
      continue;
    }
    if (arg.startsWith("--shared-label=")) {
      sharedLabel = arg.slice("--shared-label=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      usage(2);
    }
    if (plan) {
      usage(2);
    }
    plan = arg;
  }
  if (selfTest) {
    return { selfTest };
  }
  if (!plan || !sharedLabel?.trim()) {
    usage(2);
  }
  return { plan, sharedLabel, selfTest };
}

function parseList(value: string): string[] {
  const trimmed = stripInlineComment(value).trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, ""));
}

function stripInlineComment(value: string): string {
  let quote: string | undefined;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if ((char === "'" || char === '"') && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (char === "#" && !quote) {
      return value.slice(0, index);
    }
  }
  return value;
}

function dedent(block: string): string {
  const lines = block.split(/\r?\n/);
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(minIndent)).join("\n");
}

function extractCards(text: string): Card[] {
  const cards: Card[] = [];
  const fencePattern = /^[ \t]*```ya?ml[^\r\n]*\r?\n([\s\S]*?)^[ \t]*```/gim;
  const seedCardKeyPattern =
    /^\s*(temp_id|seed_slug|title|labels|priority|blocked_by|parallel_ok|area|support_area|source_refs|acceptance|gates|verification_owner|target_gates|estimated_loc|dispatch_notes):/m;
  for (const match of text.matchAll(fencePattern)) {
    const block = dedent(match[1]);
    if (!seedCardKeyPattern.test(block)) {
      continue;
    }

    const card: Card = { gates: [] };
    let currentKey: string | undefined;

    for (const raw of block.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/g, "");
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) {
        continue;
      }

      if (!/^[ \t]/.test(raw) && stripped.includes(":")) {
        const [keyPart, ...rest] = stripped.split(":");
        const key = keyPart.trim();
        const value = rest.join(":").trim();
        currentKey = key;
        if (key === "labels" || key === "blocked_by") {
          card[key] = parseList(value);
        } else if (value) {
          card[key] = stripInlineComment(value).trim().replace(/^['"]|['"]$/g, "");
        } else {
          card[key] = [];
        }
        continue;
      }

      if (stripped.startsWith("- ") && currentKey) {
        const item = stripped.slice(2).trim();
        if (currentKey === "gates") {
          const gates = Array.isArray(card.gates) ? card.gates : [];
          gates.push({ raw: item });
          card.gates = gates;
        } else {
          const values = Array.isArray(card[currentKey]) ? (card[currentKey] as string[]) : [];
          values.push(item);
          card[currentKey] = values;
        }
        continue;
      }

      if (currentKey === "gates" && Array.isArray(card.gates) && card.gates.length > 0) {
        const last = card.gates[card.gates.length - 1];
        last.raw = `${last.raw}\n${stripped}`;
      }
    }

    cards.push(card);
  }
  return cards;
}

function hasPlaceholderGate(card: Card): boolean {
  const gates = card.gates;
  if (!Array.isArray(gates) || gates.length === 0) {
    return true;
  }
  return gates.some((gate) => !validGate(gate));
}

const allowedGateTypes = new Set([
  "static",
  "unit",
  "integration",
  "conformance",
  "pbt",
  "model",
  "stutter",
  "mutation",
  "review",
  "full",
]);

function gateField(raw: string, field: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\n)${field}:\\s*(.+)`, "i");
  return raw.match(pattern)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

function placeholderText(value: string): boolean {
  const lower = value.toLowerCase();
  return [
    "todo",
    "tbd",
    "placeholder",
    "exact command",
    "run tests",
    "check manually",
    "as appropriate",
    "...",
  ].some((marker) => lower.includes(marker));
}

function validGate(gate: Gate): boolean {
  const type = gateField(gate.raw, "type")?.toLowerCase();
  const command = gateField(gate.raw, "command");
  if (!type || !allowedGateTypes.has(type)) {
    return false;
  }
  if (!command || placeholderText(command)) {
    return false;
  }
  return true;
}

function asStringArray(value: CardValue | undefined): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

function nonemptyListWithoutPlaceholders(
  card: Card,
  tempId: string,
  field: string,
  errors: string[],
): string[] | undefined {
  const values = asStringArray(card[field]);
  if (!values || values.length === 0) {
    errors.push(`${tempId}: empty ${field}`);
    return undefined;
  }
  values.forEach((value, index) => {
    if (!value.trim() || placeholderText(value)) {
      errors.push(`${tempId}: placeholder ${field}[${index}]`);
    }
  });
  return values;
}

function parseAreaRoots(value: CardValue | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[+;,|]/)
    .map((item) => item.trim().replace(/^['"`]|['"`]$/g, "").replace(/^\.?\//, "").replace(/\/+$/, ""))
    .filter(Boolean);
}

function validAreaRoot(value: string): boolean {
  if (placeholderText(value)) return false;
  if (value.startsWith("/") || value.startsWith("tmp/") || value.startsWith(".seeds/")) return false;
  if (/\s/.test(value)) return false;
  return /^(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+(?:\.[A-Za-z0-9][A-Za-z0-9._+-]*)?$/.test(value);
}

function gateText(card: Card): string {
  const gates = Array.isArray(card.gates) ? card.gates.map((gate) => gate.raw) : [];
  const targetGates = asStringArray(card.target_gates) ?? [];
  return [...gates, ...targetGates].join("\n");
}

function gateCommands(card: Card): string[] {
  const gates = Array.isArray(card.gates) ? card.gates : [];
  return gates
    .filter((gate) => {
      const type = gateField(gate.raw, "type")?.toLowerCase();
      return type !== "review" && type !== "full";
    })
    .map((gate) => gateField(gate.raw, "command"))
    .filter((value): value is string => Boolean(value));
}

function targetGateLines(card: Card): string[] {
  return asStringArray(card.target_gates) ?? [];
}

function listLines(card: Card, field: string): string[] {
  return asStringArray(card[field]) ?? [];
}

function stripPathDecorators(value: string): string {
  return value
    .trim()
    .replace(/^['"`([{<]+/, "")
    .replace(/[>'"`)\]},.;]+$/g, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
}

function normalizePathToken(token: string): string | undefined {
  let value = stripPathDecorators(token);
  if (!value || value.includes("://") || value.startsWith("#")) return undefined;
  if (/^[A-Z_][A-Z0-9_]*=/.test(value)) {
    value = value.slice(value.indexOf("=") + 1);
  }
  value = stripPathDecorators(value);
  if (!value || value.startsWith("-") || value.includes("://")) return undefined;
  if (/[*?{}]/.test(value)) return undefined;
  if (value.startsWith("$") || value.startsWith("~")) return undefined;
  if (value.includes("=")) return undefined;
  const looksLikePath =
    value.includes("/") ||
    value.startsWith(".") ||
    /^[A-Za-z0-9._+-]+\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|qnt|sh|mjs|cjs|py|rs|go)$/.test(value);
  if (!looksLikePath) return undefined;
  if (!/^[A-Za-z0-9._+/@-]+$/.test(value)) return undefined;
  return value;
}

function extractPathRefs(lines: string[], source: string): PathRef[] {
  const refs: PathRef[] = [];
  for (const line of lines) {
    for (const token of line.split(/\s+/)) {
      const path = normalizePathToken(token);
      if (path) refs.push({ path, source });
    }
  }
  return refs;
}

function rootCoversPath(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function pathCoveredByRoots(path: string, roots: string[]): boolean {
  return roots.some((root) => rootCoversPath(root, path));
}

function gateCoversAreaPath(gatePath: string, areaPath: string): boolean {
  return rootCoversPath(areaPath, gatePath) || rootCoversPath(gatePath, areaPath);
}

function gateRefs(card: Card): PathRef[] {
  return [
    ...extractPathRefs(gateCommands(card), "gates.command"),
    ...extractPathRefs(targetGateLines(card), "target_gates"),
  ];
}

function gateCommandPathRefs(card: Card): PathRef[] {
  return extractPathRefs(gateCommands(card), "gates.command");
}

function isSmokePath(path: string): boolean {
  return path === "test/smoke" || path.startsWith("test/smoke/") || path.includes("/smoke/");
}

function isContractSeed(card: Card): boolean {
  const labels = asStringArray(card.labels) ?? [];
  const seedSlug = String(card.seed_slug ?? "").toLowerCase();
  const title = String(card.title ?? "").toLowerCase();
  return labels.includes("contract") || seedSlug.includes("contract") || title.includes("contract");
}

function mentionsCompileStub(card: Card): boolean {
  const text = [
    ...listLines(card, "acceptance"),
    ...listLines(card, "dispatch_notes"),
    String(card.title ?? ""),
  ].join("\n").toLowerCase();
  return /\b(?:compile|typecheck|minimum|minimal)?\s*stubs?\b|\bstubs?\s*(?:needed|required|for tests to compile)\b/.test(text);
}

function supportAreaHasProof(card: Card, root: string): boolean {
  if (gateText(card).includes(root)) return true;
  if (!root.startsWith("src/") || !isContractSeed(card) || !mentionsCompileStub(card)) return false;
  return [...listLines(card, "acceptance"), ...listLines(card, "dispatch_notes")].some((line) => line.includes(root));
}

const args = parseArgs();
if (args.selfTest) {
  process.exit(runSelfTest());
}
const plan = args.plan ?? "";
const sharedLabel = args.sharedLabel ?? "";
if (!validLabel(sharedLabel)) {
  console.error(`check-plan: invalid shared label ${sharedLabel}`);
  process.exit(2);
}
let text = "";
try {
  text = readFileSync(plan, "utf8");
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? ` ${(error as { code: string }).code}` : "";
  console.error(`check-plan: cannot read ${plan}:${code}`);
  process.exit(2);
}
const result = validatePlanText(plan, text, sharedLabel);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function validatePlanText(plan: string, text: string, sharedLabel: string) {
const cards = extractCards(text);
const errors: string[] = [];

if (cards.length === 0) {
  errors.push("no seed cards found in yaml fences");
}

const ids: string[] = [];
cards.forEach((card, index) => {
  const tempId = String(card.temp_id ?? "").trim();
  if (!tempId) {
    errors.push(`card ${index + 1}: missing temp_id`);
  } else if (placeholderText(tempId)) {
    errors.push(`card ${index + 1}: placeholder temp_id`);
  }
  ids.push(tempId);
});

const seen = new Set<string>();
for (const tempId of ids) {
  if (seen.has(tempId)) {
    errors.push(`duplicate temp_id: ${tempId}`);
  }
  seen.add(tempId);
}

const idSet = new Set(ids);
const indexById = new Map(ids.map((id, index) => [id, index]));
const depsById = new Map<string, string[]>();

for (const card of cards) {
  const tempId = String(card.temp_id ?? "").trim();
  const labels = asStringArray(card.labels);
  const blockedBy = asStringArray(card.blocked_by);
  const index = indexById.get(tempId) ?? 0;
  const previousTempId = index > 0 ? ids[index - 1] : undefined;
  const parallelOk = String(card.parallel_ok ?? "").trim().toLowerCase() === "true";

  for (const field of ["seed_slug", "title", "area", "estimated_loc"]) {
    const value = card[field];
    if (typeof value !== "string" || !value.trim() || placeholderText(value)) {
      errors.push(`${tempId}: missing or placeholder ${field}`);
    }
  }

  const areaRoots = parseAreaRoots(card.area);
  for (const root of areaRoots) {
    if (!validAreaRoot(root)) {
      errors.push(`${tempId}: invalid area root ${root}`);
    }
  }

  const supportRoots = parseAreaRoots(card.support_area);
  const scopeRoots = [...areaRoots, ...supportRoots];
  if (card.support_area !== undefined) {
    if (supportRoots.length === 0) {
      errors.push(`${tempId}: empty or invalid support_area`);
    }
    for (const root of supportRoots) {
      if (!validAreaRoot(root)) {
        errors.push(`${tempId}: invalid support_area root ${root}`);
      }
      if (areaRoots.includes(root)) {
        errors.push(`${tempId}: support_area duplicates area root ${root}`);
      }
    }
    for (const root of supportRoots) {
      if (supportAreaHasProof(card, root)) continue;
      errors.push(`${tempId}: support_area ${root} is not referenced by gates or target_gates`);
    }
  }

  for (const ref of gateRefs(card)) {
    if (!pathCoveredByRoots(ref.path, scopeRoots)) {
      errors.push(`${tempId}: ${ref.source} path ${ref.path} is not covered by area or support_area`);
    }
  }

  const commandRefs = gateCommandPathRefs(card);
  for (const root of areaRoots.filter(isSmokePath)) {
    if (!commandRefs.some((ref) => gateCoversAreaPath(ref.path, root))) {
      errors.push(`${tempId}: smoke area ${root} has no gate command covering it`);
    }
  }

  if (isContractSeed(card) && mentionsCompileStub(card)) {
    for (const root of areaRoots.filter((areaRoot) => areaRoot.startsWith("src/"))) {
      errors.push(`${tempId}: contract compile stub path ${root} must be support_area, not area`);
    }
  }

  const seedSlug = String(card.seed_slug ?? "").trim();
  if (seedSlug && !validLabel(seedSlug)) {
    errors.push(`${tempId}: invalid seed_slug ${seedSlug}`);
  }

  const priority = String(card.priority ?? "").trim();
  if (!/^-?\d+$/.test(priority)) {
    errors.push(`${tempId}: missing or invalid priority`);
  } else if (Number(priority) !== 1) {
    errors.push(`${tempId}: priority must be 1; use blocked_by for execution order`);
  }

  for (const field of [
    "source_refs",
    "target_gates",
    "dispatch_notes",
    "acceptance",
    "verification_owner",
  ]) {
    nonemptyListWithoutPlaceholders(card, tempId, field, errors);
  }

  if (!labels || !labels.includes(sharedLabel)) {
    errors.push(`${tempId}: missing shared label ${sharedLabel}`);
  }
  for (const label of labels ?? []) {
    if (placeholderText(label)) {
      errors.push(`${tempId}: placeholder label ${label}`);
    }
    if (!validLabel(label)) {
      errors.push(`${tempId}: invalid label ${label}`);
    }
  }

  if (!blockedBy) {
    errors.push(`${tempId}: blocked_by must be list`);
  } else {
    depsById.set(tempId, blockedBy);
    if (previousTempId && !parallelOk && !blockedBy.includes(previousTempId)) {
      errors.push(`${tempId}: default serial spine requires blocked_by ${previousTempId} or parallel_ok: true`);
    }
    for (const dep of blockedBy) {
      if (placeholderText(dep)) {
        errors.push(`${tempId}: placeholder blocked_by ${dep}`);
      }
      if (!idSet.has(dep)) {
        errors.push(`${tempId}: blocked_by unknown temp_id ${dep}`);
      } else if ((indexById.get(dep) ?? 0) >= (indexById.get(tempId) ?? 0)) {
        errors.push(`${tempId}: blocked_by ${dep} appears after dependent`);
      }
    }
  }

  if (hasPlaceholderGate(card)) {
    errors.push(`${tempId}: empty, malformed, or placeholder gate`);
  }
}

for (const cycle of findCycles(ids, depsById)) {
  errors.push(`cycle detected: ${cycle.join(" -> ")}`);
}

for (const [seed, deps] of depsById) {
  for (const dep of deps) {
    if (hasAlternatePath(dep, seed, depsById, `${dep}->${seed}`)) {
      errors.push(`${seed}: blocked_by ${dep} is transitively redundant`);
    }
  }
}

  return {
    errors,
    ok: errors.length === 0,
    plan,
    seed_count: cards.length,
    shared_label: sharedLabel,
  };
}

function runSelfTest(): number {
  const planText = [
    "# Plan",
    "",
    "```yaml",
    "temp_id: N1",
    "seed_slug: support-area-fixture",
    "title: Add support area fixture",
    "labels: [net-fixture, impl]",
    "priority: 1",
    "blocked_by: []",
    "parallel_ok: false",
    "area: src/app",
    "support_area: test/harness",
    "source_refs:",
    "  - src/app/main.ts:1",
    "acceptance:",
    "  - Behavior passes through harness.",
    "gates:",
    "  - type: unit",
    "    command: bun test test/harness/support-area.test.ts",
    "verification_owner:",
    "  - N1 owns harness proof for this seed.",
    "target_gates:",
    "  - bun test test/harness/support-area.test.ts",
    "estimated_loc: 20-60",
    "dispatch_notes:",
    "  - Edit src/app and gate wrapper under test/harness only.",
    "```",
    "",
  ].join("\n");
  const uncoveredGatePath = [
    "# Plan",
    "",
    "```yaml",
    "temp_id: N1",
    "seed_slug: uncovered-gate-fixture",
    "title: Add uncovered gate fixture",
    "labels: [net-fixture, impl]",
    "priority: 1",
    "blocked_by: []",
    "parallel_ok: false",
    "area: src/app",
    "source_refs:",
    "  - src/app/main.ts:1",
    "acceptance:",
    "  - Behavior is covered.",
    "gates:",
    "  - type: unit",
    "    command: bun test test/unit/app.test.ts",
    "verification_owner:",
    "  - N1 owns local proof.",
    "target_gates:",
    "  - bun test test/unit/app.test.ts",
    "estimated_loc: 20-60",
    "dispatch_notes:",
    "  - Edit src/app only.",
    "```",
    "",
  ].join("\n");
  const contractStubArea = [
    "# Plan",
    "",
    "```yaml",
    "temp_id: N1",
    "seed_slug: provider-contract-fixtures",
    "title: Add provider contract fixtures",
    "labels: [net-fixture, contract, local-test]",
    "priority: 1",
    "blocked_by: []",
    "parallel_ok: false",
    "area: test/unit/provider.test.ts+src/provider.ts",
    "source_refs:",
    "  - spec/provider.md",
    "acceptance:",
    "  - Contract tests exist before production implementation.",
    "gates:",
    "  - type: unit",
    "    command: bun test test/unit/provider.test.ts",
    "verification_owner:",
    "  - N1 owns contract proof.",
    "target_gates:",
    "  - bun test test/unit/provider.test.ts",
    "estimated_loc: 20-60",
    "dispatch_notes:",
    "  - Do not implement `src/provider.ts` beyond the minimum stub needed for tests to compile.",
    "```",
    "",
  ].join("\n");
  const contractStubSupport = [
    "# Plan",
    "",
    "```yaml",
    "temp_id: N1",
    "seed_slug: provider-contract-fixtures",
    "title: Add provider contract fixtures",
    "labels: [net-fixture, contract, local-test]",
    "priority: 1",
    "blocked_by: []",
    "parallel_ok: false",
    "area: test/unit/provider.test.ts",
    "support_area: src/provider.ts",
    "source_refs:",
    "  - spec/provider.md",
    "acceptance:",
    "  - Contract tests exist before production implementation.",
    "gates:",
    "  - type: unit",
    "    command: bun test test/unit/provider.test.ts",
    "verification_owner:",
    "  - N1 owns contract proof.",
    "target_gates:",
    "  - bun test test/unit/provider.test.ts",
    "estimated_loc: 20-60",
    "dispatch_notes:",
    "  - Do not implement `src/provider.ts` beyond the minimum stub needed for tests to compile.",
    "```",
    "",
  ].join("\n");
  const smokeAreaWithoutGate = [
    "# Plan",
    "",
    "```yaml",
    "temp_id: N1",
    "seed_slug: optional-smoke-fixture",
    "title: Add provider implementation",
    "labels: [net-fixture, impl, integration]",
    "priority: 1",
    "blocked_by: []",
    "parallel_ok: false",
    "area: src/provider.ts+test/unit/provider.test.ts+test/smoke/provider.read.test.ts",
    "source_refs:",
    "  - spec/provider.md",
    "acceptance:",
    "  - Optional smoke path exists for manual use.",
    "gates:",
    "  - type: unit",
    "    command: bun test test/unit/provider.test.ts",
    "verification_owner:",
    "  - N1 owns provider proof.",
    "target_gates:",
    "  - bun test test/unit/provider.test.ts",
    "estimated_loc: 20-60",
    "dispatch_notes:",
    "  - Provider live smoke is optional/manual.",
    "```",
    "",
  ].join("\n");
  const accepted = validatePlanText("self-test-plan.md", planText, "net-fixture");
  const duplicate = validatePlanText("self-test-plan.md", planText.replace("support_area: test/harness", "support_area: src/app"), "net-fixture");
  const missingGateRef = validatePlanText("self-test-plan.md", planText.replace("support_area: test/harness", "support_area: test/wrapper"), "net-fixture");
  const uncovered = validatePlanText("self-test-plan.md", uncoveredGatePath, "net-fixture");
  const contractStub = validatePlanText("self-test-plan.md", contractStubArea, "net-fixture");
  const contractStubOk = validatePlanText("self-test-plan.md", contractStubSupport, "net-fixture");
  const smokeNoGate = validatePlanText("self-test-plan.md", smokeAreaWithoutGate, "net-fixture");
  const tests = [
    { name: "accepts support_area", pass: accepted.ok, errors: accepted.errors },
    { name: "rejects support_area duplicate of area", pass: !duplicate.ok && duplicate.errors.some((error) => error.includes("duplicates area")), errors: duplicate.errors },
    { name: "checks support_area gate reference", pass: !missingGateRef.ok && missingGateRef.errors.some((error) => error.includes("not referenced by gates")), errors: missingGateRef.errors },
    { name: "checks gate path scope", pass: !uncovered.ok && uncovered.errors.some((error) => error.includes("is not covered by area or support_area")), errors: uncovered.errors },
    { name: "checks contract compile stubs", pass: !contractStub.ok && contractStub.errors.some((error) => error.includes("contract compile stub path")), errors: contractStub.errors },
    { name: "accepts contract compile stub support_area", pass: contractStubOk.ok, errors: contractStubOk.errors },
    { name: "checks smoke area gate coverage", pass: !smokeNoGate.ok && smokeNoGate.errors.some((error) => error.includes("smoke area")), errors: smokeNoGate.errors },
  ];
  console.log(JSON.stringify({ ok: tests.every((test) => test.pass), tests }, null, 2));
  return tests.every((test) => test.pass) ? 0 : 1;
}

function findCycles(ids: string[], depsBySeed: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(seed: string, path: string[]) {
    if (visiting.has(seed)) {
      const start = path.indexOf(seed);
      cycles.push([...path.slice(start), seed]);
      return;
    }
    if (visited.has(seed)) {
      return;
    }
    visiting.add(seed);
    for (const dep of depsBySeed.get(seed) ?? []) {
      visit(dep, [...path, seed]);
    }
    visiting.delete(seed);
    visited.add(seed);
  }

  for (const id of ids) {
    visit(id, []);
  }
  return cycles;
}

function hasAlternatePath(
  from: string,
  to: string,
  depsBySeed: Map<string, string[]>,
  skippedEdge: string,
): boolean {
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const seed = stack.pop()!;
    for (const dep of depsBySeed.get(seed) ?? []) {
      if (`${dep}->${seed}` === skippedEdge) {
        continue;
      }
      if (dep === from) {
        return true;
      }
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  return false;
}

function validLabel(label: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(label);
}
