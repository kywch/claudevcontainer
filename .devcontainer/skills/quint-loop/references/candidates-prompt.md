# Candidates subagent prompt

Dispatch a `general-purpose` subagent with the prompt below to scan the repo for modules that would benefit from a Quint spec. Read-only: Glob, Grep, Read. After the subagent returns, surface the **full ranked list** to the user — one tight line per candidate (`path:symbol`, hazard shape, strongest invariant, rank). Do not drop runners-up; the user picks the target. Then ask which to start the reverse-spec flow on.

---

You are scanning this repository for modules that would benefit from a Quint formal spec. You have read-only tools (Glob, Grep, Read). Do NOT edit anything.

**Find modules matching these hazard shapes** (the inverse of the Quint skip gate):

1. Shared mutable state touched by ≥2 async entry points (parallel handlers, retry + cron, reader + writer).
2. Budget / counter / set that must stay monotone across concurrent calls.
3. Persistence layer where crash-mid-write could leave partial state.
4. Dedup / merge on IDs from multiple sources.
5. Locks, reservations, or check-then-act on shared resources.

**Exclude** (already match Quint's skip conditions):

- Pure functions with no state machine.
- Modules where external I/O timing dominates the behavior.
- Modules where LLM output drives the invariant.
- Anything already spec'd — check `specs/*.qnt` `SHADOWS:` lines and skip those symbols.

**Report top 3-5 candidates.** Per candidate, give:

- `path:symbol` — concrete function / class / module.
- **Hazard shape** — which of the 5 above it matches.
- **Suspected invariant(s)** — one line each, in observable terms (not internal flags). If multiple invariants look bundleable, list them and note whether they share the same state vars + actions (→ one spec, `--invariants a b c`) or force distinct state machines (→ separate passes).
- **Invariant projections** — for each invariant, which record fields does the predicate read? (`|S| ≤ N` → opaque ids fine; `x.file == y.file` → model the tuple.) This flags opaque-id vacuity before it burns a pass.
- **Why now** — recent churn, known flakiness, or structural reason it's suspect.
- **Spec sizing** — rough estimate: #state vars, #actions, #actors needed to exhibit a bug.

**Four failure modes to avoid** (past surveys hit all four):

1. **Name the observable bad state, not the guard.** Wrong: "gate checks {pool size, budget, clarifyGated}". Right: "`|findings| ≤ POOL_CAP` at every point." A guard's correctness is not the invariant — the post-state is. Restating the guard hides enforcement gaps.
2. **Don't canonize the buggy rule as the theorem.** If the invariant body is a paraphrase of the current code, the neg can't falsify it. The invariant must name a property the user cares about, not the algorithm.
3. **Locate enforcement, not just mentions.** For every `CAP`/`LIMIT`/`BUDGET`, identify both the check site *and* every write site. "Cap checked at entry" ≠ "cap holds after merge." Report the distance between them.
4. **Grep every call site before trusting a concurrency comment.** If source says "serialized upstream by X" or "single-writer by convention," list every caller of the symbol and state whether each path actually holds X. The comment is hypothesis; the grep is evidence.

**Bundling discipline:** `--invariants a b c` requires *literally the same action alphabet*. If invariant C needs a concurrent action that A and B never exercise, C is a separate pass.

Rank by (probability a bug exists) × (cost of that bug in prod) ÷ (spec effort). Flag any candidate you'd skip and why.

Keep the report under 600 words.

User input: $ARGUMENTS
