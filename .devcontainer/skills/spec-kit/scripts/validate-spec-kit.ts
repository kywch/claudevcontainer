#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type Finding = {
  code: string;
  path: string;
  message: string;
};

type Result = {
  ok: boolean;
  command: "validate-spec-kit";
  data: {
    root: string;
    checked: string[];
    findings: Finding[];
  };
  error?: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

const requiredFiles = [
  "spec/README.md",
  "spec/glossary.md",
  "spec/decisions.md",
];

const requiredSkillFiles = [
  "skills/spec-kit/SKILL.md",
  "skills/spec-kit/references/from-scratch.md",
  "skills/spec-kit/references/distill-from-repo.md",
  "skills/spec-kit/references/iteration-and-hardening.md",
  "skills/spec-kit/references/implementation-docs.md",
  "skills/spec-kit/references/implementation-guide-research.md",
  "skills/spec-kit/references/artifact-templates.md",
  "skills/spec-kit/references/review-lenses.md",
];

const args = process.argv.slice(2);
const wantsTarget = args.includes("--target");
const wantsSkillSource = args.includes("--skill-source");
const mode = wantsTarget ? "target" : "skill-source";
const rootArg = args.find((arg) => !arg.startsWith("--"));

function emit(result: Result, exitCode: number) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(exitCode);
}

function readText(root: string, path: string, findings: Finding[]): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    findings.push({
      code: "MISSING_FILE",
      path,
      message: "Required file is missing.",
    });
    return "";
  }
  if (!statSync(absolute).isFile()) {
    findings.push({
      code: "NOT_FILE",
      path,
      message: "Required path is not a regular file.",
    });
    return "";
  }
  return readFileSync(absolute, "utf8");
}

function listFiles(root: string, relativeDir: string, extensions: string[]): string[] {
  const base = join(root, relativeDir);
  if (!existsSync(base)) return [];
  if (!statSync(base).isDirectory()) return [];

  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile() && extensions.some((ext) => child.endsWith(ext))) {
        out.push(child);
      }
    }
  };
  visit(relativeDir);
  return out.sort();
}

function addFinding(
  findings: Finding[],
  code: string,
  path: string,
  message: string,
) {
  findings.push({ code, path, message });
}

function checkIncludes(
  text: string,
  path: string,
  needles: string[],
  findings: Finding[],
) {
  for (const needle of needles) {
    if (!text.includes(needle)) {
      findings.push({
        code: "MISSING_TEXT",
        path,
        message: `Missing required text: ${needle}`,
      });
    }
  }
}

function checkNoPlaceholders(text: string, path: string, findings: Finding[]) {
  const forbidden = [/\bTODO\b/i, /<[^>\n]+>/, /\bTBD\b/i];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      findings.push({
        code: "PLACEHOLDER_TEXT",
        path,
        message: `Placeholder-like text matched ${pattern.toString()}.`,
      });
    }
  }
}

function checkNoDocsTargets(text: string, path: string, findings: Finding[]) {
  if (/\bdocs\//.test(text)) {
    findings.push({
      code: "DOCS_TARGET_PATH",
      path,
      message: "Target spec kits must not reference docs/ paths.",
    });
  }
}

function stripAnchor(path: string): string {
  return path.split("#", 1)[0];
}

function anchorOf(path: string): string | undefined {
  const index = path.indexOf("#");
  return index >= 0 ? path.slice(index + 1) : undefined;
}

function trimPathPunctuation(path: string): string {
  return path.replace(/[),.;:]+$/g, "");
}

function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function safeDecodeURIComponent(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

function checkMarkdownAnchor(
  root: string,
  sourcePath: string,
  ref: string,
  target: string,
  findings: Finding[],
) {
  const anchor = anchorOf(ref);
  if (!anchor) return;

  const text = readFileSync(join(root, target), "utf8");
  const decodedAnchor = safeDecodeURIComponent(anchor);
  if (!decodedAnchor) {
    addFinding(
      findings,
      "INVALID_SPEC_REFERENCE",
      sourcePath,
      `Invalid URI-encoded anchor: ${ref}`,
    );
    return;
  }
  const wanted = slug(decodedAnchor);
  const wantedRaw = decodedAnchor.trim().toLowerCase();
  const clauseAnchor = /^[a-z]+[0-9]+(?:\.[0-9]+)?$/.test(wantedRaw);
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => ({
    raw: match[1].trim().toLowerCase(),
    slug: slug(match[1]),
  }));
  const found = headings.some((heading) => {
    if (!decodedAnchor.includes(".") && heading.slug === wanted) return true;
    if (!clauseAnchor) return false;
    return heading.raw.split(/\s+/, 1)[0] === wantedRaw;
  });
  if (!found) {
    addFinding(
      findings,
      "BROKEN_SPEC_ANCHOR",
      sourcePath,
      `Local spec reference anchor does not exist: ${ref}`,
    );
  }
}

function checkLocalSpecReference(
  root: string,
  sourcePath: string,
  ref: string,
  findings: Finding[],
) {
  const normalized = trimPathPunctuation(ref);
  const target = stripAnchor(normalized);
  if (
    target === "spec/" ||
    target === "spec" ||
    target.includes("..") ||
    target.startsWith("/")
  ) {
    addFinding(
      findings,
      "INVALID_SPEC_REFERENCE",
      sourcePath,
      `Invalid local spec reference: ${normalized}`,
    );
    return;
  }
  if (!existsSync(join(root, target))) {
    addFinding(
      findings,
      "BROKEN_SPEC_REFERENCE",
      sourcePath,
      `Local spec reference does not exist: ${normalized}`,
    );
    return;
  }
  if (target.endsWith(".md")) {
    checkMarkdownAnchor(root, sourcePath, normalized, target, findings);
  }
}

function checkMarkdownSpecReferences(
  root: string,
  path: string,
  text: string,
  findings: Finding[],
) {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1].trim();
    if (href.startsWith("spec/")) refs.add(href);
  }
  for (const match of text.matchAll(/`(spec\/[^`\s]+)`/g)) {
    refs.add(match[1]);
  }
  for (const ref of refs) {
    checkLocalSpecReference(root, path, ref, findings);
  }
}

function checkDecisionLog(text: string, path: string, findings: Finding[]) {
  const decisionMatches = [...text.matchAll(/^##\s+(DEC-\d{4})\b.*$/gm)];
  if (decisionMatches.length === 0) {
    addFinding(findings, "NO_DECISIONS", path, "Decision log has no DEC-#### entries.");
    return;
  }

  const requiredHeadings = [
    "Context",
    "Decision",
    "Consequences",
    "Conformance",
    "Verification Impact",
    "Affected Artifacts",
    "References",
  ];

  for (let i = 0; i < decisionMatches.length; i += 1) {
    const match = decisionMatches[i];
    const id = match[1];
    const start = match.index ?? 0;
    const end =
      i + 1 < decisionMatches.length
        ? decisionMatches[i + 1].index ?? text.length
        : text.length;
    const section = text.slice(start, end);
    const context = `${path}#${id.toLowerCase()}`;

    for (const pattern of [
      /^Status:\s+\S+/m,
      /^Date:\s+\d{4}-\d{2}-\d{2}$/m,
      /^Spec:\s+\S+/m,
      /^Area:\s+\S+/m,
      /^Compatibility:\s+\S+/m,
    ]) {
      if (!pattern.test(section)) {
        addFinding(
          findings,
          "MISSING_DECISION_METADATA",
          context,
          `Decision ${id} is missing metadata matching ${pattern.toString()}.`,
        );
      }
    }

    for (const heading of requiredHeadings) {
      const pattern = new RegExp(`^###\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
      if (!pattern.test(section)) {
        addFinding(
          findings,
          "MISSING_DECISION_HEADING",
          context,
          `Decision ${id} is missing heading: ${heading}`,
        );
      }
    }
  }
}

function checkJsonSchemas(
  root: string,
  findings: Finding[],
  checked: string[],
  pathPrefix = "",
) {
  const paths = [
    ...listFiles(root, "spec/schemas", [".json"]),
    ...listFiles(root, "spec/conformance", [".json"]),
  ];
  for (const path of paths) {
    const displayPath = `${pathPrefix}${path}`;
    checked.push(displayPath);
    const text = readText(root, path, findings);
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        addFinding(findings, "INVALID_JSON_SCHEMA", displayPath, "Schema JSON must be an object.");
      }
      checkJsonRefs(root, path, parsed, findings, displayPath);
    } catch (error) {
      addFinding(
        findings,
        "INVALID_JSON_SCHEMA",
        displayPath,
        `Schema JSON parse failed: ${(error as Error).message}`,
      );
    }
  }
}

function checkJsonRefs(
  root: string,
  path: string,
  value: unknown,
  findings: Finding[],
  displayPath: string,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => checkJsonRefs(root, path, item, findings, displayPath));
    return;
  }
  if (value === null || typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref === "string" && !/^[a-z]+:\/\//i.test(ref)) {
    const refTarget = ref.startsWith("#") ? path : stripAnchor(ref);
    const rawPointer = ref.startsWith("#") ? ref.slice(1) : anchorOf(ref);
    const pointer = rawPointer ? safeDecodeURIComponent(rawPointer) : undefined;
    if (rawPointer && !pointer) {
      addFinding(
        findings,
        "INVALID_JSON_REF",
        displayPath,
        `JSON Schema $ref has invalid URI encoding: ${ref}`,
      );
    }
    const absolute = ref.startsWith("#")
      ? join(root, path)
      : resolve(root, dirname(path), refTarget);
    const rel = relative(root, absolute);
    if (rel.startsWith("..") || rel === "" || !existsSync(absolute)) {
      addFinding(
        findings,
        "BROKEN_JSON_REF",
        displayPath,
        `JSON Schema $ref target does not exist: ${ref}`,
      );
    } else if (pointer?.startsWith("/") && !jsonPointerExists(absolute, pointer)) {
      addFinding(
        findings,
        "BROKEN_JSON_POINTER",
        displayPath,
        `JSON Schema $ref pointer does not exist: ${ref}`,
      );
    }
  }
  for (const child of Object.values(obj)) {
    checkJsonRefs(root, path, child, findings, displayPath);
  }
}

function jsonPointerExists(absolutePath: string, pointer: string): boolean {
  let current: unknown;
  try {
    current = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    return false;
  }
  for (const rawPart of pointer.slice(1).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return false;
      }
      current = current[index];
    } else if (current !== null && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return false;
    }
  }
  return true;
}

function checkConformanceCases(
  root: string,
  findings: Finding[],
  checked: string[],
  pathPrefix = "",
) {
  for (const path of listFiles(root, "spec/conformance/cases", [".yaml", ".yml"])) {
    const displayPath = `${pathPrefix}${path}`;
    checked.push(displayPath);
    const text = readText(root, path, findings);
    if (text.trim() === "") {
      addFinding(findings, "EMPTY_CONFORMANCE_CASE", displayPath, "Conformance case is empty.");
      continue;
    }
    for (const pattern of [/^id:\s+\S+/m, /^title:\s+\S+/m, /^sources:\s*$/m, /^operation:\s+\S+/m, /^expect:\s*$/m]) {
      if (!pattern.test(text)) {
        addFinding(
          findings,
          "MISSING_CONFORMANCE_FIELD",
          displayPath,
          `Conformance case missing field matching ${pattern.toString()}.`,
        );
      }
    }

    const sourceRefs = [...text.matchAll(/^\s*-\s+["']?(spec\/[^\s#"'`]+#[^\s"'`]+)["']?\s*$/gm)].map(
      (match) => match[1],
    );
    if (sourceRefs.length === 0) {
      addFinding(
        findings,
        "MISSING_SOURCE_CITATION",
        displayPath,
        "Conformance case must cite at least one local spec source with an anchor.",
      );
    }
    for (const ref of sourceRefs) {
      checkLocalSpecReference(root, displayPath, ref, findings);
    }
  }
}

function checkTargetSpec(
  root: string,
  findings: Finding[],
  checked: string[],
  pathPrefix = "",
) {
  const markdown = listFiles(root, "spec", [".md"]);
  for (const path of markdown) {
    const displayPath = `${pathPrefix}${path}`;
    if (!checked.includes(displayPath)) checked.push(displayPath);
    const text = readText(root, path, findings);
    checkMarkdownSpecReferences(root, displayPath, text, findings);
  }

  const decisions = readText(root, "spec/decisions.md", findings);
  checkDecisionLog(decisions, `${pathPrefix}spec/decisions.md`, findings);
  checkJsonSchemas(root, findings, checked, pathPrefix);
  checkConformanceCases(root, findings, checked, pathPrefix);
}

const root = resolve(rootArg ?? process.cwd());
const findings: Finding[] = [];
const checked: string[] = [];

if (wantsTarget && wantsSkillSource) {
  addFinding(
    findings,
    "INVALID_ARGUMENT",
    "(args)",
    "Use only one mode flag: --target or --skill-source.",
  );
}

const filesToCheck =
  mode === "target" ? requiredFiles : [...requiredFiles, ...requiredSkillFiles];

for (const path of filesToCheck) {
  const text = readText(root, path, findings);
  if (text !== "") checked.push(path);
}

const specReadme = readText(root, "spec/README.md", findings);
checkIncludes(
  specReadme,
  "spec/README.md",
  [
    "## Normative Precedence",
    "spec/glossary.md",
    "spec/decisions.md",
  ],
  findings,
);
if (/^\d+\.\s+.*non-normative guidance under `spec\/`/m.test(specReadme)) {
  addFinding(
    findings,
    "NON_NORMATIVE_IN_PRECEDENCE",
    "spec/README.md",
    "Non-normative guidance must not appear in normative precedence.",
  );
}

const decisions = readText(root, "spec/decisions.md", findings);
checkIncludes(
  decisions,
  "spec/decisions.md",
  ["### Context", "### Decision", "### Consequences", "### Conformance"],
  findings,
);

if (mode === "target") {
  checkTargetSpec(root, findings, checked);
}

if (mode === "skill-source") {
  const skill = readText(root, "skills/spec-kit/SKILL.md", findings);
  checkIncludes(
    skill,
    "skills/spec-kit/SKILL.md",
    [
      "name: spec-kit",
      "## Source Precedence",
      "## Mode Selection",
      "## Missing Often",
      "implementation-neutral contract",
    ],
    findings,
  );

  for (const example of ["skills/spec-kit/examples/minimal", "skills/spec-kit/examples/multi-impl"]) {
    if (existsSync(join(root, example))) {
      checkTargetSpec(join(root, example), findings, checked, `${example}/`);
    }
  }
}

for (const path of mode === "target" ? requiredFiles : requiredSkillFiles) {
  const text = readText(root, path, findings);
  if (path !== "skills/spec-kit/references/artifact-templates.md") {
    checkNoPlaceholders(text, path, findings);
  }
  checkNoDocsTargets(text, path, findings);
}

emit(
  {
    ok: findings.length === 0,
    command: "validate-spec-kit",
    data: { root, checked, findings },
    ...(findings.length > 0
      ? {
          error: {
            code: "VALIDATION_FAILED",
            message: "Spec kit validation failed.",
            details: { count: findings.length },
          },
        }
      : {}),
  },
  findings.length === 0 ? 0 : 1,
);
