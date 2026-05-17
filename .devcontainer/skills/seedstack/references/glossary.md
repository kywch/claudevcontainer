# Seedstack Glossary

## Phases

- **Mini-alignment**: Brief upfront check before research. Asks at most
  three things: outcome, hard constraints, review-fix budget. Skipped for
  single-fix. Skipped by "just go."

- **Assumption check**: Lightweight presentation of marked assumptions
  before the review loop. Saves wasted review cycles when foundations are
  wrong. Accepts assumption tweaks; structural feedback (changes to outcome,
  scope, or DAG topology) treated as rejection → new draft. Skipped by
  "just go."

## Gates

- **Quality gate (main review loop)**: Review-fix-verify loop that runs on
  the initial draft. Catches issues early when they're cheap to fix. NOT
  load-bearing for safety — removing it does not allow unreviewed creation
  (safety gate catches the gap). Cap: 3 passes.

- **Safety gate (pre-creation gate)**: Full review-fix-verify loop that runs
  as the final gate before CLI creates seeds. Load-bearing — removing it
  allows unreviewed plans to reach creation (proven by Quint negative
  control). Includes scripted mechanical checks + agent review. Accept/reject
  only (no adjust). Cap: 3 passes. Dirty-bit skip can skip the agent review
  phase when plan unchanged since last clean full review; scripted mechanical
  checks always run before CLI creation.

## Review modes

- **Full review**: Multi-agent review with all lenses. Used for initial
  draft and safety gate. See `plan-review.md` for agent counts and lens
  assignments per plan size.

- **Diff review**: Single-agent review with diff lens. Used for user
  adjustments. Checks edge conservation, acceptance conservation, orphan
  detection. Escalates to full review on broad damage (3+ material findings
  or seeds outside touched set affected).

## Loop mechanics

- **Review-fix-verify loop**: Review agents find issues → planner fixes →
  fresh verify agent confirms fixes landed. One cycle = one pass. Cap: 3
  passes per loop instance. Cap resets on each new draft (after rejection
  or new research round).

- **Fix sub-cap**: Max 2 fix attempts per pass. After sub-cap, finding
  becomes residual risk for that pass.

- **Fresh verify agent**: A new agent spawn — never the same agent instance
  that found the original findings. Avoids confirmation bias. Scope:
  targeted (re-checks specific findings + seed cards/edges the fix touched),
  not a full lens re-run.

## State flags

- **Dirty bit**: True when plan has changed since last full review exited
  clean. Initial value for a new draft: true (drafts are born dirty).
  Sets on: user adjustments, planner revisions after user feedback. Clears
  on: full review-fix-verify loop exits clean — meaning either verify
  confirms all fixes landed, or review finds no issues. Does NOT clear on
  cap hit (unfixed findings remain). Diff review does not clear dirty bit.

- **Full review since last mutation**: True after any full review-fix-verify
  loop runs — including cap-hit with residual risk. A planner fix during
  the review loop does not reset this flag (it is set when the loop exits,
  not during). The core safety invariant: no creation without this flag set.

- **Residual risk**: Unfixed findings that remain after the review-fix-verify
  cap (3 passes) or fix sub-cap (2 attempts) is hit. Recorded in the plan
  artifact with specific finding details. Creation with residual risk is
  permitted because the full review has run — the dirty bit stays true as a
  consequence, but `fullReviewSinceLastMutation` is set.

## User touchpoints

- **Plan presentation**: Full plan presented after review loop. User can
  accept (clean or dirty), adjust (triggers diff review), or reject (new
  research round).

- **Pre-creation user gate**: Accept or reject only. No adjust — prevents
  unbounded loop. Reject routes back to plan presentation (user reacts).
  Works regardless of "just go" mode.

## Caps

- **Review pass cap**: 3 per loop instance. Resets on each new draft.
- **Fix sub-cap**: 2 attempts per pass.
- **Adjustment cap**: 1 for project, 2 for program. When exhausted, user
  can still accept or reject but cannot adjust further. Diff-review
  escalation to full review does not consume an additional adjustment
  (the adjustment that triggered the diff review already counted).
- **Rejection cap**: No cap — user can reject unboundedly (each rejection
  triggers new research + new draft).

## Escalation

- **Diff → full**: Diff review finding 3+ material findings or damage
  outside the touched seed set must escalate to full review. The adjustment
  that triggered the diff review already counted toward the adjustment cap;
  escalation does not consume an additional adjustment.

## Knowledge lifecycle

- **Knowledge log**: `.seeds/knowledge.jsonl`, an append-only JSONL store for
  reusable lessons. Only `capture-knowledge` may append to it.
- **Capture point**: required opportunity to run knowledge capture after clean
  seed close, escalation resolution, or run terminal `done`.
- **Capture state**: one of `recorded`, `none_qualified`, `store_missing`, or
  `skipped_user_waived`, recorded in artifacts so absence of new knowledge is
  distinguishable from skipped capture.

## Lenses

- **Skill compliance**: Sizing, edges, verification ownership, quality bar,
  decomposition rules, label usage, slug handling, seed-scoping readiness.
- **Source reality**: Module boundaries, LOC accuracy, edge accuracy (real
  code dependency), dependency realism.
- **Risk/scope**: Blind spots, deferred items, milestone coverage, hardening
  distribution.
- **Promotion safety**: Whether draft/spec behavior is separated from
  version bump, release, implementation parity, and hardening gates.
  Assigned to the risk/scope agent when plan contains promotion or release
  seeds.
- **Diff lens**: Edge conservation, acceptance conservation, orphan
  detection, LOC-band check, verification ownership shifts, target_gates
  drift, label consistency, dispatch_notes/source_refs staleness.
