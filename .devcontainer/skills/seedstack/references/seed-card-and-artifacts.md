# Seed Card and Artifacts

## Seed Card

Each planned seed should include:

```yaml
temp_id: N1
seed_slug: plan-only-human-handle
title: concise imperative
labels: [net-slug, impl, storage]
priority: 0
blocked_by: [N0]
area: spec/io | impl/ts | storage | docs | ...
source_refs:
  - path:line or file
acceptance:
  - observable done condition
gates:
  - type: unit|integration|conformance|pbt|model|stutter|mutation|static|review|full
    command: exact command or review requirement
verification_owner:
  - why this seed owns local tests, PBT, model replay, raw stutter, or conformance
target_gates:
  - exact focused command, case, property, or replay
estimated_loc: 200-400
dispatch_notes:
  - read first, hard rules, likely files, risk
```

## Plan Artifact

Write `tmp/seedstack/<slug>/plan.md` with:

1. Ask summary.
2. `network_slug`, shared label, and slug caveats.
3. Assumptions and open decisions (mark unconfirmed alignment assumptions).
4. Source map.
5. Chosen chunking strategy and rationale for broad implementation, subsystem,
   or feature plans; otherwise state `not applicable`.
6. Implementation boundary sketch for broad implementation or subsystem plans;
   otherwise state `not applicable`.
7. Seed title summary, before detailed cards.
8. Creation order, before detailed cards.
9. Dependency graph as edges, before detailed cards.
10. LOC sizing summary (estimated per seed, merge/split candidates flagged),
   before detailed cards.
11. Seed details as YAML seed cards.
12. First dispatch recommendation.
13. Gates by phase.
14. Milestones and review-fix iteration budget.
15. Deferred/out-of-scope work.

Use these upfront summary formats before the detailed YAML cards:

````markdown
## Chunking Strategy

- chosen: thin layered foundation -> vertical behavior slices -> conformance
  verifier batches -> hardening/review
- rationale: keeps shared invariants stable while adding early runnable
  behavior.
- early smoke: N2 owns `init` + `create` smoke.

## Implementation Boundary Sketch

- CLI boundary: entry point, argument parsing, help, envelopes, and exit codes.
- Domain/model boundary: issue/config records, validation, and deterministic
  hooks.
- Storage boundary: discovery, config, JSONL, locks, atomic writes, and raw
  stutter helpers.
- Behavior boundary: lifecycle transitions, dependency graph, readiness, and
  ready selection helpers.
- Command boundary: thin command handlers over tested helpers.
- Test boundary: temp projects, subprocess runner, PBT/model helpers, focused
  conformance wrapper.
- caveat: this is a dispatch orientation map, not a mandatory file/module DAG.

## Seed Title Summary

| temp_id | title | LOC estimate |
| --- | --- | --- |
| N1 | Scaffold implementation module | 200-400 |
| N2 | Implement storage loader | 400-800 |

## Creation Order

1. N1 scaffold
2. N2 storage-loader

## Dependency Graph

```text
N1 -> N2
```

## LOC Sizing Summary

- Estimated implementation/test/docs churn: 600-1,200 LOC.
- Split candidates if estimates grow: N2 storage-loader.
- Merge candidates if implementation is tiny: none.
````

## Creation

Only create seeds when explicitly requested.

- Use work queue CLI as source of truth.
- Build repo-local CLI if `AGENTS.md` requires it.
- Create parent/epic first when useful, then child seeds.
- For `program`, create the parent epic plus the current stage only unless the
  user explicitly asks for all stages.
- Persist each created seed with enough execution context for `dispatch-work`
  to work from the work order record plus its stored labels/dependency
  edges, without opening `plan.md`. Put the planned seed card in the
  description, or a faithful compact rendering with execution-critical fields:
  `temp_id` for traceability only, `seed_slug`, `area`, `source_refs`,
  `acceptance`, `gates`, `verification_owner`, `target_gates`,
  `estimated_loc`, and `dispatch_notes`. Include a scope boundary: implement
  only this seed; use any plan references as context, not permission to
  implement other seed cards.
- Add dependency edges via CLI only.
- Preserve unrelated dirty worktree changes.
- Record created ID mapping in `creation.md` and `created-map.json`. Do not
  overwrite `plan.md` only to add IDs. Initial plan creation maps are not
  follow-up growth sources unless they explicitly use follow-up fields such as
  `manager_created_count`, `followup_growth_counter`, `followups`, or
  `followup_ids`.
- Structural creation changes require a prior plan-change event; see
  `manage-run.md`.

## Artifact Tree

```xml
<artifacts root="tmp/seedstack/<slug>">
  <plan path="plan.md" />
  <adoption path="adoption.md" />
  <adoption_selection path="adoption-selection.json" />
  <seedstack_scan path="scan.json" contract="seedstack_scan.v1" />
  <dirty_result path="dirty-result.json" contract="dirty_state_classification.v1" />
  <dispatch_reconcile_check path="dispatch-reconcile-check.json" contract="dispatch_reconcile_check.v1" />
  <adoption_selection_check path="adoption-selection-check.json" contract="adoption_selection_check.v1" />
  <loop_cap_check path="loop-cap-check.json" contract="loop_cap_check.v1" />
  <run_transition_check path="run-transition-check.json" contract="run_transition_check.v1" />
  <commit_check path="commit-check.json" contract="commit_ledger_check.v1" />
  <update_run_state_result path="update-run-state-result.json" contract="update_run_state.v1" />
  <review path="review-r<round>-a<agent>.md" />
  <review_diff path="review-diff-r<round>.md" />
  <verify path="verify-r<round>.md" />
  <precreation_review path="review-precreation-a<agent>.md" />
  <creation path="creation.md" />
  <created_map path="created-map.json" />
  <adoption_epoch path="adoption/epoch-<n>.json" />
  <adoption_active path="adoption/active.json" />
  <manage path="manage/log.jsonl" />
  <manage_latest path="manage/latest.md" />
  <manage_decision path="manage/events/iter-<n>/decision.md" />
  <manage_result path="manage/events/iter-<n>/result.md" />
  <plan_change path="manage/events/iter-<n>/plan-change.md" />
  <run_state path="run-state.json" />
  <commit_ledger path="commit-ledger.md" />
  <run path="run.md" />
</artifacts>
```

## Manage Event

Write `manage/events/iter-<n>/decision.md` before a manage iteration mutates
or escalates:

1. Iteration id and timestamp.
2. Input dispatch artifacts.
3. Fresh work queue CLI state snapshot.
4. Dispatch outcome classification.
5. Decision and rationale.
6. New/changed seed cards, if any.
7. Dependency, label, priority, or status mutations.
8. Residual risk and next action.

After mutation or escalation, write `manage/events/iter-<n>/result.md` with
CLI commands/results, post-mutation CLI state, and any drift detected.

Append a compact row to `manage/log.jsonl` for every iteration, including
clean no-op iterations. Rewrite `manage/latest.md` each time with current
summary, ready count, blocked count, open count, and recommended next action.
Manage events are append-only. If an escalation later resolves, write a new
result/decision event that references the earlier event instead of rewriting
the stop evidence.

## Adoption Artifact

Write `adoption.md` before run mode touches an existing open queue:

1. Open, ready, blocked, active, and assigned-to-other counts.
2. Existing labels found.
3. Health/deadlock flags.
4. Recommended user choice: adopt all, adopt labeled subset, create new stack,
   or stop.

No SeedSpec mutation may happen during adoption scan.

Write `adoption-selection.json` after user choice:

1. Adopted work order ids and selected label/filter.
2. Excluded open ids and reason.
3. Baseline open/ready/blocked/active/assigned counts.
4. Baseline manager-created follow-up count.
5. Timestamp and user decision summary.
6. Adoption epoch id and active manifest pointer.

## Run Artifact

Write `run-state.json` before dispatch with `state=dispatching`, after manage
with `state=idle` or a terminal state, and before every stop/resume. Use
`skills/seedstack/scripts/update-run-state.ts` to refresh `run-state.json` and
`run.md` together from that canonical state:

1. Stack slug, assignee, loop cap, and current iteration.
2. Run mode: `manual` or `auto`.
3. Adopted selection path and selected work order ids/filter.
4. Adoption epoch and active adoption manifest id.
5. Last or next selection, if any: candidate ready work order ids, chosen work order id,
   and selection rationale. If no seed is selected because the run is stopping,
   record `none` plus the stop reason. In manual mode, the rationale is the
   user-selected work order id or explicit user instruction. In auto mode, the
   rationale is the orchestrator tie-breaker or recorded override reason.
6. Git commit policy: `per_seed`, `batch`, or `none`; include latest commit
   status when a cleanly closed seed is awaiting commit or was committed.
7. Current state: `idle`, `dispatching`, `managing`, `done`, `blocked`,
   `escalated`, or `loop_cap`.
8. In-flight dispatch work id and artifact path, if any.
9. Latest manage decision/result path.
10. Seed counts by state plus follow-up growth counter.
11. Stop condition, if any.
12. Next command or next user decision.
13. Dirty snapshot using `manage-run.md` path classifications.

Never represent a closed seed as active. `active_dispatch` is null unless a
dispatch is currently unreconciled or in progress.
