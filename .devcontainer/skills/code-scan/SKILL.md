---
name: code-scan
description: Use to scan an implementation codebase for concrete issues, prioritize them, and track improvement across iterations. Works across Go, Rust, Python, TypeScript.
---

# Code Scan

Surface concrete, fixable issues in implementation codebases. Prioritize by
risk. Track findings across iterations so the loop converges.

## Inputs

- `target`: path to scan (e.g., `impl_v2/go`, `impl/rust`)
- `mode`: `scan` (default) | `rescan` | `compare`
- `top_n`: number of findings to surface (default 5)
- `target_a`, `target_b`: paths to compare when `mode=compare`
- `path_map`: optional path prefix mapping for compare mode

## Quick Path

1. Detect language from target (go.mod, Cargo.toml, pyproject.toml, package.json/tsconfig.json).
2. Discover source and test files. Skip vendored, generated, fixture dirs unless
   the target itself is a fixture/test validation path.
3. Run scan lenses per the Scan Strategy below. Use parallel subagents when
   available; otherwise run the lenses locally.
4. Validate worker reports against the Finding schema. Quarantine malformed
   reports; do not merge them.
5. Merge findings, deduplicate by fingerprint, assign tiers, sort, emit top N
   for the human report only.
6. Persist the full validated finding set under `tmp/code-scan/<target-key>/`.
7. On `rescan`: load `current.jsonl`, verify persistent/resolved/new/regressed
   findings by fingerprint, then emit top N for the report.
8. On `compare`: scan `target_a` and `target_b` with the same guide version,
   then produce paired/unpaired findings and risk deltas.

## Orchestrator Contract

The orchestrator owns workflow state and policy:

- Preflight target paths, language detection, exclusion rules, artifact paths,
  and scan budget.
- Launch workers with `references/scan-guide.md`, one lens, one target, and a
  required output path under `runs/<scan-id>/workers/<lens>.jsonl`.
- Record `schema_version`, `scan_id`, target path, git commit, dirty state,
  skill hash, guide hash, lenses, and worker status in `manifest.json`.
- Apply timeouts and at most one retry per failed worker. If output is still
  invalid, write it to `invalid/<lens>.out` and continue with
  `partial_scan: true`.
- Validate worker records before merge. Invalid records are never promoted to
  `current.jsonl`.
- Own tier assignment, dedupe, final sorting, rescan state transitions, and
  compare matching.

Workers own evidence collection only:

- Probe the assigned lens.
- Deep-read selected high-risk functions.
- Emit findings with bug tag, mechanism, evidence, reachability, confidence,
  impact, locations, suggested fix, and mechanical flag.
- Do not assign final tier. A worker may suggest `tier_hint`, but the
  orchestrator is authoritative.

## Scan Strategy

Run 2-3 scan lenses, preferably in parallel when the agent environment allows
it. Each covers a lens, not a file — overlap is fine, the merge step
deduplicates by fingerprint.

| Agent | Lens | What to report |
| --- | --- | --- |
| correctness | Error handling, type safety, silent failures, unsafe patterns, in-place mutation hazards | Unchecked errors, `_ = err`, type assertions without ok, silent discards, unsafe casts, bare `except:`, `.unwrap()` in non-test code, slice/array aliasing, shared-state mutation |
| structure | Duplication, complexity, magic values, coupling | Functions >80 LOC, repeated code blocks, repeated expressions, literals used in multiple places without constant, file >500 LOC with mixed concerns, duplicated predicate/ordering logic |
| testing | Coverage gaps, missing test categories, untested error paths | Missing fuzz/property/concurrent tests, commands with no test, error paths only tested on happy path, boundary values untested |

Each agent gets the guide (references/scan-guide.md), one lens, the target
path, and an output path. Each returns JSONL findings in the Finding format
below. Probe logs go to `probe-hits.jsonl`, not to `findings.jsonl`.

### Subagent Instructions

Agents scan in two phases: **probe** (fast grep-based pattern matching) then
**triage** (targeted deep reads of high-risk functions).

#### Phase 1: Probe
1. Read directory structure and key files (entry point, types, main logic).
2. Grep for smell patterns relevant to the lens.
3. For every grep probe, report the hit count, excluded hit count, and capped
   examples in the worker summary. Write every call site to `probe-hits.jsonl`.
   Do not put raw probe inventory in the human report.
4. Read surrounding context (5-10 lines) for flagged locations.

#### Phase 2: Triage (deep read)
After the probe phase, identify functions that:
- (a) Take slice, pointer, or mutable reference arguments
- (b) Discard errors from sub-calls (`_ =`, bare `except`, `.unwrap()`)
- (c) Operate on shared or global state (locks, globals, singletons)

Deep-read at most 5-8 functions per lens. Prioritize by external input,
persistence, concurrency/shared state, fan-in, and Phase 1 risk signal. For
each selected function, read the full function body and one level of callers.
List omitted candidates in `triage_omitted[]` so partial coverage is explicit.

**Triage verification:** At the end of your output, emit a line:
`triage_reads: N` where N is the number of functions deep-read in Phase 2.
Also emit `triage_partial: true` when high-risk candidates were omitted due to
budget. If N = 0, explain why.

#### Reporting rules
5. Report only findings with specific file:line and a code snippet.
6. Do NOT flag style preferences, missing comments, or "could be more
   idiomatic" without a concrete downside.

## Quality Gate

**Every finding must include a `risk` field with two parts:**

```
risk: [<bug-class-tag>] <mechanism sentence>
```

The **tag** is from the closed vocabulary in the Bug Class Tags appendix.
The **mechanism sentence** must name a specific identifier (variable,
function, field, or line reference) and the condition that triggers the bug.

### Gate rules

A finding **passes** if:
- Tag is from the vocabulary (or `[unknown]` with justification)
- Mechanism sentence names at least one specific identifier
- Example: `[type-assertion-panic] summary[check.Severity].(int) panics
  when severity is not one of the three pre-seeded map keys`

A finding **fails** (drop it) if:
- Tag is missing or not from vocabulary
- Mechanism sentence is generic: `potential data race`, `could cause wrong
  behavior`, `possible nil dereference` — none of these name a specific
  variable, operation, or condition
- Risk restates the observation: `risk is that there is no test`

### Examples

Fail: `[race-condition] potential data race`
Pass: `[race-condition] unsynchronized append to store.entries at line 47
while Range() iterates in healthData`

Fail: `[silent-discard] error silently discarded`
Pass: `[silent-discard] writeSuccess return value ignored at cli.go:228;
broken pipe causes truncated JSON with exit code 0`

Fail: `[unknown] could cause issues in the future`
Pass: `[unknown] setIfDiff compares via fmt.Sprint — float64(2) and int(2)
both Sprint to "2", masking type differences after JSON round-trip`

No numeric thresholds. No category caps. Tag + mechanism is the only gate.

## Criteria

### What to flag

| Category | Signal |
| --- | --- |
| Correctness | Could cause wrong behavior, data loss, crash, or silent failure |
| Test gap | Missing test for a specific bug class (must name the bug class) |
| Duplication | Repeated pattern that must stay in sync but has no mechanism ensuring it |
| Magic values | Literals in multiple places where divergence causes a bug (must name the bug) |
| Complexity | Long function where mixed concerns create a specific maintenance risk (must name what goes wrong) |

### What NOT to flag

- Style without correctness impact
- Missing docs or comments
- "Could use X pattern" without concrete downside
- Anything requiring architectural redesign (flag as observation, don't tier)
- Generated code, test fixtures, vendored deps
- Stdlib wrappers with no branching or error handling logic
- Functions with no test when you cannot name a bug the test would catch

## Prioritization

### Tier Classification

The orchestrator assigns each finding to a tier from worker evidence. Agents
do not assign final tiers.

| Tier | Definition | Examples |
| --- | --- | --- |
| **P0** | Fix before ship. Crash, data loss, security bypass on reachable path. | Unrecovered panic on user input; unchecked type assertion that crashes; write without fsync on data path |
| **P1** | Fix soon. Wrong behavior, silent failure, or missing test for a crash/data-loss path. | Silent error discard on I/O path; no fuzz test for parser handling untrusted input; error code that can diverge across files |
| **P2** | Fix eventually. Maintenance risk, duplication with divergence risk, missing test for non-critical path. | Duplicated comparator logic; repeated expression pattern; boundary values untested for validation function |
| **P3** | Nice to have. Low-risk cleanup. | Magic value with divergence risk in non-critical code; long function that could be split |

### Orchestrator Sort Order

Within each tier, the orchestrator sorts by:
1. Reachability (`confirmed` > `probable` > `unknown`)
2. Confidence (`high` > `medium` > `low`)
3. Impact scope (`data-loss/security/crash` > `wrong-behavior` > `maintenance`)
4. `1 + log2(site_count)` descending — more sites = higher leverage, but
   logarithmic to prevent 30-site style issues outranking 2-site crashes
5. File path ascending — deterministic tiebreak

The orchestrator computes this mechanically. Agents provide evidence and
locations.

## Finding Format

Each validated finding is one JSON record:

```jsonc
{
  "schema_version": 1,
  "id": "f-<8hex>",
  "fingerprint": "sha256:<hex>",   // tag + normalized path + symbol + snippet/context + site set
  "scan_id": "2026-05-15T120102Z-<8hex>",
  "target": "impl_v2/go",
  "lens": "correctness|structure|testing",
  "tier": "P0|P1|P2|P3",           // orchestrator-assigned in merged output
  "tier_hint": "P0|P1|P2|P3",      // optional worker hint
  "category": "correctness|test-gap|duplication|magic-value|complexity",
  "primary_location": {
    "file": "internal/app/cli.go",
    "line": 674,
    "line_end": 674,
    "symbol": "runReady",
    "snippet": "readyID, _ := readyIssue[\"id\"].(string)",
    "redacted": false
  },
  "locations": [
    {
      "file": "internal/app/cli.go",
      "line": 674,
      "line_end": 674,
      "symbol": "runReady",
      "snippet": "readyID, _ := readyIssue[\"id\"].(string)",
      "role": "primary",
      "redacted": false
    }
  ],
  "description": "Type assertion discards ok; empty string on missing field",
  "risk": "[silent-discard] readyIssue[\"id\"].(string) discards ok; empty string used as issue ID, findIssue returns NOT_FOUND masking corrupt ready-list data",
  "evidence": "observed|inferred|needs_confirmation",
  "reachability": "confirmed|probable|unknown",
  "confidence": "high|medium|low",
  "impact_scope": "data-loss|security|crash|wrong-behavior|maintenance",
  "suggested_fix": "Add ok check, return error if missing",
  "mechanical": true,
  "site_count": 1,
  "first_seen": "2026-05-15T12:01:02Z",
  "last_seen": "2026-05-15T12:01:02Z",
  "seen_count": 1,
  "status": "new|persistent|resolved|regression"
}
```

**Findings without a non-empty, concrete `risk` field are invalid and must
be dropped during merge.** Findings are also invalid if the primary snippet
does not match the referenced file line unless `redacted: true`.

## Storage

Target key is `<safe-slug>-<8hex>`, where the hash is based on the normalized
target path. This prevents collisions such as `a/b-c` and `a-b/c`.

All scan artifacts live under `tmp/code-scan/<target-key>/` from the repo
root. Keep scan artifacts out of app-owned state directories and generated
dependency/build directories.

```
tmp/code-scan/impl_v2-go-1a2b3c4d/
  current.jsonl           -- full active finding set, rewritten atomically
  events.jsonl            -- append-only finding lifecycle events
  comparisons/            -- compare reports involving this target
  runs/<scan-id>/
    manifest.json         -- run metadata and hashes
    probe-hits.jsonl      -- full probe inventory
    merged.jsonl          -- full validated merged findings for this run
    report.md             -- top N human report
    workers/<lens>.jsonl  -- raw worker finding records
    invalid/              -- malformed worker outputs
```

Write `current.jsonl` via temp file + atomic rename. Use a lock file under the
target key while a scan is running. Runtime artifacts stay ignored by the repo
root ignore policy unless explicitly exported.

### Convergence Tracking

Each `rescan` compares merged findings against prior `current.jsonl` by
fingerprint:
- **Resolved**: prior fingerprint not found in rescan -> append resolved event
- **Persistent**: fingerprint still present -> bump `seen_count`
- **New**: fingerprint not in prior scan or history -> add as new
- **Regression**: fingerprint from resolved history reappears -> mark
  `status: "regression"`

`events.jsonl` tracks trend: `{timestamp, total, resolved, new, regressions}`.
Convergence = total findings decreasing over iterations.

## Compare Protocol

For `mode=compare`, require `target_a` and `target_b`. Scan both targets with
the same skill hash, guide hash, lenses, and schema version. Output:

```jsonc
{
  "schema_version": 1,
  "target_a": "impl/go",
  "target_b": "impl_v2/go",
  "path_map": {"impl/go/": "impl_v2/go/"},
  "matched_findings": [],
  "left_only": [],
  "right_only": [],
  "risk_delta": "summary by tier/tag",
  "coverage_delta": "summary by lens/probe",
  "normalization_notes": []
}
```

Present tradeoffs per criterion. Do not declare an overall winner unless the
user explicitly asks.

## Language-Specific Patterns

Load `references/scan-guide.md` for the full guide. Summary of
language-specific smells that are NOT style preferences:

### Go
- `_ = err` (silent error discard — report count and write full sites to probe artifact)
- Type assertions without ok check (bare `.(Type)` that can panic)
- `map[string]any` access without key existence check
- `interface{}` where generics would prevent runtime panic
- Slice aliasing via `xs[:0]` reslice (mutates backing array)
- No fuzz tests for parser functions

### Rust
- `.unwrap()` / `.expect()` in non-test code
- `.clone()` only when tied to a concrete resource or semantic failure
- `unsafe` block without justifying comment
- Missing `#[must_use]` on Result-returning functions

### Python
- Bare `except:` or `except Exception:`
- `type: ignore` without error code
- Mutable default arguments
- Missing `__all__` only when public export drift causes a named bug
- `Any` type annotation only when it hides a concrete type bug

### TypeScript
- `any` type, `as` casts, `@ts-ignore`
- Unhandled promise rejections (missing `.catch` or `await`)
- `enum` only when serialization or runtime value drift causes a named bug
- Non-strict tsconfig

## Safety

- Scan is read-only. Never modify source files during scan.
- Do not flag secrets, credentials, or PII in findings — flag their
  presence as a correctness issue but do not include the value in the snippet.
  Use a masked snippet and `redacted: true`.
- Findings are informational. The scan does not fix anything.
- On `compare` mode, present balanced analysis — not "X is better than Y"
  overall, but specific tradeoffs per criterion.

## Rescan Protocol

After fixes are applied (by human or separate agent):

1. Load prior `current.jsonl` and `events.jsonl`.
2. Run fresh scan with same lenses and current guide; record skill/guide hash.
3. Match findings by fingerprint, using line only as a hint.
4. Emit updated `current.jsonl` atomically and append lifecycle events.
5. Report: N resolved, N persistent, N new, N regressions.
6. If regressions > 0, flag prominently — the fix loop may be oscillating.

## Smoke Test

To verify the skill works from a cold start (no conversation context),
run a scan against the test fixtures:

```
target: .devcontainer/skills/code-scan/test/cold-start
mode: scan
top_n: all
```

**Expected findings (minimum — must find all):**

| File | Bug | Tag | Tier |
| --- | --- | --- | --- |
| sample_small.go:10 | `os.ReadFile` error discarded | `[silent-discard]` | P1 |
| sample_small.go:17 | bare `.(string)` type assertion | `[type-assertion-panic]` | P0 |
| sample_medium.go:36 | `tags[:0]` slice aliasing | `[slice-aliasing]` | P0 |
| sample_medium.go:45+58 | duplicated sort comparator | `[divergence]` | P1 |
| sample_medium.go:77+ | "NOT_FOUND" string literal 4x | `[divergence]` | P2 |

If any expected finding is missing, the skill has regressed. Do NOT
reference test file contents in any other section of this document — the
skill must find them through general scanning.

Optional executable check:

```
python3 .devcontainer/skills/code-scan/test/validate_cold_start.py \
  tmp/code-scan/<target-key>/runs/<scan-id>/merged.jsonl
```

## Bug Class Tags

Closed vocabulary for the `risk` field tag. Use `[unknown]` only when no
tag fits — requires extra justification in the mechanism sentence.

### Universal (all languages)
- `silent-discard` — error/result discarded, execution continues with wrong/default data
- `race-condition` — unsynchronized access to shared mutable state
- `deadlock` — lock acquisition ordering or missing release
- `data-loss` — write path that can lose or corrupt persisted data
- `integer-overflow` — arithmetic overflow or truncation changing value
- `path-traversal` — unsanitized path input reaching filesystem operations
- `injection` — unsanitized input reaching command, query, or template
- `infinite-loop` — unbounded loop with no exit condition on reachable path
- `divergence` — duplicated logic/values that must stay in sync but can drift
- `format-mismatch` — serialization/deserialization format disagreement

### Go
- `type-assertion-panic` — bare `.(Type)` without comma-ok on reachable path
- `slice-aliasing` — in-place mutation via reslice (`[:0]`) corrupts caller's view
- `nil-map-write` — write to uninitialized map causes panic
- `goroutine-leak` — goroutine blocked forever on channel/lock
- `unchecked-error` — error return value assigned to `_` on non-cleanup path

### Rust
- `unwrap-panic` — `.unwrap()` / `.expect()` on user-reachable path
- `unsafe-unsound` — `unsafe` block with incorrect safety invariant
- `use-after-move` — value used after ownership transfer (rare, usually compile error)
- `excessive-clone` — `.clone()` hiding ownership issue that causes performance or logic bug

### Python
- `bare-except` — `except:` or `except Exception:` swallowing all errors
- `mutable-default` — mutable default argument shared across calls
- `type-ignore-unscoped` — `# type: ignore` without error code suppressing real type errors
- `any-proliferation` — `Any` annotation hiding type errors that would catch bugs

### TypeScript
- `any-cast` — `any` type or `as` cast bypassing type checking
- `unhandled-rejection` — promise without `.catch` or `await` in try/catch
- `ts-ignore` — `@ts-ignore` suppressing real type errors
- `non-strict` — tsconfig missing strict flags allowing implicit any

### Meta
- `unknown` — novel bug class not in vocabulary. Mechanism sentence must
  compensate with extra specificity. Findings with `[unknown]` are flagged
  for human review.
