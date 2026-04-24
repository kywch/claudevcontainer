---
name: quint-loop
description: Reverse-spec an existing bug-prone module OR design a new concurrent feature with Quint. Find counter-examples, lock fixes with replay tests, optionally harden with stateful property-based tests. Use when a module has concurrent state mutation, crash/reload invariants, or budget/dedup logic that plain unit tests can't cover.
---

# quint-loop

Use Quint (TLA+-style executable spec language) in one of two flows:

- **Reverse-spec** — you have existing code and suspect an interleaving bug. Spec it, find a counter-example, lock the fix with a replay test.
- **Spec-first** — you're building a new concurrent feature. Pin invariants in Quint before writing code; the spec becomes the design doc.

Ship a replay test so the regression stays caught. Language-agnostic — works for TypeScript, Python, Go, anything.

## 0. Install preflight

Quint is preinstalled in this devcontainer. Verify:

```bash
quint --version
```

If missing elsewhere: `bun install -g @informalsystems/quint` or `npm install -g @informalsystems/quint`.

## Quint syntax cheatsheet

- `var x: int` — mutable state var. Every action must assign `x'` (next-state) for every var.
- `val y = expr` — pure derived value. Invariants are `val`s returning `bool`.
- `action f = all { x' = 1, y' = y }` — conjunction. All clauses must hold; unchanged vars still need `y' = y`.
- `action f = any { a, b }` — disjunction. Simulator picks one non-deterministically.
- `nondet i = S.oneOf()` — existential over set `S`; must be followed by an action using `i`.
- `action step = ...` — the top-level transition. Must be named `step`.
- Annotate `: bool` on any action returning bool.
- Maps: `var m: int -> Set[int]`. Literal `Map(1 -> Set(), 2 -> Set())`. `m.put(k, v)` returns a new map (no mutation). `m.get(k)` **requires k present** — init every key you'll access in `init`, no default-value semantics.

## Debugging `quint run`

When the simulator refuses to cooperate:

- **Typecheck error "unbound variable"** — an action didn't assign every primed var. Add `x' = x` for no-op branches.
- **"No enabled actions" / deadlock** — every branch's guard is false. Add a permissive no-op branch or weaken a precondition.
- **Invariant holds on the neg (should have violated)** — the invariant is on an internal flag, not an observable. Rewrite it to name the externally visible bad state.
- **Invariant fails on the canonical (should have held)** — action missing a precondition that the fix enforces; add it. Don't weaken the invariant.
- **Trace ends with all actors in terminal states** — add a precondition that lets a terminal actor be re-used, or shrink actor set.

## Finding a target

Have a suspect (flaky test, incident, "sometimes" bug)? Skip to reverse-spec. No suspect? Grep for these hazard shapes — the inverse of the skip gate:

- Shared mutable state touched by ≥2 async entry points (parallel handlers, retry + cron, reader + writer).
- Budget / counter / set that must stay monotone across concurrent calls.
- Persistence where crash-mid-write could leave partial state.
- Dedup / merge on IDs from multiple sources.
- Locks, reservations, or check-then-act on shared resources.

Nothing in ~15 min → ship unit tests. For broad scans, dispatch a subagent with the prompt in [references/candidates-prompt.md](references/candidates-prompt.md).

## Skip Quint when

Exit if any fires — Quint is targeted, not whole-app verification.

- Pure function, no state machine → property tests (fast-check for TS, Hypothesis for Python). Quint adds nothing here.
- Invariant expressible as a type → type checker / schema validation.
- External I/O dominates (Slack, LLM output, wall-clock, partitions) — modeling these is fiction.
- Unbounded strings / floats / real-valued time drive the invariant.
- LLM decisions are load-bearing.
- Spec would be longer than the code it shadows — wrong abstraction layer.
- An existing canonical already pins the same state machine and invariant on a sister symbol — ship the code fix + Layer-2 test and cite the existing spec in a `// spec:` comment.
- Second spec attempt can't reproduce a known bug — fall back to unit tests with fake timers.
- The bug needs 1 actor and 0 shared cells (pure sequential logic) — a human reads faster. Distinct actor *kinds* racing on shared cells still qualify; count distinct kinds × shared cells, not instance headcount.

Note: for stateful code, PBT complements Quint (see Layer 1b below); it is not a substitute for exhaustive simulation.

---

## Reverse-spec flow — existing module with a suspected bug

**The spec is an abstraction, not a translation.** Extract state vars, actions, and the observable bad state from the code; model only that. Skip async plumbing, error types, logging.

**Size calibration:** canonical + neg together ≤ 2× the LoC of the shadowed symbol(s). Over? Audit which state vars the *canonical* actually reads — vars only the neg uses mean the two should differ in shape (e.g., per-op snapshots on the neg, fresh-read on the canonical), not a shared skeleton with a toggled precondition.

**Field-level realism.** Write the invariant on paper before choosing types. Every `==` or projection inside it pins a modeled coordinate. Dedup over `(file, line, quote)` as `Set[int]` is vacuous — `Set` dedups and the neg can't reach a collision. Counter-style `|S| ≤ N` stays opaque; element identity doesn't matter. When the predicate projects, the state is records, not ints.

1. **Pick one target, one state machine.** Name state variables, actions, invariants in prose before writing Quint. Multiple invariants share a spec iff they exercise the **same state vars and same actions** in the canonical — the minimum state machine that makes one falsifiable also makes the others falsifiable without adding vars or action variants. Run together with `--invariants a b c`.

   **Sibling-structure audit.** Grep the shadowed symbol for *all* shared mutable structures — counters, sets, maps, reservation tables. Each one is either modeled in the spec with its own actions, or explicitly scoped out in the header paragraph. A sibling structure silently omitted is the most common spec-rot vector: a future refactor can reintroduce the bug in the un-shadowed sibling and no spec will catch it.

   **Granularity check.** If the real code serializes per-key (per-key promise map, per-session lock, per-thread queue), the spec's serialization primitive must mirror the key shape. A global `idle` gate where real code uses a per-key queue correctly models the single-key scenario but silently over-serializes every cross-key race — those interleavings are structurally unreachable in the model.

2. **Review the sketch.** Run the [invariant-completeness review](#invariant-completeness-review) against the prose sketch — required. Scenario-simulation review optional but recommended on first spec in a new domain. Record the outcome as `// REVIEW: invariant-completeness PASS` (or `gaps addressed: <list>`) in the canonical's header block.

3. **Write the negative control first: `specs/<name>.neg.qnt`.** Deliberately wrong — remove the reservation, break monotonicity, drop the lock. The invariant must name the **observable bad state** (double-spend, lost update, non-monotone counter), not an internal flag. Include the header block (see §Header block).

4. **Produce the counter-example:**

   ```bash
   quint typecheck specs/<name>.neg.qnt
   quint run specs/<name>.neg.qnt \
     --backend=typescript \
     --invariant=<invName> \
     --out-itf=specs/<name>.itf.json \
     --max-samples=500 --max-steps=15
   ```

   Must produce a violation in <1s. **If it holds, the invariant is vacuous** — rewrite it to name the observable bad state. Two failed attempts *at the same framing* ⇒ fall back to unit tests; reframing (different observable, different state vars) resets the count.

5. **Write the canonical `specs/<name>.qnt`** — same state vars, actions reflect the correct pattern (reserve-at-gate, atomic mutation, crash-safe persistence). Include the header block.

6. **Confirm the canonical holds:**

   ```bash
   quint run specs/<name>.qnt --backend=typescript \
     --invariants <inv1> <inv2> \
     --max-samples=2000 --max-steps=20
   ```

   Single invariant: `--invariant=<name>`. Multiple: `--invariants a b c` (no `=`). If the canonical fails, shrink to isolate or add a missing precondition — don't weaken the invariant.

7. **Layer 2 (primary) — real-code test alongside the module's unit tests.** Forces the race on the actual closure, mocking only external I/O. This is the shipping bug-catcher — the one that will fail on HEAD before the fix and pass after. Two shapes:

   - **Interleaving** — mock the external dep to return promises/futures *you* resolve. Launch N parallel calls. Yield until all reach their first await/suspension point. Resolve in the order that exposes the race. Assert observable behavior.
     - TS: `vi.mock` / manual promise resolvers
     - Python: `unittest.mock` / `asyncio` events / `monkeypatch`
     - Go: `httptest` + channels
   - **Crash simulation** — mock the fs primitive to truncate-then-throw, mimicking a pre-flush crash. Assert the next loader call returns the prior committed payload.
     - TS: `vi.mock('node:fs/promises', ...)`
     - Python: `monkeypatch.setattr('os.write', ...)` or `mock.patch('builtins.open', ...)`
     - Go: interface-injected fs

8. **Layer 1 (regression pin) — replay test alongside your other tests.** Parse the ITF, derive the action sequence from state diffs, replay against:

   - A minimal **buggy** class (<30 LoC). Must assert the bad state explicitly.
   - A minimal **fixed** class (<30 LoC). Must survive the same sequence.

   See the working examples in [references/examples/](references/examples/) — both TS (vitest) and Python (pytest) replay test idioms. Replay tests live under your test root in a `specs/` subdir; pick the convention that matches your runner.

   Cheap insurance: Layer 2 can break silently when a refactor changes the mocking boundary; Layer 1 pins the invariant ↔ shape mapping. Layer 1 does **not** prove the real code matches either shape — that is Layer 2's job.

   If Layer 2 is genuinely infeasible (e.g., concurrency across a subprocess boundary), document in the spec header and rely on Layer 1 alone — last resort, not shortcut.

   **Layer 1b (optional) — stateful PBT over the same mirror classes.** When the bug-shape has many equivalent triggers (the ITF pins one, dozens work), add a fast-check `fc.commands` / Hypothesis `RuleBasedStateMachine` test over the buggy + fixed classes. Same assertions, broader search. See [references/pbt-integration.md](references/pbt-integration.md) for the idiom; skip when the bug is a single surgical race.

9. **Run both before fixing.** Layer 2 must fail against real unfixed code. If it passes on unfixed code, the test doesn't force the race — fix the test first. Layer 1 fails on the buggy class by construction.

   **Retroactive spec (fix already landed):** locally revert the fix (`git revert <sha> -- <file>` if the fix commit is known; otherwise inline the guarded body by hand), run Layer 2, confirm red on the specific invariant the spec names, restore, confirm green. Record the revert command as a comment block at the top of the Layer 2 file.

10. **Fix the code** using the counter-example as a guide. Update `SHADOWS` if the symbol renamed; bump `LAST-SYNCED`.

11. **Semantic review.** Dispatch a subagent with the prompt in [references/review-prompt.md](references/review-prompt.md) — two-pass (adversarial reviewer + per-claim verifier). Complements any mechanical audit (header schema, LAST-SYNCED drift) you might have. [BLOCKER] findings must be fixed or explicitly scoped-out in the header before commit; [CONCERN]/[NIT] advisory.

12. **Run the full test suite.** All layers green. Commit all artifacts in one logical commit.

13. **Briefing.** Before closing the PR, summarize in 3 lines — goes in the PR body or commit trailer:

    - **Closed:** the observable bad state and how the fix eliminates it.
    - **Residual:** invariant classes the spec deliberately did not model.
    - **Adjacent easy wins:** one-line fixes the concurrency map exposed — unawaited promises, swallowed errors on the same boundary, missing locks on sibling files. These are often the highest-leverage output of a Quint pass.

---

## Spec-first flow — new feature, no code yet

Use when building a feature with non-obvious correctness: new budget counter, dedup/merge, persistence invariant, new-actor coordination. Plumbing + LLM call = overkill; skip.

Spec-first commonly collapses into reverse-spec once you start writing code — the real state variables become obvious and the spec gets rewritten. That's healthy, not failure. If the code is recognizable enough that you're reverse-engineering rather than designing, switch flows.

1. **Sketch in prose** — state, actions, invariants. 5-10 lines.
2. **Draft `specs/<name>.qnt`.** This *is* the design doc now. Include the header block.
3. **Run both review passes** (invariant-completeness + scenario-simulation) — required here; no code backstop.
4. **Write `<name>.neg.qnt` immediately.** Remove the guard you plan to implement. Confirm violation. This proves the invariant has teeth before any code exists.
5. **Run the canonical; confirm it holds.** If not, fix the design here, not in code.
6. **Implement the code.** Canonical actions map to functions. Cite in comments (`// spec: specs/<name>.qnt :: reserve` or `# spec: ...`).
7. **Write the replay test** from the neg's ITF — acceptance criteria. Optionally add Layer 1b PBT.
8. **Commit all artifacts together.**

Key difference: the spec is a living design artifact — change it first, then the code. The replay flags drift.

---

## Review subagents (before running the simulator)

Invariant-completeness is required in both flows. Scenario-simulation is optional for reverse-spec, required for spec-first.

### Invariant-completeness review

Dispatch a subagent with read-only access to `specs/<name>.qnt` and the prose sketch. It must NOT read any code file, `.neg.qnt`, `.itf.json`, or test file — its job is to find gaps by reading the canonical alone.

Ask it to report gaps in four categories:

- **unstated-observable** — properties about externally visible state (counts, IDs, sets) not asserted as `val ... : bool`.
- **partial-guard** — action preconditions that allow bad states to enter the transition.
- **missing-nondeterminism** — actions lacking a failure/abort variant (succeed without rollback, retry without timeout).
- **boundary-gap** — behaviors at empty sets, single actor, saturated resource that are unconstrained.

For each gap: quote the spec text where the invariant should appear; name the observable bad state that could arise. Each gap → new invariant, tightened guard, or explicit "out of scope" note in the header.

### Scenario-simulation review

Dispatch a subagent to mentally execute the spec through 6 scenarios (no simulator), reporting stuck points. A stuck point is "spec doesn't say X" — not "I wish X were true". Clean happy paths are a fine result.

Scenarios:
1. Happy path with mid-action failure.
2. Concurrent calls on shared state.
3. External state flip mid-action (callback, cron, crash).
4. Boundary (empty, single-actor, saturated).
5. Observer reading state mid-transition.
6. Lifecycle (first action post-init, during shutdown, post-crash/reload).

Per scenario: initial state, step-by-step trace, stuck point (one line), affected state vars, candidate invariant or action (optional).

---

## Header block (required on every `.qnt`)

```
// SPEC: <name> (role: canonical | negative-control)
// SHADOWS: <repo-relative path> :: <symbol>   // symbol, never line number
// INVARIANTS: <inv1>, <inv2>
// REPLAY: <test-root>/specs/<name>.replay.test.<ts|py>
// NEG-CONTROL: specs/<name>.neg.qnt            // canonical only
// LAST-SYNCED: <short sha> <YYYY-MM-DD>        // sha reachable from HEAD, touches this .qnt or SHADOWS
// REVIEW: invariant-completeness <PASS | gaps addressed: ...>   // canonical only
//
// <One paragraph: what this models, what drift would break the invariant,
// why future readers should trust this is still load-bearing. Reference the
// shadowed symbol by name; do not paste the code body into this comment — it
// rots the instant the source is refactored.>
```

---

## Placement

- All specs in `specs/` at repo root, flat. `<name>.qnt` canonical, `<name>.neg.qnt` negative control (do not delete; extend in place), `<name>.itf.json` is a fixture (regenerate + commit on neg edit); replay reads action *shape* from state diffs, not bytes.
- Replay tests under your test root in a `specs/` subdir, matching your runner's glob:
  - TS + vitest/jest: `tests/specs/<name>.replay.test.ts`
  - Python + pytest: `tests/specs/test_<name>_replay.py`
  - Go: `specs/<name>_replay_test.go`
- Every new canonical adds a row to `specs/README.md`'s "Current specs" table — spec, shadowed symbol, status. The table is the registry a new reader reaches first.
- After generating `<name>.itf.json`, check the `#meta.source` field matches the file you ran (`specs/<name>.neg.qnt` for single-invariant; `specs/<name>.neg.<invName>.qnt` for multi).
- **Multi-invariant canonical:** when a canonical runs `--invariants a b c`, pin one neg per invariant as `<name>.neg.<invName>.qnt` with mirrored `<name>.itf.<invName>.json`. Each neg breaks exactly one guard and violates exactly one invariant.
- On any PR touching a file cited by `SHADOWS`, bump `LAST-SYNCED` in the same commit or justify in the PR description.

## Tooling

- `--backend=typescript` default. The Rust evaluator is faster but needs glibc ≥ 2.39.
- Reserved names: `fail`, `init`. Use `rollback`, `setup`.
- `quint verify` (Apalache) is exhaustive but JVM-heavy — only for liveness the simulator can't crack.
- Consider a project-specific mechanical-lint script (header schema, `LAST-SYNCED` reachability, path resolution, ITF `#meta.source`, pure-stutter action detection). The semantic review above catches things the mechanical audit can't — sibling-structure omission, granularity mismatch, aspirational prose.

---

## Anti-patterns

- **Canonical before negative control** — green means nothing without a demonstrated failing case.
- **Line-number citations in `SHADOWS`** — use the symbol.
- **Replay class that doesn't mirror real code** — align the shape or the replay proves nothing.
- **Replay that silently no-ops** — assert the bad state explicitly on the buggy case.
- **Spec + replay without the code fix** — bug proven, nothing shipped.
- **Layer 1 only** — it tests a hand-written mirror, not the real code. Layer 2 is the shipping bug-catcher.
- **Layer 2 that doesn't force the race** — must fail against pre-fix code. Passing on unfixed code means the test isn't hitting the interleaving.
- **Skipping the briefing** — adjacent one-liners from the concurrency map are often the highest-leverage output; ship them in the same PR.
- **Unbounded actors / resources** — start small (3 actors, `BUDGET=1` is usually enough to exhibit a race).
- **`.neg.qnt` diverging from canonical** — update both in the same commit, or mark the neg frozen with a dated comment.
- **Orphan spec** — if `SHADOWS` target is gone, delete the `.qnt`.
- **Source-quoting in spec headers** — don't paste the shadowed function body; reference by `SHADOWS: <path> :: <symbol>`.
- **Opaque-id invariant on a content predicate** — **Vacuity check:** replace the invariant body with `true` and re-run the neg. Same outcome ⇒ no teeth — promote ids to records whose fields are exactly what the predicate reads.
- **Invariant guarded by the action set, not the model checker** — `diskKind == "empty" or diskKind == "valid"` when no canonical action can ever set `"torn"`. **Reachability check:** for each invariant naming a forbidden value `v`, grep every canonical action body for any assignment that could produce `v`. If none, the invariant is documentation — either delete it, or add an action whose precondition is what keeps `v` out of reach.
- **Pure-stutter action** — an action whose body is `all { x' = x, y' = y, ... }` for every variable. Adds nothing. Delete pure-stutter actions.
- **Aspirational header prose** — header describes what the code *should* do rather than what the spec *models*. Describe only the spec's state machine and which code drift would break the invariant.
- **Single neg covering multi-invariant canonical** — when one broken guard trips three invariants, you can't tell which bug-shape is pinned. Pin one neg per invariant.
- **Spec review that rubber-stamps the author** — verify claims against ground truth: open the `SHADOWS` symbol and compare to the spec's state vars; grep every action body for the invariant's forbidden values. A review without file:line citations is not a review.
- **PBT replacing Quint for stateful code** — PBT is non-exhaustive, misses deadlocks, and shrinks to the wrong counter-examples without the state-machine scaffolding Quint forces you to write. Use PBT as Layer 1b, not Layer 0.

---

## Examples

Two worked examples live in [references/examples/](references/examples/) — each is a self-contained `.qnt` canonical + negative control + ITF counter-example + replay tests in both TS and Python. Drop them into any repo as a starting point.

- **[budget-race](references/examples/budget-race/)** — concurrent reservation on a shared counter. Teaches reserve-at-gate, ITF replay, PBT stateful test.
- **[crash-durability](references/examples/crash-durability/)** — atomic tmp+rename vs torn-write. Teaches persistence invariants, `vi.mock`/`monkeypatch` Layer 2.

See [references/pbt-integration.md](references/pbt-integration.md) for Layer 1b — stateful PBT over the mirror classes with fast-check and Hypothesis.
