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

- **Quality gate (main review loop)**: Plan-Review or Diff-Review evidence
  for the current plan hash/revision before any plan presentation. Full
  reviews use the review-fix-verify loop; diff reviews use the scoped flow in
  `plan-review.md`.

- **Safety gate (pre-creation gate)**: Final gate before CLI creates seeds.
  `plan-review.md` owns the scripted mechanical check, review-state/manifest
  freshness rules, dirty-bit skip, and accept/reject-only user gate.

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

- **Full review since last mutation**: True only after a full
  review-fix-verify loop exits clean for the current plan hash/revision. A
  diff review can make the current revision presentation-ready, but it does not
  set this flag.

- **Residual risk**: Unfixed findings that remain after the review-fix-verify
  cap (3 passes) or fix sub-cap (2 attempts) is hit. Record specific finding
  details in plan artifacts and review state; stale or unrecorded risk cannot
  satisfy presentation readiness.

## User touchpoints

- **Plan presentation**: Reviewed plan presentation backed by current
  Plan-Review or Diff-Review evidence. User can accept, adjust (triggers diff
  review), or reject (new research round).

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
