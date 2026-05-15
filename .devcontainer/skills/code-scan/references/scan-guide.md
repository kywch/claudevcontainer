# Scan Guide

This document is the scan prompt template. Each scan worker, local or
delegated, receives this guide plus a lens assignment and target path.

## Your Role

You are scanning `{{target}}` through the `{{lens}}` lens. Your job is to
find concrete, fixable issues — not to review the entire codebase.

## Worker Contract

The orchestrator owns final tiering, dedupe, sorting, storage, rescan, and
compare. You own evidence collection for one lens.

Return JSONL finding records only. Use `tier_hint` if useful; do not treat it
as final tier. Include locations, evidence, reachability, confidence, impact,
suggested fix, mechanical flag, `site_count`, `triage_reads`, and
`triage_partial`.

Write raw probe inventory to `probe-hits.jsonl` when an output path is
provided. Do not flood the human report with every hit.

## Scope and Safety

Exclude vendored, generated, dependency, build, and fixture paths unless the
target itself is a fixture/test validation path. Use exclusions equivalent to:

```
--glob '!vendor/**'
--glob '!node_modules/**'
--glob '!dist/**'
--glob '!build/**'
--glob '!coverage/**'
--glob '!target/**'
--glob '!*.pb.go'
--glob '!*_generated*'
--glob '!testdata/**'
--glob '!fixtures/**'
```

Generated/vendor/fixture hits count as excluded hits, not findings.

Scan is read-only. Never edit source files. Do not include secret, credential,
token, or PII values in snippets. If the finding is secret exposure, mask the
snippet and set `redacted: true` on that location.

## How to Scan

Two phases: fast probe, then targeted deep read.

### Phase 1: Probe

#### Step 1: Orient
- Read directory listing and file sizes
- Read entry point / main file
- Read type definitions or domain model
- Identify the language and its conventions

#### Step 2: Grep and count
Use grep/glob to search for patterns specific to your lens. For every probe,
report:

- `probe`
- total hit count
- excluded hit count
- files with hits
- capped examples (default 20)
- selection rule for deeper reads

Do not silently skip probes. Put full call sites in `probe-hits.jsonl` if an
artifact path is available.

##### Correctness Lens Probes
```
# Go
grep: `_ =`                     -- silent error discards. Count sites; write full hits to artifact.
grep: `\.\([^)]+\)`             -- type assertion. Check if comma-ok form used.
grep: `\[".*"\]\.\(`            -- map access + type assert combo
grep: `\.Unlock\(\)`            -- check if deferred or manual
grep: `\[:0\]`                  -- slice reslice (potential aliasing)

# Rust
grep: `\.(unwrap|expect)\(`     -- panicking unwrap/expect
grep: `unsafe\s*\{`             -- unsafe blocks
grep: `\.clone\(`               -- only report with concrete resource/logic risk

# Python
grep: `except:`                 -- bare except
grep: `except Exception`        -- broad except
grep: `type:\s*ignore`          -- type suppression
grep: `= \[\]` or `= \{\}`     -- in function signatures (mutable defaults)

# TypeScript
grep: `: any`                   -- any types
grep: `as any`                  -- unsafe casts
grep: `@ts-ignore`              -- type suppression
grep: `\.then\(` without `.catch` -- unhandled rejections
- inspect tsconfig strict flags       -- non-strict config risk
```

##### Structure Lens Probes
```
# All languages
- File line counts (wc -l equivalent via file sizes)
- Functions: count lines between `func ` / `fn ` / `def ` / `function ` boundaries
- grep: literal numbers in conditionals (magic values)
- grep: same string literal appearing in multiple files
- Look for repeated code blocks (3+ lines identical or near-identical)
- Find duplicated predicate/ordering logic: compare bodies of sort/compare
  callbacks (Go: sort.Slice, Rust: sort_by, Python: key=, TS: Array.sort)
- Find repeated expressions (not just repeated functions): same multi-token
  expression appearing 5+ times (e.g., `values[k][len(values[k])-1]`)
```

##### Testing Lens Probes
```
# Go
grep: `func Fuzz`               -- fuzz tests exist?
grep: `testing/quick`           -- property tests exist?
grep: `t\.Parallel`             -- parallel tests?
grep: `go func`                 -- concurrent tests?
- Compare: functions in source vs functions in test (coverage proxy)

# Rust
grep: `proptest!`               -- property tests?
grep: `#\[should_panic\]`       -- panic tests?
- Check for integration test directory (tests/)

# Python
grep: `hypothesis`              -- property tests?
grep: `pytest\.mark\.parametrize` -- parameterized tests?
grep: `@pytest.fixture`         -- observation only unless fixture state leak is concrete

# TypeScript
grep: `fc\.`                    -- fast-check property tests?
grep: `\.each\(`                -- parameterized tests?
grep: `jest\.mock\|vi\.mock`    -- mock usage patterns
```

#### Step 3: Read context
For each grep hit, read 5-10 surrounding lines. Discard false positives.
A `_ = err` in a defer cleanup may be intentional. An `.unwrap()` in a test
is fine. Use judgment.

Style-prone probes (`.clone()`, missing exports, fixtures, `enum`, broad
`Any`) are observation-only unless you can name a reachable failure mechanism.

### Phase 2: Triage (deep read)

After the probe phase, identify **high-risk functions** — those that:
- (a) Take slice, pointer, or mutable reference arguments
- (b) Discard errors from sub-calls
- (c) Operate on shared or global state (locks, globals, singletons)
- (d) Are called from many sites (high fan-in)

Deep-read at most 5-8 functions per lens. Prioritize by external input,
persistence, concurrency/shared state, fan-in, and Phase 1 risk signal. For
each selected function, read the full body and one level of callers. This
phase catches issues that patterns miss:
- Slice aliasing where caller retains a reference to mutated backing array
- Error propagation gaps where an error is handled but the wrong value is
  returned or a cleanup step is skipped
- Lock/unlock asymmetry visible only in the full function body
- Shared-state mutation visible only when reading caller + callee together

**Triage verification:** At the end of your output, emit:
`triage_reads: N` where N = number of functions you deep-read. If you did
not triage any functions, emit `triage_reads: 0` and explain why (e.g., no
functions matched criteria a-d). If high-risk candidates were omitted due to
budget, emit `triage_partial: true` and list `triage_omitted`.

### Step 4: Report
Output findings in the Finding format from SKILL.md. Include:
- Exact file path (relative to target root)
- Primary location and `locations[]`
- Line number and snippet (actual line unless redacted)
- **Risk field with tag + mechanism** (see Quality Gate in SKILL.md).
  Format: `[bug-class-tag] mechanism sentence naming specific identifier`.
  Findings without this format are invalid.
- `tier_hint` if helpful; final tier belongs to the orchestrator
- `evidence`: `observed`, `inferred`, or `needs_confirmation`
- `reachability`: `confirmed`, `probable`, or `unknown`
- `confidence`: `high`, `medium`, or `low`
- `impact_scope`: `data-loss`, `security`, `crash`, `wrong-behavior`, or
  `maintenance`
- Whether the fix is mechanical or requires judgment
- How many sites have this pattern

## What Makes a Good Finding

A good finding has:
- **Location**: file:line, not "the code could be better"
- **Snippet**: the actual code, not paraphrased
- **Risk**: names a specific bug class ("if field missing, empty string used
  as issue ID, causing NOT_FOUND that masks corrupt data")
- **Scope**: one issue per finding, not "this file has many problems"
- **Evidence**: state whether the failure path is observed, inferred, or still
  needs confirmation

A finding is noise if:
- It cannot name a bug class ("consider adding documentation")
- The downside is aesthetic ("could be more idiomatic")
- It restates the observation as the risk ("risk is that there is no test")
- It starts with "best practice suggests"

## Quality Gate

Before including a finding, it must pass the **tag + mechanism** gate:

```
risk: [<bug-class-tag>] <mechanism sentence>
```

1. Pick a tag from the Bug Class Tags appendix in SKILL.md (or `[unknown]`
   with justification).
2. Write a mechanism sentence that names at least one **specific identifier**
   (variable name, function name, field name, or line reference) and the
   **condition** that triggers the bug.
3. Verify the primary snippet matches the file line unless redacted.

**Drop the finding** if you cannot write a mechanism sentence with a
specific identifier. Generic statements fail the gate:
- `[race-condition] potential data race` — no identifier, no condition
- `[silent-discard] error silently discarded` — no identifier
- `[unknown] could cause issues` — no mechanism at all

**Keep the finding** if the mechanism is concrete:
- `[type-assertion-panic] summary[check.Severity].(int) panics when
  severity is not one of the three pre-seeded map keys`
- `[divergence] title limit 200 appears as bare literal in both
  commands.go:146 and health.go:257; changing one without the other means
  create succeeds but health fails on the same issue`

## Cross-Language Principles

These apply regardless of language:

1. **Silent failures are bugs.** Any path where an error is discarded and
   execution continues with wrong/default data is a correctness finding.

2. **Type narrowing without verification is a risk.** Any cast, assertion,
   or conversion that assumes a type without checking is worth flagging if
   the source is external (user input, file I/O, JSON parsing).
   **Distinguish bare assertions (can panic) from comma-ok/try forms (safe
   but may produce wrong default).** Bare assertions are P0 if on reachable
   paths; comma-ok with discarded ok is P1.

3. **Untested categories are gaps — but only with a named bug class and code
   risk anchor.** If
   the test suite has zero fuzz tests and the code has a parser for
   untrusted input, that's a finding because malformed input could panic.
   If the code has no property tests but the logic is simple arithmetic,
   that's not a finding.

4. **Duplication is only a finding if it creates divergence risk.** Two
   similar blocks that could change independently are fine. Two blocks that
   must stay in sync but have no mechanism ensuring it — that's a finding.
   This includes duplicated expressions (not just duplicated functions).

5. **Magic values are only a finding if divergence causes a bug.** State
   what breaks if the values drift apart. "Error code typo in one site
   breaks retry matching" is a finding. "Path string repeated" without a
   failure mode is not.
