# Work Lifecycle Interfaces

Status: draft v0.

## Draft Boundary

This file defines prose-level handoff contracts between Seeds CLI, Seedstack,
Dispatch Work, and Capture Knowledge. It does not define JSON schemas, CLI
wire formats, validation code, conformance tests, or a Quint model.

Future JSON schemas are deferred to hardening. Draft v0 requires stable
meaning, ownership, and minimum observable fields only.

## Interface Rules

Every handoff must state:

- owner that may mutate the object;
- consumer that may read the object;
- minimum fields or evidence required for the next lifecycle step;
- terminal vocabulary used by that object;
- whether the object is queue state, dispatch artifact, run state, or knowledge
  state.

Objects crossing from Seedstack to Dispatch Work are read-only queue context
unless the work order explicitly names repo edit roots. Objects crossing from
Dispatch Work to Seedstack are local evidence, not queue commands.

## Seeds Issue Interface

Owner: Seeds CLI.

Consumers: Seedstack, Dispatch Work as read-only context, Capture Knowledge as
read-only context when relevant.

State class: queue state.

Minimum observable fields for lifecycle use:

- `id`: stable issue id used by Seedstack to identify the queue item.
- `title`: human-readable summary.
- `status`: enum observed as `open`, `in_progress`, or `closed`.
- `type`: issue type such as `task`, `bug`, `feature`, or `epic`.
- `priority`: scheduling input used by ready selection and operator review.
- `assignee`: optional ownership signal.
- `description`: source for work order scope, acceptance, gates, and notes.
- `blocks`: issue ids that this issue blocks.
- `blockedBy`: issue ids that must be resolved before normal readiness.
- `labels`: grouping, network, and scheduling metadata.
- `closeReason`: close rationale when status is `closed`.
- `createdAt`, `updatedAt`, and `closedAt`: lifecycle timestamps.

Readiness fields:

- `status` must be open for normal ready work.
- `blockedBy` must have no unresolved blockers for normal ready work.
- plan-related readiness may hide work that requires draft or unresolved plans.
- `priority` and `labels` may affect selection order or filtering but do not
  override unresolved blockers.

Seedstack relies on Seeds commands conceptually equivalent to:

- initialize or inspect queue state;
- create issues from accepted plans;
- list and read issues;
- select ready issues;
- update status and metadata;
- close issues;
- manage dependencies and labels;
- emit structured output suitable for automation.

Draft v0 does not standardize exact command names or flags as schema. It records
the command capabilities Seedstack depends on.

## Seed Card Interface

Owner: Seedstack when deriving the card from queue state.

Consumers: Dispatch Work and operators.

State class: handoff view derived from queue state.

Minimum content:

- source Seeds issue id;
- title and bounded task summary;
- area or target root;
- acceptance criteria;
- target gates;
- source refs and context notes;
- allowed edit scope;
- non-goals and dispatch notes;
- dependency/readiness evidence.

A seed card is not independent queue state. It must preserve enough provenance
for Seedstack to reconcile the resulting dispatch gate against the source
Seeds issue.

## Work Order Interface

Owner: Dispatch Work after receiving seed card or direct work text.

Consumers: Dispatch roles and Verify.

State class: dispatch input artifact.

Minimum content:

- work order id;
- repo root;
- title and task summary;
- accepted scope and non-goals;
- allowed repo edit roots;
- acceptance criteria;
- gate commands or explicit waivers;
- dirty baseline to preserve;
- queue context marked read-only when it comes from Seeds.

The work-order interface turns queue context into one bounded execution item.
It must not authorize queue close, dependency edits, label edits, or follow-up
creation.

## Packet Interface

Owner: Dispatch Work dispatcher.

Consumers: Execute, Implement, Review, Verify, and final gate.

State class: dispatch artifact.

Minimum content:

- normalized work order summary;
- source hints and likely files;
- acceptance criteria;
- implementation scope budget;
- target gates and expected evidence;
- risks and non-goals;
- allowed repo edit roots;
- dispatch artifact roots.

The packet is the execution plan for one dispatch round. It must be specific
enough for child roles to run without mutating `.seeds/**`.

## Dispatch Gate Interface

Owner: Dispatch Work dispatcher.

Consumers: Seedstack manage mode.

State class: dispatch terminal evidence.

Minimum content:

- work order id;
- local decision: `done`, `retry`, or `escalate`;
- round path;
- evidence paths for execute, implement, review, and verify;
- gate checks and outcomes;
- dirty guard snapshot;
- changed implementation paths;
- waivers, if any;
- blocked reason when not done.

Dispatch gate `done` means the bounded local work passed dispatch evidence. It
does not close a Seeds issue. Dispatch gate `retry` asks for another local
execution round. Dispatch gate `escalate` reports that local execution cannot
continue safely.

## Manage Decision Interface

Owner: Seedstack.

Consumers: Seedstack run mode, operators, Capture Knowledge when capture points
are reached.

State class: queue lifecycle decision.

Minimum content:

- source Seeds issue id;
- dispatch gate result being reconciled;
- fresh queue state evidence;
- dirty guard result;
- accepted or rejected evidence paths;
- decision: `close`, retry, or `escalate`;
- rationale;
- queue command path when mutation is authorized;
- follow-up proposals, if any, as nonterminal proposals.

`close` is a Seedstack manage terminal decision for the queue item. Retry is a
nonterminal manage decision that sends the item back to Dispatch Work when safe.
`escalate` is a Seedstack terminal decision unless a later authorized resolution
chooses retry, split, follow-up, dependency repair, or stop disposition.

## Run State Interface

Owner: Seedstack run mode.

Consumers: Seedstack manager, operators, and final report readers.

State class: run state.

Minimum content:

- adopted queue scope;
- queue baseline evidence;
- current selected issue, if any;
- completed, retried, escalated, and skipped work ids;
- loop counters and caps;
- latest dispatch result;
- latest manage decision;
- pending capture state;
- terminal outcome when stopped.

Run terminal outcome must be exactly one of:

- `done`;
- `exhausted`;
- `blocked`;
- `escalated`;
- `loop_cap`.

Run state must not use follow-up proposals as a run terminal outcome.

## Knowledge Record Interface

Owner: Capture Knowledge.

Consumers: future research and dispatch flows.

State class: knowledge state.

Minimum content:

- `id`: durable record id;
- `type`: category such as convention, pattern, failure, decision, reference, or
  guide;
- `content`: self-contained lesson that remains useful without temporary
  dispatch artifacts;
- `recorded_at`: timestamp.

Capture state may be:

- `recorded`;
- `none_qualified`;
- `store_missing`;
- `skipped_user_waived`.

Knowledge capture is evaluated after manage-reconciled close, resolved
escalation or accepted stop disposition, and run terminal done. Absence of a
qualified knowledge record does not block dispatch completion, queue close, or
run terminal done.

## Handoff Summary

| handoff | producer | consumer | object | terminal vocabulary |
| --- | --- | --- | --- | --- |
| queue selection | Seeds CLI | Seedstack | Seeds issue/readiness evidence | `open`, `in_progress`, `closed` |
| dispatch start | Seedstack | Dispatch Work | seed card / work-order | none |
| round execution | Dispatch Work | child roles | packet | none |
| local gate | Dispatch Work | Seedstack | dispatch gate | `done`, `retry`, `escalate` |
| queue reconcile | Seedstack | run mode/operator | manage decision | `close`, retry, `escalate` |
| run reporting | Seedstack | operator | run state | `done`, `exhausted`, `blocked`, `escalated`, `loop_cap` |
| learning | Capture Knowledge | future agents | knowledge record | `recorded`, `none_qualified`, `store_missing`, `skipped_user_waived` |

## Deferred Hardening

The following are explicitly out of scope for draft v0:

- JSON schemas for work orders, packets, gates, manage decisions, run state, or
  knowledge records;
- strict CLI output schemas for Seeds commands;
- conformance fixtures;
- Quint transition model;
- automated validators for cross-interface compatibility.

Future hardening may add those artifacts without changing the draft v0 rule
that queue mutation belongs to Seeds CLI and Seedstack, local execution belongs
to Dispatch Work, and knowledge storage belongs to Capture Knowledge.
