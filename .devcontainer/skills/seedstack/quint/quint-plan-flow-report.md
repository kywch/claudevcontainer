# Plan Flow Quint Report

## Model

- Canonical: `skills/seedstack/quint/plan_flow.qnt`
- Negative control 1: `skills/seedstack/quint/plan_flow.neg.qnt`
- Negative control 2: `skills/seedstack/quint/plan_flow_no_review.neg.qnt`
- Counterexample trace: `skills/seedstack/quint/plan_flow.neg.itf.json`

## What is modeled

The full project/program planning lifecycle: classify → mini-alignment →
research → draft → assumption check → review-fix-verify loop → present →
user reacts → (adjust with diff review | reject with new research) →
pre-creation gate → create seeds.

single-fix/slice omitted (trivial, no review loop).

## State variables

- `phase`: current step in the flow (19 phases)
- `planSize`: Project (adjustment cap 1) or Program (cap 2)
- `dirtyBit`: true when plan changed since last full review exit
- `reviewPassCount`: passes in current review-fix-verify loop (cap 3)
- `fixAttemptCount`: fix attempts in current pass (cap 2)
- `adjustmentCount`: user adjustment rounds used
- `fullReviewSinceLastMutation`: true after full review runs (even cap-hit)
- `mechanicalChecksPassed`: true only after scripted pre-creation checks pass
- `creationRequested`, `justGo`: configuration flags

## Invariants

- `noCreationWithoutReview`: CreateSeeds implies fullReviewSinceLastMutation
- `reviewPassCapRespected`: reviewPassCount ≤ 3
- `fixAttemptCapRespected`: fixAttemptCount ≤ 2
- `adjustmentCapRespected`: adjustmentCount ≤ adjustmentCap
- `creationDirtyOnlyWithReview`: CreateSeeds with dirtyBit implies
  fullReviewSinceLastMutation (residual risk is allowed, but only if
  review ran)
- `justGoStillReviewed`: justGo ∧ CreateSeeds implies
  fullReviewSinceLastMutation
- `noCreationWithoutMechanicalChecks`: CreateSeeds implies scripted
  pre-creation checks passed

## Results

- `quint typecheck plan_flow.qnt`: pass
- `quint typecheck plan_flow.neg.qnt`: pass
- `quint typecheck plan_flow_no_review.neg.qnt`: pass
- `quint run plan_flow.neg.qnt --backend=typescript --invariant=noCreationWithoutReview --max-samples=5000 --max-steps=30 --out-itf=plan_flow.neg.itf.json`:
  **expected violation found** — dirty accept skips pre-creation gate,
  reaches CreateSeeds with fullReviewSinceLastMutation=false
- `quint run plan_flow_no_review.neg.qnt --backend=typescript --invariant=noCreationWithoutReview --max-samples=5000 --max-steps=30`:
  **no violation** — pre-creation gate catches the gap even without main
  review loop (see Finding 2 below)
- `quint run plan_flow.qnt --backend=typescript --invariant=allInvariants --max-samples=5000 --max-steps=80`:
  pass after adding the mechanical-check invariant (no violation in sampled
  traces)
- `quint run plan_flow.qnt --backend=typescript --invariant=noCreationWithoutReview --max-samples=20000 --max-steps=80`:
  pass
- `quint verify plan_flow.qnt --invariant=allInvariants`: blocked,
  `java: not found` (Apalache requires Java)

## Findings

### Finding 1: Pre-creation gate is the load-bearing safety mechanism

Negative control 1 proved: removing the pre-creation gate allows unreviewed
plans to reach creation. The pre-creation gate is the single point of safety.

### Finding 2: Main review loop is NOT independently load-bearing

Negative control 2 proved: removing the main review loop does NOT violate
`noCreationWithoutReview`. The pre-creation gate catches every path. The
main review loop's value is quality (catching issues early, cheaper to fix
during drafting) not safety (preventing unreviewed creation). This is a
design property, not a bug — defense in depth means the pre-creation gate
is the safety net, and the main loop is the quality net.

### Finding 3: Dirty bit and residual risk

The original `creationImpliesClean` invariant (CreateSeeds implies
not(dirtyBit)) was too strict. When the review-fix-verify loop hits cap 3
with unfixed findings, those become residual risk — the plan proceeds with
dirtyBit=true. The real safety property is `noCreationWithoutReview` (full
review ran), not that all findings were fixed. Replaced with
`creationDirtyOnlyWithReview`.

### What subagent review found and the model addressed

- `stepReviewLoopCapHit` incorrectly cleared dirtyBit (should preserve it
  when findings are unfixed). Fixed: dirtyBit stays true on cap hit.
- `stepPreCreationRejectInteractive` blocked on `justGo` (pre-creation
  reject should work regardless). Fixed: removed `not(justGo)` guard.
- No clean-exit path from review (forced every review through FixFindings
  even when no issues found). Fixed: added `stepReviewLoopClean` and
  `stepPreCreationReviewLoopClean`.
- Same three issues existed in pre-creation review loop. Fixed in parallel.

### What the model forced us to define

- Dirty-bit semantics: fixes during a review loop that exits clean do not
  set the dirty bit. Only user adjustments and planner revisions after user
  feedback set it. It clears when a full review-fix-verify loop exits clean.
  Cap-hit does NOT clear it.
- Diff review does not clear dirty bit — only full review does.
- Pre-creation reject routing works regardless of justGo mode.
- Residual risk is an acceptable state for creation — review ran, findings
  recorded, user accepted.
- Clean user acceptance and justGo creation still route through scripted
  mechanical checks; clean plans may skip only the extra pre-creation agent
  review, not the checker.

### Lesson

For single-actor state machines with interacting loops/caps, subagent
review is the bug-finding tool and Quint provides bounded assurance. The
main payoff of modeling was precision: every ambiguous "optionally" and
"if changed" became a concrete state transition, which fed back into better
prose specification. The negative controls proved which gates are
load-bearing (pre-creation) vs quality-only (main review loop) — a design
insight that prose review alone did not surface.

## Residual

Sampled execution only (not exhaustive model checking). Apalache requires
Java which is unavailable in this environment. Latest post-mechanical-check
run covered 5k sampled traces for `allInvariants`.

## Noncoverage And Next Models

This model is ground truth only for the project/program planning lifecycle
through seed creation. It does not cover single-fix/slice fast paths,
manage/run orchestration, dispatch close logic, CLI mutation correctness,
artifact nonemptiness, or concrete graph validity.

Highest-value next model: `manage_run_flow.qnt`.

- phases: `Init`, `ChooseNext`, `Dispatching`, `DispatchReturned`,
  `Managing`, `PersistRun`, `Stopped`
- state: pending dispatch, managed dispatch ids, open/ready counts, stop
  reason, iteration caps, dispatch attempts per seed
- invariants: no dispatch before prior manage reconciliation, terminal stop
  reasons are exclusive, run state persists after each iteration, manager only
  closes the current local-done seed
- negative controls: dispatch twice before manage, stop with two terminal
  reasons, skip `run.md`, manager closes a non-current or non-local-done seed

Second model: `plan_graph_creation.qnt`.

- state: work order ids, dependency edges, shared label, acceptance/gate flags,
  creation order
- invariants: no dangling deps, no cycles, no redundant transitive edges,
  every new seed has shared label, creation requires mechanical checks
- negative controls: duplicate temp id, dangling dep, placeholder gate, missing
  shared label, transitive duplicate edge reaches creation
