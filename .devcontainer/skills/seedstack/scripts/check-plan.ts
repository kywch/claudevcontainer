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

function usage(exitCode: 0 | 2): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write("usage: check-plan.ts <plan> --shared-label <label>\n");
  process.exit(exitCode);
}

function parseArgs(): { plan: string; sharedLabel: string } {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(0);
  }
  let plan: string | undefined;
  let sharedLabel: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
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
  if (!plan || !sharedLabel?.trim()) {
    usage(2);
  }
  return { plan, sharedLabel };
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
    /^\s*(temp_id|seed_slug|title|labels|priority|blocked_by|area|source_refs|acceptance|gates|verification_owner|target_gates|estimated_loc|dispatch_notes):/m;
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

const { plan, sharedLabel } = parseArgs();
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

  for (const field of ["seed_slug", "title", "area", "estimated_loc"]) {
    const value = card[field];
    if (typeof value !== "string" || !value.trim() || placeholderText(value)) {
      errors.push(`${tempId}: missing or placeholder ${field}`);
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

const result = {
  errors,
  ok: errors.length === 0,
  plan,
  seed_count: cards.length,
  shared_label: sharedLabel,
};

console.log(JSON.stringify(result, null, 2));
process.exit(errors.length === 0 ? 0 : 1);

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
