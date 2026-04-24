# Review subagent prompts

Semantic review of a Quint spec artifact suite. Catches drift a mechanical audit (header schema, LAST-SYNCED staleness, ITF source) cannot see: sibling-structure omissions, granularity mismatches, invariant-by-action-set, aspirational header prose, invariant/neg pairing gaps.

When: after step 10 of the reverse-spec flow in SKILL.md (code fix landed), before the final test run.

Scope: one spec name at a time (`budget-race`, `session-persistence`, etc.). Review fatigue is real — don't default to "all specs."

Depth options (ask the user):
- `canonical-only` — checks 1–5 on `.qnt` (default when user says "go").
- `full suite` — all 7 checks including invariant/neg pairing + ITF symmetry.
- `audit-residuals` — only findings a mechanical audit can't see.

## Orchestration

Run Pass 1 and Pass 2 sequentially — Pass 2 consumes Pass 1's output. Then synthesize the reconciled list and present it to the user. Do NOT edit files. This is review-only.

If the project has a mechanical audit script, run it first (Pass 0) and paste the output into Pass 1's prompt so Pass 1 treats those items as resolved.

---

## Pass 1 — adversarial reviewer

Dispatch a `general-purpose` subagent with the prompt below. Wait for completion before Pass 2.

---

You are critically reviewing the Quint spec at `specs/<name>.qnt` + `specs/<name>.neg.qnt` + `specs/<name>.itf.json` against its shadowed symbol. Be blunt — strawman-friendly reviews are worthless.

Read-only: Glob, Grep, Read. Do NOT edit.

First, read:
1. `specs/<name>.qnt` — canonical.
2. `specs/<name>.neg.qnt` (plus any `specs/<name>.neg.<invName>.qnt`) — negative controls.
3. `specs/<name>.itf.json` (plus any `specs/<name>.itf.<invName>.json`) — committed counter-examples.
4. The `SHADOWS` target (path :: symbol from the canonical header). Read the whole file, not just the symbol — sibling structures live nearby.
5. `specs/README.md` if present — conventions.
6. The quint-loop skill's "Anti-patterns" section — the failure modes you apply below.

Skip any item a mechanical audit already flags — focus on semantic checks the audit tool can't see.

Then assess each check. For each, produce exactly one of `CLEAN — <reason>` or `[BLOCKER|CONCERN|NIT] <finding>` with file:line evidence. No preamble, no summary. If you can't produce evidence for a finding, drop it.

### Checks

1. **Sibling-structure audit.** In the file containing the SHADOWS symbol, enumerate every module-level / exported function that mutates the same shared resource (in-memory structure *or* disk path *or* external handle) as the shadowed symbol — not just data structures. Pay special attention to multi-step mutations (write+rename, delete-then-unlink, reserve-then-commit): atomicity bugs live there and don't look like "shared structures" in the usual sense. Each sibling must either (a) be modeled by the canonical's state vars / actions, or (b) explicitly scoped out in the header paragraph. Silent omission = future refactor reintroduces the bug in the un-shadowed sibling and no spec catches it.

2. **Granularity check.** If the real code serializes per-key (per-key promise map, per-thread queue, per-session lock), the spec's gate primitive must mirror the key shape. A global `idle` gate where real code uses per-key queuing makes every cross-key race structurally unreachable in the model. Report what real code keys by vs. what the spec serializes on.

3. **Invariant reachability.** For each invariant naming a forbidden value `v`, grep every *canonical* action body for any assignment producing `v`. If no canonical action can ever set `v`, the invariant is enforced by the action set, not the model checker — documentation, not verification. List the canonical actions you checked.

4. **Aspirational header prose.** Read the header paragraph. For every factual claim about the shadowed code, grep the real code to confirm. Flag claims that don't match current code — they rot fast and mislead future readers. Additionally: if the header justifies a modeling simplification by appealing to an *upstream* invariant ("X serializes same-key by convention", "the caller always awaits"), grep the named upstream module to confirm the invariant still holds. Upstream refactors silently invalidate downstream specs.

5. **Action-set completeness.** Does the canonical's `step` action's `any { ... }` list reference every action defined in the module? A defined-but-never-dispatched action is structurally unreachable. List any action that appears in the file but not in `step`. Default severity NIT; escalate to CONCERN or BLOCKER only when the un-dispatched action is named in an invariant or would otherwise be load-bearing.

6. **Invariant / neg pairing.** Every invariant in the canonical's `INVARIANTS:` line must be violated by *some* neg (single `.neg.qnt` or `.neg.<invName>.qnt` for multi-invariant). An invariant with no neg counter-example has no teeth — a weakening wouldn't be caught. List each invariant and the neg file (if any) that violates it.

7. **ITF symmetry.** If an invariant names a symmetric bug shape (A-clobbers-B and B-clobbers-A), does the committed ITF demonstrate both directions, or only one? Asymmetric coverage disguised as symmetric protection is a gap.

### Output format

One line per finding:

```
[SEVERITY] <claim>. File: specs/<name>.qnt:<line>. Evidence: <grep output, file:line, or ITF fragment>. Impact: <one line — what bug-shape slips through>.
```

Every finding MUST cite file:line or grep output. Pass 2 rejects uncited findings. Clean checks: one line, `CLEAN — <reason>`.

User input: $ARGUMENTS

---

## Pass 2 — per-claim verifier

After Pass 1 returns, dispatch a second `general-purpose` subagent with Pass 1's output verbatim as input. Wait for completion.

---

You are verifying an adversarial review of a Quint spec against ground truth. A review that rubber-stamps is worthless — find findings Pass 1 got wrong, overstated, or misread.

Read-only: Glob, Grep, Read.

For each Pass 1 finding (BLOCKER / CONCERN / NIT):
1. Open the files Pass 1 cited.
2. Verify the literal claim — does the line say what Pass 1 quoted? Does the grep return what Pass 1 reported?
3. Verdict: `CONFIRMED` | `OVERSTATED` | `WRONG` | `PARTIALLY CORRECT`.
4. Evidence: file:line reference supporting your verdict (≤ 2 sentences).

Additionally, a `MISSED:` section — anything Pass 1 didn't flag that a careful reader would. Same file:line discipline.

Hard rules:
- A verdict without file:line evidence is rejected.
- Do not soften verdicts to be kind. If Pass 1 misread the spec, say WRONG.
- Do not re-grade severity. Severity is Pass 1's call unless the finding is WRONG (which voids it entirely) or the finding is CONFIRMED but you believe Pass 1 under-called the impact (say `CONFIRMED — impact underscored: <reason>`).

Pass 1's findings to verify:

<PASS_1_OUTPUT>

---

## Synthesize

After Pass 2 returns, present a reconciled list to the user. Cap each severity bucket at 5 findings per spec (top-impact first); overflow goes into a collapsed `[Additional — advisory]` appendix. `[PATTERN]`, `[MISSED by Pass 1]`, and `[Pass 1 misreads]` are uncapped.

Group:

- **[PATTERN — N/M specs]** (multi-spec runs only; place above per-spec severities) — flag any finding category appearing in ≥2 specs.
- **[BLOCKER — confirmed]** — author must fix or justify before commit.
- **[CONCERN — confirmed]** — advisory.
- **[NIT — confirmed]** — advisory.
- **[Pass 1 misreads]** — findings Pass 2 rejected as WRONG or OVERSTATED. Show with Pass 2's reason.
- **[MISSED by Pass 1]** — things Pass 2 caught. Treat at least as CONCERN until the author classifies.

For each confirmed finding, tag one of (orthogonal to severity):

- **`[mechanical]`** — single-file edit, no semantic change (LAST-SYNCED bump, header prose, `step` dispatch list, registry row, ITF regen).
- **`[semantic]`** — canonical logic change (new state var, gate granularity, invariant rewrite, action removed/added, sibling modeled).
- **`[scope-changing]`** — requires new `.neg.<invName>.qnt` or fresh ITF to give an invariant teeth.

Authors walk `[mechanical]` first (they compose), then `[semantic]` (one canonical edit at a time, re-simulate invariants), then `[scope-changing]` last (each needs its own file + ITF).

Ask the author which findings to address. Do NOT auto-edit.

## Fix-phase handoff (when the author says "fix")

This is review-only, but the author often proceeds directly to fixes. When they do, restate:

1. Run the project's mechanical audit + the spec's replay test after *each* file edit, not batched.
2. Walk buckets in order: mechanical → semantic → scope-changing.
3. For `[scope-changing]` findings, prefer scoping-out in the canonical's header paragraph over modeling the sibling when the shadowed code is stable and the bug shape is already covered by a sibling spec. Modeling is strictly more work.
4. Confirm the bucket, not every finding — batch approval is fine once the author has picked the bucket.
