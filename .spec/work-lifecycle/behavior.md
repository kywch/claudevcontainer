# Work Lifecycle Behavior

Status: draft v0.

## Draft Boundary

This file records minimal behavior implied by accepted decisions. It is not a
complete protocol, state machine, schema, interface, conformance suite, or Quint
model.

## Ownership

Seeds CLI owns `.seeds/` queue persistence and command behavior.

Seedstack owns planning, ready selection, adoption, queue management, closure,
retry, escalation, dependency updates, label updates, and follow-up creation.

Dispatch Work owns execution of one bounded work item and must emit exactly one
local result: `done`, `retry`, or `escalate`.

Capture Knowledge owns the capture gate and any accepted knowledge record
mutation.

## Boundaries

Dispatch Work must not mutate `.seeds/**`.

Spec drafting may read `.seeds/` and source docs as evidence, but must not
change live queue state.

Queue close is distinct from Dispatch Work `done`; Seedstack decides whether a
local result closes, retries, escalates, or creates follow-up queue work.

Knowledge capture is distinct from completion. A completed work item may have no
qualified knowledge record.

## Terminal Vocabulary

The lifecycle uses three separate terminal vocabularies:

- Dispatch Work local gate: `done`, `retry`, or `escalate`.
- Seedstack manage reconciliation: `close` or `escalate`.
- Seedstack run terminal outcome: `done`, `exhausted`, `blocked`,
  `escalated`, or `loop_cap`.

These vocabularies are not interchangeable. A Dispatch Work `done` means the
bounded work item passed its local execution gate. It does not close a Seeds
queue record. A Seedstack `close` means manage mode reconciled a local result
against current queue state and chose to close the work order through the queue
owner. A run terminal `done` means the run loop reached its completion
condition after dispatch and manage reconciliation. This terminal vocabulary
separation is a draft v0 lifecycle requirement.

## Numbered Lifecycle Clauses

### WL-001: Intent Intake

Seedstack receives user intent or queue context and classifies it as planning,
management, or run-loop work. Intent must identify the work objective closely
enough to avoid mutating unrelated queue state.

Draft v0 does not require a schema for intent intake. It requires only that the
chosen lifecycle owner be explicit before queue mutation, dispatch execution, or
run-loop orchestration begins.

### WL-002: Plan Formation

When intent requires more than one bounded unit of work, Seedstack forms a work
plan or work-order DAG before seed creation or run execution. The plan records
scope, ordering, acceptance, and expected reconciliation path at the level
needed to create queue work safely.

Planning does not execute the work item. Dispatch Work remains responsible only
for one prepared bounded item after Seedstack selects or supplies it.

### WL-003: Seed Creation

Seedstack may create Seeds queue records from an accepted plan through the
queue CLI. Seed creation preserves Seeds CLI ownership of issue persistence,
fields, dependencies, labels, and status vocabulary.

Spec text and Dispatch Work children must not create, edit, or delete
`.seeds/**` files directly. Queue records are lifecycle state, not dispatch
implementation artifacts.

### WL-004: Queue Baseline

Before a run loop dispatches work automatically, Seedstack establishes a clean
queue baseline for `.seeds/**` queue state, excluding knowledge capture state
when the run policy allows that exclusion. Existing dirty queue paths stop the
auto run until the operator commits, reverts, or otherwise resolves them through
the authorized flow.

The queue baseline protects later manage decisions from confusing preexisting
queue edits with changes made by the current lifecycle run.

### WL-005: Adoption And Ready Selection

Seedstack adopts an explicit stack or selects ready work from Seeds queue state
before dispatch. Ready selection is evidence from Seeds CLI behavior: open work
whose unresolved blockers are closed, subject to planning, filters, and
scheduling behavior.

Seedstack must not adopt active, assigned-to-other, closed, or unknown-status
work unless a later explicit rule permits it. Adoption defines the queue scope
that manage mode may later reconcile.

### WL-006: Dispatch Handoff

Seedstack hands one bounded work order to Dispatch Work with the local
acceptance criteria, artifact expectations, allowed edit scope, and gate
commands needed for execution. Dispatch Work owns research, implementation,
review, verification, and the local gate for that one work item.

Dispatch Work must not mutate `.seeds/**`, close queue records, create
follow-up queue records, repair dependencies, or change queue labels. Those
actions remain Seedstack responsibilities.

### WL-007: Dispatch Local Gate

Dispatch Work emits exactly one local gate result:

- `done`: the bounded work item satisfies local acceptance and required gates,
  with any waivers recorded by the dispatch flow.
- `retry`: another dispatch execution round is needed for the same bounded work
  item.
- `escalate`: the work item is blocked, unsafe, ambiguous, too large, failed in
  a way dispatch cannot resolve, or requires a user or queue-manager decision.

Dispatch Work `done` is local. It is not a Seeds close operation and is not a
run terminal outcome.

### WL-008: Manage Reconciliation

After each dispatch result, Seedstack manage mode reconciles the local gate
against fresh queue state, the adopted stack, acceptance, dirty guards, and any
follow-up proposals. Seedstack must reconcile before the orchestrator dispatches
another seed in the same run.

Manage reconciliation decides whether the queue lifecycle can close, retry,
escalate, adjust dependencies, change labels, or propose follow-up work. Only
Seedstack owns those queue-management decisions.

### WL-009: Close Decision

Seedstack may close a work order only after manage mode has reconciled a
Dispatch Work local `done` against current queue state and accepted that no
unresolved acceptance remains for the same seed. The terminal manage decision
for this path is `close`.

Close is a queue lifecycle decision. It is distinct from Dispatch Work `done`
and from run terminal `done`.

### WL-010: Retry Decision

Seedstack may send work back to Dispatch Work when local result `retry`, manage
review, or current queue state shows that another bounded execution round is
needed. Retry keeps the same queue lifecycle active unless Seedstack explicitly
splits or replaces it through authorized queue operations.

Retry is nonterminal for the queue and for the run loop. It must not be reported
as `close`, `done`, or `exhausted`.

### WL-011: Escalation Decision

Seedstack escalates when dispatch, manage, or run-loop evidence shows that the
current lifecycle cannot safely continue without a user decision, split,
follow-up, dependency repair, scope change, or accepted stop disposition.

Dispatch Work local `escalate` is evidence for Seedstack. Seedstack manage
reconciliation determines whether the queue terminal decision is `escalate` or
whether another authorized resolution path applies.

### WL-012: Knowledge Capture Evaluation

Knowledge capture is evaluated after meaningful lifecycle points:

- after manage mode reconciles a clean seed close;
- after escalation is resolved by retry, user decision, split, follow-up, or
  accepted stop disposition;
- after run terminal `done`, before the final run summary.

Capture Knowledge owns the recording gate and any append to
`.seeds/knowledge.jsonl`. The capture state may be `recorded`,
`none_qualified`, `store_missing`, or `skipped_user_waived`.

Absence of a qualified record does not block work completion, queue close, or
run terminal `done`. Knowledge capture records durable lessons when they pass
its gate; it is not a completion gate.

### WL-013: Run Terminal Report

Seedstack run mode repeats dispatch and manage reconciliation until it reaches
one exclusive run terminal outcome: `done`, `exhausted`, `blocked`,
`escalated`, or `loop_cap`.

The terminal report must preserve the vocabulary separation:

- report Dispatch Work local gate results as `done`, `retry`, or `escalate`;
- report manage reconciliation as `close` or `escalate` when terminal for that
  seed;
- report the overall run terminal outcome as `done`, `exhausted`, `blocked`,
  `escalated`, or `loop_cap`.

A terminal report must not use follow-up proposals as a third manage terminal
state. Follow-ups are nonterminal proposals until Seedstack creates or rejects
them through the queue lifecycle.
