# Work Lifecycle State

Status: draft v0.

## Draft Boundary

This file defines prose-level lifecycle states for the work lifecycle around
Seeds, Seedstack, Dispatch Work, and Capture Knowledge. It is not a JSON schema,
conformance suite, command contract, or Quint model.

Future hardening work may turn these states into schemas or models. Draft v0
uses this file only to make handoffs and stop conditions explicit enough for
operators and agents to follow without rereading source docs.

## State Owners

Seeds CLI owns persisted issue state in `.seeds/**`.

Seedstack owns planned work state, adopted queue scope, manage decisions, retry
selection, escalation disposition, and run-loop state.

Dispatch Work owns one local execution state for one bounded work order and
reports a local gate result.

Capture Knowledge owns knowledge capture evaluation and any accepted knowledge
record state.

No state in this file gives Dispatch Work permission to mutate `.seeds/**`.

## Lifecycle States

### LS-001: Intent Received

The lifecycle begins when user intent, queue context, or a prepared work order
is presented to a lifecycle owner.

Required state:

- objective text or queue id;
- selected owner or pending owner decision;
- boundedness signal: single work item, stack plan, manage action, or run loop.

Exit paths:

- to `Plan Needed` when work must be decomposed;
- to `Queue Scoped` when existing queue work is the source of truth;
- to `Dispatch Ready` when one bounded work order is already supplied;
- to `Stopped` when owner, scope, or authority is ambiguous.

### LS-002: Plan Needed

Seedstack is forming or reviewing a work plan before queue work is created or
selected.

Required state:

- planned work units;
- dependency order;
- acceptance per work unit;
- target edit scope and gates.

Exit paths:

- to `Queue Scoped` after authorized seed creation or adoption;
- to `Stopped` when the plan is too ambiguous, too large, or not authorized.

### LS-003: Queue Scoped

Seedstack has identified the queue scope it may reason about. The scope may be
an adopted stack, an explicit issue, or an authorized run selection.

Required state:

- queue source and selection rationale;
- current Seeds issue status evidence;
- blockers and readiness evidence;
- queue baseline status.

Exit paths:

- to `Queue Baseline Clean` when queue state is safe for automated dispatch;
- to `Stopped` when queue state is dirty, stale, missing, or outside authority.

### LS-004: Queue Baseline Clean

Seedstack has established that queue state is suitable for the next action.
For automatic run loops, this means `.seeds/**` queue state has a clean baseline
before first dispatch, except knowledge state when the active policy excludes
it.

Required state:

- baseline snapshot or clean-status evidence;
- excluded paths, if any;
- adopted queue scope.

Exit paths:

- to `Ready Selected` when exactly one ready work item is chosen;
- to `Stopped` when no ready work exists, queue paths are dirty, or selection is
  inconsistent with blockers.

### LS-005: Ready Selected

Seedstack has selected one queue item as ready for handoff. Readiness is based
on Seeds status and blockers, plus any plan-specific readiness rules.

Required state:

- selected Seeds issue id;
- readiness evidence;
- unresolved blockers list, expected to be empty for normal ready work;
- acceptance and allowed edit scope.

Exit paths:

- to `Dispatch Ready`;
- to `Stopped` when readiness is stale or contradicted by fresh queue state.

### LS-006: Dispatch Ready

Dispatch Work has one bounded work order and enough local acceptance criteria to
execute. Queue context is read-only evidence.

Required state:

- work order id and title;
- acceptance criteria;
- gate commands or explicit waivers;
- allowed repo edit roots;
- dirty baseline for existing user changes.

Exit paths:

- to `Dispatch Running`;
- to `Stopped` when scope, gates, or authority are missing.

### LS-007: Dispatch Running

Dispatch Work is researching, implementing, reviewing, and verifying one work
item. Inner role state may include execute, implement, review, and verify
artifacts, but those artifacts do not mutate queue state.

Required state:

- packet and source hints;
- role reports and child run status evidence when roles are launched;
- implementation diff within allowed roots;
- verification evidence.

Exit paths:

- to `Dispatch Gate Done`;
- to `Dispatch Gate Retry`;
- to `Dispatch Gate Escalate`.

### LS-008: Dispatch Gate Done

Dispatch Work has accepted the bounded work item locally. This is a dispatch
terminal state, not a Seeds queue terminal state.

Required state:

- local gate result `done`;
- evidence paths for execute, implement, review, and verify;
- recorded waivers, if any;
- dirty guard snapshot.

Exit paths:

- to `Manage Reconciling`.

### LS-009: Dispatch Gate Retry

Dispatch Work has determined that another bounded execution round is needed for
the same item.

Required state:

- local gate result `retry`;
- failed or incomplete evidence;
- retry reason;
- scope for the next execution round.

Exit paths:

- to `Dispatch Running` for a bounded retry;
- to `Manage Reconciling` when Seedstack must decide whether retry is safe;
- to `Stopped` when retry would exceed scope or authority.

### LS-010: Dispatch Gate Escalate

Dispatch Work has stopped local execution because the work is blocked, unsafe,
ambiguous, too large, or requires user or queue-manager judgment.

Required state:

- local gate result `escalate`;
- escalation reason;
- evidence paths;
- unresolved decision or blocker.

Exit paths:

- to `Manage Reconciling`;
- to `Stopped` when no authorized lifecycle owner can continue.

### LS-011: Manage Reconciling

Seedstack reconciles the Dispatch Work result against current queue state,
adopted scope, acceptance, dirty guards, and follow-up proposals.

Required state:

- fresh queue evidence;
- dispatch result;
- accepted or rejected local evidence;
- manage decision candidate.

Exit paths:

- to `Manage Close`;
- to `Manage Retry`;
- to `Manage Escalate`;
- to `Stopped` when queue state is dirty, stale, malformed, or outside scope.

### LS-012: Manage Close

Seedstack has decided the queue item may close after a reconciled local dispatch
completion. Close remains a queue action owned by Seedstack through the queue
CLI.

Required state:

- manage terminal decision `close`;
- accepted local dispatch `done`;
- no unresolved acceptance for the same seed;
- authorized queue close path.

Exit paths:

- to `Knowledge Capture Pending`;
- to `Run Continuing` when the run loop has more ready work after close;
- to `Run Terminal Done` when close satisfies run completion.

### LS-013: Manage Retry

Seedstack has decided the same work item needs another bounded dispatch round.
This is nonterminal for the queue and for the run loop.

Required state:

- retry reason;
- revised dispatch scope or unchanged scope confirmation;
- retry cap state, if any;
- queue state still in adopted scope.

Exit paths:

- to `Dispatch Ready`;
- to `Stopped` when retry cap, dirty state, or scope risk blocks continuation.

### LS-014: Manage Escalate

Seedstack has decided the queue item or run cannot safely proceed without an
operator decision, dependency repair, split, follow-up, or accepted stop
disposition.

Required state:

- manage terminal decision `escalate`;
- escalation reason;
- affected queue item or run scope;
- proposed safe next action, when known.

Exit paths:

- to `Knowledge Capture Pending` after a resolved escalation or accepted stop
  disposition;
- to `Stopped` when no resolution is authorized.

### LS-015: Knowledge Capture Pending

Capture Knowledge evaluates whether the completed or stopped lifecycle produced
durable, specific, non-duplicative knowledge.

Required state:

- capture point: manage-reconciled close, resolved escalation, accepted stop
  disposition, or run terminal done;
- candidate knowledge, if any;
- existing knowledge store evidence when available.

Exit paths:

- to `Knowledge Recorded`;
- to `Knowledge None Qualified`;
- to `Stopped` only when capture tooling itself is the requested work and fails.

Absence of a qualified record is not a work failure.

### LS-016: Knowledge Recorded

Capture Knowledge accepted and wrote a durable knowledge record through its
own gate and storage mechanism.

Required state:

- capture state `recorded`;
- record id or write evidence;
- capture audit.

Exit paths:

- to `Run Continuing`;
- to `Run Terminal Done`;
- to `Stopped` for non-run contexts.

### LS-017: Knowledge None Qualified

Capture Knowledge evaluated the work and found no durable record to write, or
the knowledge store was missing and recording was not required.

Required state:

- capture state `none_qualified`, `store_missing`, or `skipped_user_waived`;
- short rationale.

Exit paths:

- to `Run Continuing`;
- to `Run Terminal Done`;
- to `Stopped` for non-run contexts.

### LS-018: Run Continuing

Seedstack run mode has completed one dispatch/manage cycle and may select the
next ready item within the adopted run scope.

Required state:

- updated run state;
- previous manage decision;
- loop counters and caps;
- fresh queue readiness evidence.

Exit paths:

- to `Ready Selected`;
- to `Run Terminal Done`;
- to `Run Terminal Exhausted`;
- to `Run Terminal Blocked`;
- to `Run Terminal Escalated`;
- to `Run Terminal Loop Cap`.

## Terminal States

### Dispatch Terminals

Dispatch terminal states are local to one bounded work item:

- `Dispatch Gate Done`
- `Dispatch Gate Retry`
- `Dispatch Gate Escalate`

They report `done`, `retry`, or `escalate`. They do not close queue records.

### Manage Terminals

Manage terminal states are Seedstack decisions for a reconciled queue item:

- `Manage Close`
- `Manage Escalate`

`Manage Retry` is a manage decision but not terminal for the queue lifecycle.

### Run Terminals

Run terminal states are exclusive outcomes for a Seedstack run:

- `Run Terminal Done`: all adopted work for the run reached accepted completion.
- `Run Terminal Exhausted`: no ready work remains within scope.
- `Run Terminal Blocked`: selected or required work is blocked.
- `Run Terminal Escalated`: a queue, dispatch, manage, or operator escalation
  stops the run.
- `Run Terminal Loop Cap`: the run stopped at its configured loop cap.

Run terminal states report overall run state only. They do not replace dispatch
or manage vocabulary.

## Stop States

`Stopped` is a safety stop used when the current lifecycle owner cannot
continue. Stop reasons include:

- dirty queue baseline before auto dispatch;
- dirty unexpected repo paths outside the allowed implementation scope;
- stale readiness snapshot;
- no-ready deadlock in the adopted queue scope;
- malformed work order, packet, child status, or gate artifact;
- missing required gate evidence;
- retry cap reached;
- loop cap reached;
- ambiguous owner or missing authority;
- user decision required;
- queue mutation required but not authorized.

Stop state preserves evidence and waits for Seedstack or the user to choose a
safe next action.

## Retry Paths

Dispatch retry returns to `Dispatch Running` only when the next round is still
bounded to the same work item and accepted by the dispatcher.

Manage retry returns to `Dispatch Ready` after Seedstack confirms that queue
state, scope, and retry caps allow another local execution round.

Run retry is not its own terminal state. A run continues by moving from
`Run Continuing` to `Ready Selected`, or stops with one run terminal outcome.

Retries must preserve:

- original queue scope unless Seedstack explicitly changes it;
- dirty baseline and unrelated user changes;
- evidence for why another round is needed;
- separation between Dispatch Work local retry and Seedstack manage retry.

## Queue Baseline Rule

Before automatic run dispatch, Seedstack must establish a clean queue baseline
for `.seeds/**` queue state. Existing dirty queue paths stop the lifecycle until
the operator commits, reverts, or resolves them through the authorized queue
flow.

Knowledge capture state may be excluded only when the active run policy allows
that exclusion. The exclusion does not let Dispatch Work mutate `.seeds/**`.

Queue baseline evidence is state evidence, not an implementation artifact.
Dispatch Work may read it as context but must not repair it.

## Deferred Hardening

Draft v0 does not define machine-readable state schemas, transition guards,
conformance cases, or a Quint model. Those belong to future hardening work after
the prose state vocabulary is accepted.
