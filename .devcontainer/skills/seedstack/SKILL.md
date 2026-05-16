---
name: seedstack
description: "Use for work-order stack planning, queue state, management, or orchestration: decompose work into a small DAG, adopt ready queue work, reconcile graph state after dispatch-work, close queue records, or run the plan -> dispatch-work -> manage loop. Use dispatch-work only for executing one prepared work item."
---

# Seedstack

## Purpose

Manage the work order lifecycle around `dispatch-work`.

- **Plan**: convert an ask into a work-order DAG that can be created with a queue CLI.
- **Manage**: review one dispatch-work result against the current stack, then
  mutate work orders/deps/labels through the work queue CLI when needed.
- **Run**: orchestrate plan -> `dispatch-work` -> manage until all work orders close
  or escalation is required.

`dispatch-work` stays separate and owns one work item's execution,
verification, and local done/escalate gate. Seedstack owns graph shape, queue
selection/close, follow-up creation, and loop control.

## Inputs

- repo path
- user ask or issue text
- mode: `plan`, `manage`, or `run` (infer from user phrasing when omitted)
- network/stack slug, if known
- dispatch-work artifact path, if managing after execution
- target area, if known
- preferred assignee, if creating work orders now
- work queue CLI path, if creation is requested

## Glossary

See `references/glossary.md` for definitions of all terms used below:
gates (quality gate, safety gate), review modes (full, diff), loop
mechanics (review-fix-verify, fix sub-cap, fresh verify), state flags
(dirty bit, full review since last mutation, residual risk), user
touchpoints, caps, escalation, lenses, and pre-creation mechanical checks.

## Mode Selection

| user asks for | mode |
| --- | --- |
| decompose, plan, create initial work orders, work DAG | `plan` |
| review dispatch-work result, add follow-up work orders, adjust deps, unblock stack | `manage` |
| keep executing until done, manage loop, close all work orders | `run` |
| keep executing without per-order pauses, auto-select ready work | `run auto` |

Use this skill for multi-order stack work and all queue-state mechanics:
ready selection, close, dependency, label, priority, and follow-up creation.
For executing/verifying one already-prepared work item, use `dispatch-work`.

If uncertain, ask one concise question only when a wrong mode could mutate
queue state. Otherwise prefer `plan` for new work and `manage` when dispatch
artifacts are supplied.

## Load References

Load references only when needed:

- Glossary of all terms: `references/glossary.md`
- Work card schema, plan artifact structure, creation, artifact tree:
  `references/seed-card-and-artifacts.md`
- Verification ownership, gate test types, sizing, review-fix iterations:
  `references/verification-and-sizing.md`
- Label table, edge rules, algorithm edges:
  `references/labels-and-edges.md`
- Plan mode flow, alignment, research, decomposition:
  `references/planning-flow.md`
- Chunking strategy tradeoffs for implementation ports and broad features:
  `references/chunking-strategies.md`
- Manage/run flow, adoption scan, graph mutation rules:
  `references/manage-run.md`
- Plan review agents, lenses, presentation contract:
  `references/plan-review.md`
- Quality bar and stuck-state resolutions:
  `references/quality-and-stuck.md`
- SeedSpec example DAGs and source heuristics for this repo only:
  `references/seedspec-example.md`
- Quint model and report for project/program plan-to-create state machine
  (not graph validity): `quint/`

## Quick Paths

### Plan

```text
classify size
  -> write tmp/seedstack/<slug>/plan.md
  -> review if project/program
  -> present plan with visible assumptions
  -> if explicitly requested: create work order records only through queue CLI
  -> otherwise stop; do not implement, dispatch, run, or edit target files
```

Plan mode writes `plan.md` only. Any creation, dispatch, run, or target-file
edit needs an explicit follow-on request after plan presentation.

Load `references/planning-flow.md`, `references/seed-card-and-artifacts.md`,
`references/verification-and-sizing.md`, `references/labels-and-edges.md`,
`references/chunking-strategies.md`, and `references/quality-and-stuck.md`.
Also load `references/plan-review.md` when planning a `project` or `program`.

### Manage

```text
read current stack + dispatch artifacts
  -> validate fresh CLI state
  -> write decision before mutation
  -> mutate graph only through work queue CLI if allowed
  -> write result/latest/log
```

Load `references/manage-run.md` and `references/seed-card-and-artifacts.md`.

### Run

```text
adoption scan existing queue (read-only)
  -> ask if open work orders exist and stack choice is unclear
  -> after seed creation: commit the queue baseline before first auto dispatch
  -> invoke `scripts/seedstack-loop.ts` as the outer supervisor
  -> report the supervisor JSON result and latest events
```

Load `references/manage-run.md`.

For `run` / `run auto`, do not manually drive the loop when
`scripts/seedstack-loop.ts` exists and passes `--self-test`. Invoke it:

```bash
bun skills/seedstack/scripts/seedstack-loop.ts \
  --seedstack-dir tmp/seedstack/<slug> \
  --adoption-selection tmp/seedstack/<slug>/adoption-selection.json \
  --seed-cli sd \
  --mode auto \
  --codex-reasoning-effort medium \
  --commit-policy per_seed
```

If `sd` is not available, stop and ask the user to install seed from
https://github.com/jayminwest/seeds before any queue read or mutation. Do not
fall back to another queue CLI unless the user explicitly supplies one.

If `.seeds` is missing in run/manage mode, stop and ask before `sd init`.
Do not auto-initialize queue state.

The supervisor is the authority for continue/stop/done. It streams JSONL
events to stdout and `<seedstack-dir>/events.jsonl`, persists loop epochs in
`<seedstack-dir>/loop-state.json`, launches bounded child agents for one
dispatch/manage step, and enforces the outer-loop invariants modeled in
`quint/run_loop.qnt`. If the script exits `0`, report done. If it exits
nonzero, report its JSON stop reason and do not continue manually except to
fix the script or resolve an explicit blocker.

Manual run-loop fallback is allowed only when `seedstack-loop.ts` is missing or
broken. Record `manual_loop_fallback` in run artifacts and stop after one
iteration instead of silently taking over the whole loop.

`run auto` uses the same safety rules as `run`, but the orchestrator may select
the next ready seed without asking after adoption is fixed. It must still pass
an explicit work order id to dispatch, record the selection rationale in
`run-state.json`, refresh `run.md`, and stop on escalation, dirty unexpected
worktree, no-ready deadlock, loop cap, or failed gates.

Before the first `run auto` dispatch, `.seeds/**` queue state must already be a
clean git baseline. Create seeds, commit `.seeds/issues.jsonl` and any related
queue files first, then start auto run. If queue paths are dirty before first
dispatch, excluding `.seeds/knowledge.jsonl`, the supervisor stops with
`preexisting_queue_dirty_before_auto_run` and reports `queue_dirty_paths` plus
the remedy to commit the queue baseline first.

## Agent Roles

| role | owns | may edit |
| --- | --- | --- |
| Planner | alignment, plan artifact, final presentation | plan artifact only |
| Manager | post-dispatch reconciliation, graph mutation decisions | manage artifacts; queue CLI only |
| Orchestrator | outer loop and stop conditions | run artifacts; queue CLI through modes only |
| Research | source map, impl map, test map, risk map | read-only |
| Plan-Review | independent critique of plan artifact (full lenses) | read-only |
| Diff-Review | scoped critique of revision delta (diff lens) | read-only |
| Verify | confirms specific fixes landed, no regressions in touched cards | read-only |

Research, Plan-Review, Diff-Review, and Verify agents are read-only. They
read source files, spec, and plan artifacts. They do not edit the plan or
create work orders.

Read-only subagents author all `review-*` and `verify-*` artifacts. The
planner/orchestrator may only copy or minimally wrap their outputs. Verify
agents must be fresh and targeted. Full rules: `references/plan-review.md`.

## Slugs And IDs

- `network_slug`: stable, human-readable, valid as a label.
- `seed_slug`: plan-only handle, not a CLI ID.
- Shared network label (e.g. `net-ts-impl`) must appear in every work order's
  labels array, not only in the plan header.
- work queue CLI cannot create caller-chosen IDs. Use titles and labels for
  grouping.

## Safety

- Do not hand-edit `.seeds/**`. Use work queue CLI only.
- Plan mode is non-implementation. Plan acceptance authorizes plan
  finalization only; it does not authorize editing repo code, invoking
  `dispatch-work`, running the stack loop, or starting
  implementation.
- Explicit seed creation creates work order records only. It is not permission to
  execute those seeds.
- Workflow is: create seeds -> commit queue baseline -> run auto. Do not start
  first auto dispatch while `.seeds/**` queue files are dirty, except
  `.seeds/knowledge.jsonl` under the existing dirty-state policy.
- Do not create work orders without explicit user request. A user request to run the
  stack loop permits manager-created follow-ups within caps; pause for user
  approval above caps or before structural splits.
- For `program`, create the parent epic plus the current stage only unless the
  user explicitly asks for all stages.
- Do not plan dispatch-time seed creation as a dependency of success.
  Dispatchers may suggest follow-ups; planning or explicit user creation owns
  new seed creation.
- When creating planned or manager-created seeds, do not use pointer-only
  descriptions such as `See plan.md`. Each persisted issue description must
  carry the seed-card details `dispatch-work` needs for autonomous work, while
  labels and dependency edges remain stored through the work queue CLI.
- Do not overwrite an existing `plan.md` without user confirmation.
- Do not present a `project`/`program` plan without review artifacts.
- Spawned prompts must use repo-native commands and active repo/parent command
  wrappers; they must not assume aliases or wrappers unavailable in their
  environment.
- Preserve unrelated dirty worktree changes.

## Planning Invariants

- Planner must classify ask size before planning.
- Planner must not skip alignment for `project`/`program` without recording
  explicit assumptions.
- Planner must write `plan.md` before spawning review agents.
- Planner must not present a `project`/`program` plan without review artifacts
  under `tmp/seedstack/<slug>/`.
- Planner must not present a `project`/`program` plan if review or verify
  artifacts were locally authored instead of written from subagent outputs.
- Planner must not treat first presentation as final for `project`/`program`.
  User feedback gate required before plan is accepted.
- Planner must not edit files outside the plan artifact tree in plan mode.
- Planner must not create work orders without explicit user request.
- **Quint coverage**: `quint/plan_flow.qnt` is ground truth for
  project/program plan -> create flow, dirty bit behavior, review caps,
  adjustment caps, and pre-creation safety. It does not cover single-fix/slice,
  manage/run loops, CLI mutation correctness, graph validity, artifact
  nonemptiness, or dispatch close logic.
- **No creation without review** (Quint-proven for project/program planning):
  `CreateSeeds` requires `fullReviewSinceLastMutation=true`. Cap-hit residual
  risk is allowed only after a full review ran and the risk was recorded. The
  pre-creation agent review is load-bearing for review safety; scripted
  mechanical checks always run before CLI creation.
- **Dirty-bit semantics**: sets on user adjustments and planner revisions
  after user feedback. Clears when a full review-fix-verify loop exits clean.
  Does NOT clear on cap hit (unfixed findings = residual risk). Diff review
  does not clear dirty bit.
- **Residual risk allowed**: creation is permitted with dirty bit true if a
  full review has run (cap hit with unfixed findings). Residual risk must be
  recorded in the plan artifact.
- Review-fix-verify loop: cap 3 passes per loop instance. Cap resets on each
  new draft. Fix sub-cap: 2 attempts per pass.
- Verify agents must be fresh, scope is targeted.
- Diff review that finds 3+ material findings or damage outside the touched
  seed set must escalate to full review.
- Safety gate (pre-creation): accept or reject only (no adjust). Reject
  routes to User reacts. Works regardless of "just go" mode. Assumption
  check does not rerun at pre-creation.
- Pre-creation mechanical checks (temp_id uniqueness, seed_slug presence,
  priority equals 1, blocked_by validity, creation order, shared label, no
  empty acceptance/gates) are scripted. Plan quality checks such as grab-bag
  detection, chunking strategy fit, early-smoke expectations, discovery-seed
  exceptionalism, and upfront-summary format require agent review.
- Run pre-creation mechanical checks with:
  `bun skills/seedstack/scripts/check-plan.ts tmp/seedstack/<slug>/plan.md --shared-label <label>`.
- Terminal outcomes are exclusive: plan is presented or escalated, never both.

## Management Invariants

- Manager must not mutate work-order state without a written decision artifact.
- Manager must not mutate from a stale decision; fresh CLI state immediately
  before mutation must match the decision snapshot.
- Manager must not create more than two seeds per iteration without explicit
  user approval.
- Manager owns queue close decisions after dispatch-work reports local done;
  dispatch-work must not close queue records.
- Manager must not mutate active, assigned-to-other, closed, or unknown-status seeds.
  Dependency repair may touch unassigned blocked seeds when graph evidence
  shows the dependency is wrong.
- Manager must not mutate seeds outside the adopted stack manifest unless the
  user explicitly approves that expansion.
- Manager must not create follow-ups that duplicate unresolved acceptance from
  the just-dispatched seed.
- Orchestrator must not dispatch another seed until manage mode reconciles
  the previous dispatch result.
- Run terminal outcomes are exclusive: `done`, `exhausted`, `blocked`,
  `escalated`, or `loop_cap`.

## Quality And Stuck States

For the full presentation checklist, pre-creation quality bar, and stuck-state
resolutions, load `references/quality-and-stuck.md`.
