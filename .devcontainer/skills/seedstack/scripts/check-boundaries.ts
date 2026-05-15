#!/usr/bin/env bun
// Deterministic Seedstack boundary sizing checks.
//
// This checker is orchestration health, not SeedSpec store health. It reads
// plan seed cards and reports advisory/blocking boundary pressure without
// mutating the SeedSpec graph.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type CardValue = string | string[];
type Card = Record<string, CardValue>;
type Severity = "warning" | "blocker";
type Decision = "pass" | "warn" | "block";

type Finding = {
  severity: Severity;
  code: string;
  seed_ref: string;
  threshold?: number;
  observed?: number;
  action: string;
  detail?: unknown;
};

type Options = {
  plan?: string;
  repo: string;
  seed?: string;
  maxSeedTarget: number;
  hotFile: number;
  splitCandidate: number;
  strictBoundaries: boolean;
  pretty: boolean;
  selfTest: boolean;
};

const HELP = `check-boundaries.ts seedstack_boundary_health.v1

Usage:
  bun skills/seedstack/scripts/check-boundaries.ts <plan> [args]
  bun skills/seedstack/scripts/check-boundaries.ts --self-test [--pretty]

Args:
  --repo <path>                 Repo root. Default: cwd.
  --seed <id>                   Current work order id for reporting.
  --max-seed-target <n>         Warning target for seed LOC. Default: 600.
  --hot-file <n>                Warning target for projected hot file LOC. Default: 800.
  --split-candidate <n>         Blocking seed LOC threshold. Default: 1200.
  --strict-boundaries           Treat boundary warnings as blockers.
  --pretty                      Pretty-print JSON.
  --self-test                   Run lightweight self-test.
  --help                        Show this help.

Seed card fields:
  boundary_id: rust-storage-lock
  boundary_kind: impl
  boundary_files: [impl_v2/rust/src/main.rs]
  boundary_public_api: false
  public_api_rationale: ...
  boundary_hot_files: [impl_v2/rust/src/main.rs=3786]
`;

function usage(exitCode: 0 | 2): never {
  (exitCode === 0 ? process.stdout : process.stderr).write(HELP);
  process.exit(exitCode);
}

function take(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

function parsePositive(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be positive integer`);
  const parsed = Number(value);
  if (parsed <= 0) throw new Error(`${flag} must be positive`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    repo: process.cwd(),
    maxSeedTarget: 600,
    hotFile: 800,
    splitCandidate: 1200,
    strictBoundaries: false,
    pretty: false,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
      case "--strict-boundaries":
        options.strictBoundaries = true;
        break;
      case "--repo":
        options.repo = take(argv, index, arg);
        index += 1;
        break;
      case "--seed":
        options.seed = take(argv, index, arg);
        index += 1;
        break;
      case "--max-seed-target":
        options.maxSeedTarget = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--hot-file":
        options.hotFile = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      case "--split-candidate":
        options.splitCandidate = parsePositive(take(argv, index, arg), arg);
        index += 1;
        break;
      default:
        if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
        else if (arg.startsWith("--seed=")) options.seed = arg.slice("--seed=".length);
        else if (arg.startsWith("--max-seed-target=")) {
          options.maxSeedTarget = parsePositive(arg.slice("--max-seed-target=".length), "--max-seed-target");
        } else if (arg.startsWith("--hot-file=")) {
          options.hotFile = parsePositive(arg.slice("--hot-file=".length), "--hot-file");
        } else if (arg.startsWith("--split-candidate=")) {
          options.splitCandidate = parsePositive(arg.slice("--split-candidate=".length), "--split-candidate");
        } else if (arg.startsWith("-")) usage(2);
        else if (!options.plan) options.plan = arg;
        else usage(2);
    }
  }
  options.repo = resolve(options.repo);
  if (options.plan) options.plan = resolve(options.repo, options.plan);
  if (!options.selfTest && !options.plan) usage(2);
  if (options.maxSeedTarget >= options.splitCandidate) {
    throw new Error("--max-seed-target must be lower than --split-candidate");
  }
  return options;
}

function stripInlineComment(value: string): string {
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "'" || char === '"') && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (char === "#" && !quote) return value.slice(0, index);
  }
  return value;
}

function parseList(value: string): string[] {
  const trimmed = stripInlineComment(value).trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
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
    /^\s*(temp_id|seed_slug|title|labels|priority|blocked_by|area|estimated_loc|boundary_id|boundary_kind|boundary_files):/m;
  for (const match of text.matchAll(fencePattern)) {
    const block = dedent(match[1]);
    if (!seedCardKeyPattern.test(block)) continue;
    const card: Card = {};
    let currentKey: string | undefined;
    for (const raw of block.split(/\r?\n/)) {
      const stripped = raw.trim();
      if (!stripped || stripped.startsWith("#")) continue;
      if (!/^[ \t]/.test(raw) && stripped.includes(":")) {
        const [keyPart, ...rest] = stripped.split(":");
        const key = keyPart.trim();
        const value = rest.join(":").trim();
        currentKey = key;
        if (key === "labels" || key === "blocked_by" || key === "boundary_files" || key === "boundary_hot_files") {
          card[key] = parseList(value);
        } else {
          card[key] = stripInlineComment(value).trim().replace(/^['"]|['"]$/g, "");
        }
        continue;
      }
      if (stripped.startsWith("- ") && currentKey) {
        const values = Array.isArray(card[currentKey]) ? (card[currentKey] as string[]) : [];
        values.push(stripInlineComment(stripped.slice(2)).trim().replace(/^['"]|['"]$/g, ""));
        card[currentKey] = values;
      }
    }
    cards.push(card);
  }
  return cards;
}

function asString(value: CardValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value: CardValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function seedRef(card: Card, index: number): string {
  return asString(card.temp_id) || asString(card.seed_slug) || `card-${index + 1}`;
}

function estimatedMax(value: string): number | null {
  const numbers = [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
  return numbers.length ? Math.max(...numbers) : null;
}

function hotFileTotal(entry: string): { path: string; total: number } | null {
  const match = entry.match(/^(.+?)(?:=|:)(\d+)$/);
  if (!match) return null;
  return { path: match[1].trim(), total: Number(match[2]) };
}

function boundaryKind(card: Card): string {
  const explicit = asString(card.boundary_kind);
  if (explicit) return explicit;
  return asList(card.labels).includes("impl") ? "impl" : "";
}

function cardMatchesSeed(card: Card, seed: string | undefined): boolean {
  if (!seed) return true;
  return [asString(card.temp_id), asString(card.seed_slug), asString(card.seed_id)]
    .filter(Boolean)
    .includes(seed);
}

function check(text: string, options: Options) {
  const cards = extractCards(text);
  const relevant = cards.filter((card) => cardMatchesSeed(card, options.seed));
  const checkedCards = options.seed ? relevant : cards;
  const findings: Finding[] = [];

  if (cards.length === 0) {
    findings.push({
      severity: options.strictBoundaries ? "blocker" : "warning",
      code: "BOUNDARY_NO_SEED_CARDS_PARSED",
      seed_ref: options.seed ?? "(all)",
      action: "ensure plan has fenced yaml seed cards before relying on boundary health",
    });
  } else if (options.seed && relevant.length === 0) {
    findings.push({
      severity: options.strictBoundaries ? "blocker" : "warning",
      code: "BOUNDARY_SEED_NOT_FOUND",
      seed_ref: options.seed,
      action: "sync selected work order id with plan handles or run boundary health without --seed",
    });
  }

  checkedCards.forEach((card, index) => {
    const ref = seedRef(card, index);
    const kind = boundaryKind(card);
    const boundaryId = asString(card.boundary_id);
    const locMax = estimatedMax(asString(card.estimated_loc));
    const files = asList(card.boundary_files);

    if (kind === "impl" && !boundaryId) {
      findings.push({
        severity: options.strictBoundaries ? "blocker" : "warning",
        code: "BOUNDARY_ID_MISSING",
        seed_ref: ref,
        action: "add boundary_id to implementation seed card",
      });
    }
    if (kind === "impl" && files.length === 0) {
      findings.push({
        severity: options.strictBoundaries ? "blocker" : "warning",
        code: "BOUNDARY_FILES_MISSING",
        seed_ref: ref,
        action: "add boundary_files so reviewer can assess hot files",
      });
    }
    if (locMax !== null && locMax > options.splitCandidate) {
      findings.push({
        severity: "blocker",
        code: "BOUNDARY_SPLIT_CANDIDATE_EXCEEDED",
        seed_ref: ref,
        threshold: options.splitCandidate,
        observed: locMax,
        action: "split seed or record user-approved oversized seed",
      });
    } else if (locMax !== null && locMax > options.maxSeedTarget) {
      findings.push({
        severity: options.strictBoundaries ? "blocker" : "warning",
        code: "BOUNDARY_OVER_TARGET",
        seed_ref: ref,
        threshold: options.maxSeedTarget,
        observed: locMax,
        action: "review rationale; split only if boundary is grab-bag",
      });
    }

    for (const entry of asList(card.boundary_hot_files)) {
      const hot = hotFileTotal(entry);
      if (!hot) {
        findings.push({
          severity: "warning",
          code: "BOUNDARY_HOT_FILE_PARSE_FAILED",
          seed_ref: ref,
          action: "format boundary_hot_files as path=projected_total",
          detail: { entry },
        });
        continue;
      }
      if (hot.total > options.hotFile) {
        findings.push({
          severity: options.strictBoundaries ? "blocker" : "warning",
          code: "BOUNDARY_HOT_FILE",
          seed_ref: ref,
          threshold: options.hotFile,
          observed: hot.total,
          action: "record file-growth plan or extraction candidate",
          detail: { path: hot.path },
        });
      }
    }

    if (asString(card.boundary_public_api).toLowerCase() === "true" && !asString(card.public_api_rationale)) {
      findings.push({
        severity: "blocker",
        code: "BOUNDARY_PUBLIC_API_UNJUSTIFIED",
        seed_ref: ref,
        action: "keep private modules or add explicit crate-boundary rationale",
      });
    }
  });

  const blockers = findings.filter((finding) => finding.severity === "blocker");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const decision: Decision = blockers.length > 0 ? "block" : warnings.length > 0 ? "warn" : "pass";
  return {
    contract: "seedstack_boundary_health.v1",
    ok: blockers.length === 0,
    decision,
    plan: options.plan ?? null,
    seed: options.seed ?? null,
    thresholds: {
      max_seed_target: options.maxSeedTarget,
      hot_file: options.hotFile,
      split_candidate: options.splitCandidate,
      strict_boundaries: options.strictBoundaries,
    },
    summary: {
      seed_cards: cards.length,
      checked_cards: checkedCards.length,
      warnings: warnings.length,
      blockers: blockers.length,
    },
    findings,
  };
}

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

function selfTest(pretty: boolean): void {
  const healthy = `
\`\`\`yaml
temp_id: N1
seed_slug: rust-init
boundary_kind: impl
boundary_id: rust-init
boundary_files: [impl_v2/rust/src/main.rs]
estimated_loc: 250-500
\`\`\`
`;
  assert(check(healthy, { ...parseArgs(["--self-test"]), pretty }).decision === "pass", "healthy should pass");
  const warning = healthy.replace("250-500", "650-700");
  assert(check(warning, { ...parseArgs(["--self-test"]), pretty }).decision === "warn", "over target should warn");
  const blocker = healthy.replace("250-500", "1300");
  assert(check(blocker, { ...parseArgs(["--self-test"]), pretty }).decision === "block", "split candidate should block");
  const miss = check(healthy, { ...parseArgs(["--self-test", "--seed", "seedspec-dead"]), pretty });
  assert(miss.decision === "warn", "seed miss should warn");
  assert(miss.summary.checked_cards === 0, "seed miss must not fall back to all cards");
  assert(check("no fenced seed cards", { ...parseArgs(["--self-test"]), pretty }).decision === "warn", "no cards should warn");
  const hotList = healthy.replace(
    "boundary_files: [impl_v2/rust/src/main.rs]",
    "boundary_hot_files:\n  - impl_v2/rust/src/main.rs=900 # projected",
  );
  assert(check(hotList, { ...parseArgs(["--self-test"]), pretty }).decision === "warn", "hot file list should parse comments");
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    selfTest(options.pretty);
    process.stdout.write(`${JSON.stringify({ contract: "seedstack_boundary_health.self_test.v1", ok: true }, null, options.pretty ? 2 : 0)}\n`);
    process.exit(0);
  }
  if (!options.plan || !existsSync(options.plan)) {
    throw new Error(`plan not found: ${options.plan ?? "(missing)"}`);
  }
  const result = check(readFileSync(options.plan, "utf8"), options);
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`check-boundaries: ${(error as Error).message}\n`);
  process.exit(2);
}
