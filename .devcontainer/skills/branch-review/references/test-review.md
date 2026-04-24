# Test Review Reviewer

Review test files for mutation-kill value. Most bloat hides as assertions that restate the mock setup or the template literal; most gaps hide behind a wall of happy-path coverage. Sibling to code-cleanup — that reviewer reshapes production code; this one reshapes the tests that guard it.

**Do not auto-edit.** Report ranked findings; user approves. Test deletions have audit-trail implications — a deleted test may be the only surviving record of a fixed bug. Human sign-off required.

## Framework context

Read the repo's test framework from the toolchain the caller passed in (e.g. `node:test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`). Where rules below reference `mock.fn()` / `mock.module()` / `vi.mock` / `jest.mock`, read as "any mocked module dependency" — map the pattern to whatever the repo's framework uses. The heuristics are framework-agnostic.

## Scope

- Default: the repo's primary test directory (infer from toolchain globs), split by module group across 2–4 parallel agents
- With a path arg: single test file or subtree
- With `--recent`: tests whose source changed in the last ~20 commits
- When invoked by `branch-review`: the test partition (changed test files + orphan-detected siblings)

## The core question

**"If I mutate the production code, does this test fail?"** A test that passes against any plausible implementation of the function under test is zero-value — it's asserting on the mock, the template, or a guard that can't fire. Every rule below is a specialization of this question.

Acceptance test for every finding: **name the mutation the finding would kill** (for adds) or **name the mutation the test fails to kill** (for deletes). If you can't, drop the finding.

## Delete / collapse rules

Each rule: (a) one-line rule, (b) pattern to look for, (c) when NOT to apply.

### 1. Mock-echo — delete

(a) Test asserts a value the mock itself produced, through a pass-through.
(b) `mock.fn(() => X); ...; assert.equal(result, X)` with no transform between.
(c) Keep if the forwarding applies a rename, merge, default-fill, or conditional — then mock value and assertion differ. ALSO keep if the assertion uses `notEqual` / negative matcher (adversarial guard), or asserts a production-side call signature (e.g. `mock.calls[0].arguments`, `spy.assert_called_with(...)`) — that's verifying what the code under test *invoked*, not echoing a return value.

### 2. Setter/getter parade — collapse to one smoke test

(a) One test per field on a struct accessor or config builder.
(b) Three or more tests on a 5-line function, each checking one field read.
(c) Keep separate if a field has real branching (default fallback, validation, derived value).

### 3. Template-echo assertions — delete or replace with shape check

(a) Expected string constructed in the test using the same template literal / f-string / format string the production code uses.
(b) Test imports the same constant, or duplicates a multi-line backtick/raw string verbatim.
(c) Keep if asserting a stable contract external consumers rely on (frontmatter shape, on-disk file format, JSON schema, wire protocol). Keep if adversarial — e.g. input that *looks like* it should render but must be stripped (empty `[]`, placeholder stubs); negative assertions are the whole point. Replace template-echo with targeted `assert.match` / shape assertions.

### 4. Defensive-check tests for unreachable states — delete

(a) Exercises an early `if (!x) return` / `throw` / `raise` guard on input real callers can't produce.
(b) Guard exists because the function is exported for tests; no production call site passes `undefined` / `None` / zero-value.
(c) Keep if the guard is a public-API contract (e.g. a function exposed via CLI arg or HTTP handler that real users can hit with bad input). Keep if guarded by a "don't regress" source comment.

### 5. Parallel one-liners — collapse to a table, **carefully**

(a) 5+ tests with identical setup differing only by one input value.
(b) `test("handles X", ...)`, `test("handles Y", ...)` with near-duplicate bodies.
(c) **Keep separate when cases have distinct failure narratives.** Before collapsing, ask: (i) do the cases exercise different regex branches, filter-chain stages, or guard clauses? (ii) Do they target different constants / boundaries in the source? (iii) Would `case 3 failed` in a table be less useful than the named test block when debugging? If any yes, keep separate. Default to keep-separate for tests on URL normalizers, extractors, classifiers, path/permission guards, and format builders with multiple branches. Table is right only when the differentiator is purely the input literal and every case fails at the same assertion for the same reason.

### 6. Integration tests that mock the integration — delete or demote

(a) Test claims to exercise a pipeline but mocks the seam it claims to integrate.
(b) Count SEAM mocks, not total mocks: a mock target resolves to a *seam* if it lives inside the repo's own source tree (the modules the integration claims to exercise). A mock target resolves to a *boundary* if it lives in vendored deps, stdlib, or an external network/system API. Flag if ≥2 mocks hit seams.
(c) Keep if every mock target is a boundary (`node:fs`, `fetch`, `http.Client`, OS syscalls, external APIs). **But** if the integration test is the only surviving coverage of a cross-module triangle, keep it even if heavily mocked — deleting kills the only seam record. **To invoke this escape, name the three seams and the call site where they interact.** Don't assert the triangle exists without naming it.

### 7. Vendor smoke tests — rewrite or delete

(a) Test exercises behavior of a dependency, not this codebase's usage of it.
(b) Test could live in the vendor's own repo unchanged.
(c) **Production-usage gate before deleting:** run `git grep "<dependency>" <source-dirs>` (production only, not tests). If grep finds hits, rewrite the test to pin the specific flags/wrapper contract we rely on, don't delete. If grep finds zero production hits, safe to delete. **Ordering-contract check:** before deleting, scan the assertion sequence for an ordering invariant the vendor requires. If the test asserts both calls happened but ignores order, and reversal would silently break production, loosen to an order-preserving assertion — don't delete.

### 8. Over-specified forwarding — relax assertion shape

(a) Deep-equal against a large object when the real downstream contract is looser. Also applies to `assertEqual(x, entireShape)` where only 1–2 fields carry the contract — the rest is snapshot noise that will fail on unrelated field additions.
(b) Expected object constructed via a spread of the same input the test fed in.
(c) Keep exact-match if the production code *assembles* the shape from multiple sources — the assembly is what's under test. Otherwise loosen to assert only the fields that matter.

### 9. Thin forwarding — delete if mutation-insensitive

(a) Test exercises a pass-through whose only real work is calling one downstream function.
(b) `myFn(x) { return lib.foo(x) }` tested as `assert.equal(lib.foo.mock.calls.length, 1)` — no transform, no guard, no branch.
(c) Keep if the wrapper applies a rename/merge/default-fill, enforces a cap or auth check, or the test adversarially asserts the call was *skipped* under a condition. Also keep if it's the only seam record of a cross-module contract. Delete if the assertion only pins "the SDK was called" — that's a tautology against a one-line wrapper.

### 10. Stale mock target — delete or repoint

(a) `mock.module("<path>")` / `jest.mock("<path>")` / `monkeypatch.setattr("<path>", ...)` where `<path>` doesn't resolve to a real module (renamed file, split directory, deleted export).
(b) Mocking an unresolved path silently no-ops in most runners; every assertion downstream is asserting against an auto-mocked ghost — mutation-blind by construction.
(c) Never keep as-is. Either repoint to the real module (and re-verify the test against the new seam) or delete the test if the original triangle no longer exists.

## Keep-as-is signals

Do not touch a test that shows any of these:

1. **Paired with a "don't regress" comment in the source.** Source comment points back at the test — load-bearing by construction.
2. **Uses real deps where cheap.** Real fs in fixtures, real pure helpers. Low mock-tautology risk.
3. **Exercises a genuine branch readable in the source.** If you can point at the `if` / `switch` / `match` / `catch` / `except` the test covers, it earns its keep.
4. **Documents an ordered contract.** A filter chain, a layered guard, a fallback sequence. Named test blocks encode the order; a table hides it.
5. **Adversarial / false-positive guard.** Tests that something *doesn't* match are often the only defense against over-eager regex or fuzzy-match logic.

## Add-coverage rules

New tests must tie to one of these observed gap patterns. Don't invent coverage for code that already has adequate honest tests.

### A. Untested complex public functions — one happy path + one error path

Prioritize functions with ≥2 branches, ≥1 external dep, and ≥1 importer in the main code path. Smell: file has heavy coverage of trivial helpers and zero coverage of the load-bearing public function in the same file.

### B. Retry / fallback catch blocks — one test per non-trivial catch

Source has a `try/catch` / `try/except` / error-returning branch where the handler has real logic (not just `log(e)`) and no test ever throws to reach it.

### C. Concurrency / locking branches — one contention test

Source has a module-level map, mutex, `isRunning` flag, or similar, and all tests call the function once. Add a test that fires two overlapping calls and asserts serialization. **Skip if the contention is architecturally closed upstream.**

### D. Cap / limit boundary values — one test at `cap - 1` and `cap + 1`

grep for constants named `MAX_*` / `LIMIT_*` / `MAX_SIZE` / etc. in the source. Flag if the exact gate value is never fed as a test input. **Skip timing-dependent caps** (timeout, AbortError, deadline) — unit tests are flaky against them.

## Execution

### Pass 1 — discovery (parallel subagents)

Spawn 2–4 subagents in parallel, each covering a disjoint slice of test files. Each agent prompt includes:

- Exact test file list for that slice
- Instruction to **read the module under test first** — without the source, every test looks reasonable
- The Delete/collapse rules 1–10 verbatim, with `(c)` clauses
- The Keep-as-is signals verbatim
- The Add-coverage rules A–D
- **Required output format per finding:**
  `Test: <test(...) string>. File: <path:line>. Rule: <# or keep-signal #>. Mutation: <one-line concrete code change>.`
  For deletes/collapses: the mutation must be one the test currently *fails* to catch. For keeps/adds: the mutation is one the test *does* or *would* catch. If the only mutation you can name is "delete the whole function", drop the finding — that's removal, not a mutation.
- **Output discipline:**
  - Emit only the required finding lines, grouped under the bucket headers (`delete | collapse | loosen | weak | missing | keep`). No preamble, no trailing summary table, no narrative.
  - **Each test appears in at most one bucket.** Tie goes to keep. Never emit the same test twice across buckets.
  - Silence means keep-as-is applies — do NOT list every keep.
  - **Hard cap: at most ~5 entries in `keep`** per slice. List a test under `keep` only if it was a plausible rule-1-through-10 candidate you *decided* to keep (cite the keep-signal #).
- **Mutation concreteness.** The mutation must be a single concrete code edit a skeptic could re-verify by reading the source. Required: name the exact identifier and the exact change — "flip `>=` to `>` at fetcher.ts:14", "return `null` instead of `undefined` from parseFrontmatter's empty branch". If the only mutation you can name amounts to removing the function or deleting the loop body, drop the finding.
- Line numbers point at the test line, not the enclosing `describe(...)` / class.
- Before flagging rule 6, classify each mocked target as *seam* (resolves to repo source) or *boundary* (resolves to vendored deps or stdlib). Only flag if ≥2 are seams.
- Before flagging rule 7, run `git grep "<dependency>" <source-dirs>` to check production usage. **Quote the grep hit count** so Pass 2 can audit the gate.

Each agent returns: per file, `delete | collapse | weak | missing | keep` buckets with specific test names and mutation rationale.

### Pass 2 — challenge

Spawn **two skeptic subagents in parallel**, split by input type. Combining jobs produces bias-mixing: the observed failure mode is rubber-stamping adds while engaging only deletes (or vice versa).

**Skeptic A — delete/collapse/loosen/weak.** Input: the union of Pass 1 findings in buckets `delete | collapse | loosen | weak`. Apply guardrails #1–7 verbatim. Do NOT emit verdicts on `missing` entries.

**Skeptic B — adds.** Input: Pass 1 `missing` bucket only. Apply guardrails #8–13 verbatim with the ≥50% reject floor (when ≥6 adds). Do NOT emit verdicts on delete/collapse/loosen/weak. Each REJECT must cite which of #8–13 it invoked.

Both skeptics share the same prompt preamble:

> "Push back on any recommendation that: (A) loses real signal when collapsed, (B) misapplies the tautological label to a regression-pinned test, (C) recommends coverage that wouldn't earn its keep, (D) shrinks the suite at cost of readability, (E) misses bigger bloat the reviewers overlooked.
>
> **Calibration guardrails:**
> 1. Pass 1 has already applied every `(c)` escape clause verbatim. Do not re-apply escape clauses — only flag where Pass 1 *misapplied* one (and say which).
> 2. Focus on **mutation concreteness**: is the named mutation a real single-identifier edit, or hand-waved?
> 3. If the only mutation a test catches is 'delete the whole function' or 'delete the loop body', the test MUST be dropped — do not rescue as a 'weak keep'.
> 4. Do not emit self-contradicting verdicts. One verdict per finding: CONFIRM | REJECT | AMEND.
> 5. A 70%+ reject rate is a signal of defensive-keep bias, not rigor. If rejecting >half, re-check each for rule 3.
> 6. **AMEND is downward-only** — re-bucket keep→weak→delete or loosen→collapse→delete, never reverse. Upward rescues (delete/weak/collapse → keep) must be emitted as REJECT, and the reject reason must quote the specific keep-signal # or rule-(c) clause Pass 1 misapplied.
> 7. **AMEND cap: at most ~10% of findings.** Each AMEND must state the new mutation the re-bucketed test catches.
>
> **Add-bloat guardrails (apply to `missing` / Rule A–D findings):**
> 8. **Indirect-coverage check.** REJECT an Add if an existing sibling test's assertions would fail under the named mutation at the same boundary comparison or branch.
> 9. **Harness cost gate.** REJECT if the add requires substantial new scaffolding *and* the named mutation is low-probability *and low blast-radius*. Carve-out: observability, data-integrity, and ordering-contract catches are high-blast-radius even when low-probability.
> 10. **Phantom-branch check.** Read the source at the cited line and walk the actual call path. REJECT only if the branch is unreachable even after the test's setup.
> 11. **Sibling-redundancy.** If two adds target different branches inside the same function, REJECT the second unless the branches require *contradictory* fixture shapes that one test cannot carry.
> 12. **Rule A exclusion.** REJECT a Rule-A add whose only named mutation is 'delete the function' — those are removals. Operator flips, constant changes, boolean inversions are NOT removals.
> 13. **Mock-depth gate.** REJECT any Add whose setup would mock both a wrapper and the wrapper's own downstream seam. Assertions against a fully-mocked chain are mutation-blind."

**Tally discipline:** Skeptic A: **20–40% reject** typical. Skeptic B: **≥50% reject on adds when ≥6 adds**. Below 6 adds, per-finding judgment. Each Skeptic-B REJECT must cite a specific guardrail # (#8–13). Outside Skeptic A's 10–50% band warrants attention.

**Coherence reconciler.** After both skeptics return, check: for each surviving Add, does it propose covering a branch that a surviving Delete just orphaned? If yes, drop the Add — you can't simultaneously say "this test is worthless" and "we need a new test for this branch." Skip if either bucket returned zero survivors.

### Pass 3 — acceptance-test audit

Spawn **one audit subagent** over the skeptic-adjusted list. For each surviving finding, read the test and the production source, then decide whether the Pass-1 named mutation is (i) a concrete single-identifier edit to **production code**, and (ii) genuinely uncaught (for deletes/collapses/loosens/weak) or genuinely caught (for adds) by the test as written. Verdicts:

- `VERIFIED`
- `DROP (only-mutation-is-removal)` — apply ONLY when the Pass-1 mutation field literally reduces to "delete the function", "delete the loop body", or "remove the file". A rename, constant flip, operator swap, argument reorder, or identifier change is NEVER this verdict, **even for delete-bucket findings**.
- `DROP (mutation unverifiable from source)` — the named identifier or line doesn't exist in the source, or the claimed branch isn't reachable.

No new findings. Expected DROP rate: <15%.

### Synthesize

Present the skeptic-adjusted list, grouped:

- **Collapse** — parametric table candidates that survived challenge
- **Delete** — clear bloat (mock-echo, template-echo, unreachable guards)
- **Loosen** — over-specified assertions to soften, not delete
- **Add** — coverage gaps tied to rule A–D
- **Rejected** — findings the skeptic killed, with one-line reason
- **Deferred** — deep bloat needing a shared harness refactor (surface, don't tackle inline)

### Ask for approval

Present the list. Do NOT edit. Wait for "collapse 1-3", "delete all", "add A+B skip C", or similar. Apply only what's approved.

## Anti-patterns

- **Don't delete without naming the mutation.**
- **Don't add coverage without pointing at a specific branch.**
- **Don't collapse parallel one-liners whose failure messages carry distinct debugging value.** See rule 5(c).
- **Don't batch test deletions with production-code changes.** Separate commit — later bisect can distinguish "behavior changed" from "guard test removed."
- **Don't skip Pass 2 or Pass 3.** Both failure modes (trigger-happiness and defensive-keep) are observed.
- **Don't grow the rule list.** New patterns → new examples under existing rules.
