# Work Lifecycle Decisions

Status: draft v0.

This file records source inventory and early authority decisions for the work
lifecycle spec. It is intentionally limited to inventory, scope, ownership, and
deferrals for the first draft. Later files may add behavior clauses, state
interfaces, traceability, schemas, conformance cases, or Quint models only when
their own work items approve that scope.

## Draft Boundary

Draft v0 describes how existing work lifecycle sources relate to each other.
It does not create a new queue engine, replace Seeds CLI behavior, change any
Seedstack or Dispatch Work command flow, or mutate `.seeds/` state.

Normative force in v0 is limited to decisions in this file:

- which sources are considered evidence;
- which repository root will hold the normalized spec kit;
- which system owns each lifecycle responsibility;
- which subjects are deferred out of v0.

Draft v0 is not a release protocol. It is a source map and decision record that
later lifecycle spec files can rely on without reopening basic authority
questions.

## Source Inventory

### S1: Spec Kit

Source: `.devcontainer/skills/spec-kit/SKILL.md`.

Spec Kit defines the shape of durable specs. It recommends starting minimal
with README, glossary, decisions, and behavior before adding schemas,
conformance, state models, or implementation guides. It also defines source
precedence inside a normalized spec: glossary, decisions, numbered clauses,
schemas, conformance cases, canonical Quint/state models, and implementations
as evidence.

For this lifecycle work, Spec Kit is the source for spec structure and maturity
flow. It is not the source of queue semantics.

### S2: Seedstack

Source: `.devcontainer/skills/seedstack/SKILL.md` and referenced Seedstack
materials.

Seedstack manages the work order lifecycle around Dispatch Work. It owns
planning, work-order graph shape, ready queue selection, closing queue records,
follow-up creation, dependency and label changes, and run-loop control. It also
separates graph mutation from read-only operator subagents.

Seedstack is source evidence for orchestration semantics and ownership
boundaries. It is not source evidence for local implementation details inside a
single dispatched work item.

### S3: Dispatch Work

Source: `.devcontainer/skills/dispatch-work/SKILL.md` and Dispatch Work
references.

Dispatch Work owns one bounded work item. It normalizes a work order, performs
research, builds a packet, launches Execute and Verify roles, writes artifacts,
and gates the local result as exactly one of `done`, `retry`, or `escalate`.
It explicitly must not mutate queue state or `.seeds/**`.

Dispatch Work is source evidence for one-work-item execution, artifact gates,
child-agent boundaries, report formats, and the local terminal vocabulary.

### S4: Capture Knowledge

Source: `.devcontainer/skills/capture-knowledge/SKILL.md`.

Capture Knowledge owns durable knowledge recording. Its storage target is
`.seeds/knowledge.jsonl`, one JSONL record per line, and mutating commands are
separate from normal Dispatch Work execution. It evaluates whether completed
work produced specific, durable, non-duplicative knowledge worth preserving.

Capture Knowledge is source evidence for post-dispatch learning. It does not
own queue close decisions, dispatch gates, or spec promotion.

### S5: Seeds CLI

Source: upstream Seeds CLI at commit
`d270b13e3563c2cd76edb38437567fa9accb43f1`.

Seeds CLI is a git-native issue tracker backed by JSONL state. Its README
describes `.seeds/` initialization, issue creation, listing, readiness, update,
close, dependency, label, plan, template, config, sync, and health commands.
Every command supports JSON-oriented output for structured consumers.

Seeds CLI is the foundation for queue state. It is not replaced by this spec.

### S6: `.seeds/` State Surfaces

Observed local state surfaces:

- `.seeds/issues.jsonl`
- `.seeds/plans.jsonl`
- `.seeds/templates.jsonl`
- `.seeds/config.yaml`
- `.seeds/.gitattributes`
- `.seeds/.gitignore`

For draft v0, `.seeds/issues.jsonl` is the primary issue queue surface because
Seedstack and Dispatch Work packets refer to Seeds issues and work orders. Plan
and template files are evidence for larger planning flows, but they are not
fully specified in this v0 decision file.

### S7: Seeds Issue Fields

Source: upstream Seeds CLI `src/types.ts`.

Observed issue fields include:

- `id`
- `title`
- `status`
- `type`
- `priority`
- `assignee`
- `description`
- `closeReason`
- `blocks`
- `blockedBy`
- `labels`
- `convoy`
- `plan_id`
- `plan_step_index`
- `requires_plan`
- `extensions`
- timestamps for created, updated, and closed state

Observed status values are `open`, `in_progress`, and `closed`. Observed issue
types are `task`, `bug`, `feature`, and `epic`.

Draft v0 treats these fields as the observable vocabulary Seedstack depends on.
It does not define JSON schemas for them.

### S8: Readiness Semantics

Source: upstream Seeds CLI `src/commands/ready.ts` and README command
descriptions.

Readiness means open work whose unresolved blockers are closed, with extra
planning behavior around draft or approved sub-plans. Issues requiring a plan
are hidden from readiness until their own sub-plan is no longer draft; draft
plans can also surface planning work as ready. Filters and scheduling can
further narrow ready output.

Draft v0 records readiness as queue selection evidence for Seedstack. It does
not promote every ready-command flag into lifecycle law.

## Accepted Decisions

### D1: Use `.spec/work-lifecycle/` As Spec Root

Decision: normalized lifecycle spec files live under `.spec/work-lifecycle/`.

Rationale: repository work asks for a spec under `.spec`, while Spec Kit
examples use `spec/` as an abstract root. `.spec/work-lifecycle/` keeps this
protocol separate from runtime code, queue state, and skill implementation
files.

Implication: future lifecycle files must be added under `.spec/work-lifecycle/`
unless a later accepted decision supersedes D1.

### D2: Treat Seeds CLI As Queue Foundation

Decision: Seeds CLI remains the foundation for queue state and issue fields.

Rationale: Seedstack explicitly manages work orders through a queue CLI, and
local state already exists in `.seeds/issues.jsonl`. Re-specifying or replacing
Seeds storage in v0 would exceed the source inventory scope and risk divergence
from actual commands.

Implication: lifecycle clauses may describe how Seedstack uses Seeds state, but
they must not redefine Seeds CLI storage or command behavior without a future
hardening decision.

### D3: Separate Seedstack From Dispatch Work

Decision: Seedstack owns graph and queue lifecycle. Dispatch Work owns execution
of one bounded work item.

Rationale: both skills state this separation directly. Blending the roles would
make local `done|retry|escalate` gates ambiguous with queue close, retry,
follow-up, and run-loop decisions.

Implication: future behavior clauses must preserve separate terminal
vocabularies for Dispatch Work local gates and Seedstack queue management.

### D4: Keep Capture Knowledge Outside Completion Gates

Decision: Capture Knowledge is evaluated after meaningful work, but knowledge
recording is separate from work completion.

Rationale: Capture Knowledge records durable lessons when they pass a strict
gate. Absence of a qualifying record should not make a completed dispatch fail.

Implication: future lifecycle clauses may require the capture gate to be
considered, but they must not require a `.seeds/knowledge.jsonl` append for
every successful work item.

### D5: Preserve `.seeds/**` Ownership Boundaries

Decision: draft spec work must not mutate `.seeds/**`.

Rationale: `.seeds/` is live queue state. Seedstack may mutate it only through
the queue CLI when running manage or run flows, and Capture Knowledge owns only
its append-only knowledge record path through its own tool. Inventory work has
no reason to change queue state.

Implication: this draft may read `.seeds/` for evidence but cannot use direct
file edits as a lifecycle operation.

### D6: Version v0 As Draft Inventory, Not Protocol Release

Decision: v0 is a draft inventory and decision layer only.

Rationale: source precedence, ownership, and deferrals must be clear before
numbered behavior, state transitions, schemas, tests, and models can be made
self-sufficient.

Implication: no implementation, agent, or operator should treat this file alone
as complete lifecycle conformance.

### D7: Use Sources As Evidence Until Normalized Clauses Exist

Decision: skill docs and upstream Seeds refs remain evidence until later spec
files normalize behavior into accepted decisions and numbered clauses.

Rationale: Spec Kit advises preserving existing docs and code as evidence while
normalizing output into a spec kit. Directly importing every source sentence
would make the draft brittle and too broad.

Implication: future files should cite these sources for provenance but carry
their own self-contained behavior where the lifecycle protocol depends on it.

## Ownership Boundaries

Seedstack owns:

- planning and work DAG formation;
- ready queue selection;
- queue close, retry, dependency, label, priority, and follow-up decisions;
- run-loop state and loop caps;
- queue mutation through Seeds CLI when authorized by the flow.

Dispatch Work owns:

- one bounded work order;
- work-order normalization and packet creation;
- research, implementation, review, verify, and local gate artifacts;
- local `done`, `retry`, or `escalate` decision;
- no queue mutation.

Capture Knowledge owns:

- durable knowledge gate evaluation;
- `.seeds/knowledge.jsonl` append, remove, or rewrite through its tool;
- no queue close, dispatch gate, or spec promotion.

Spec Kit owns:

- normalized spec kit structure;
- authority and maturity guidance for spec artifacts;
- decisions, glossary, behavior, schemas, conformance, and Quint placement;
- no runtime queue state.

Seeds CLI owns:

- `.seeds/issues.jsonl` issue persistence;
- `.seeds/plans.jsonl` plan persistence;
- command behavior for `sd ready`, `sd list`, `sd update`, `sd close`, deps,
  labels, plan, template, config, doctor, and sync surfaces;
- readiness semantics as observable command behavior.

## Deferrals

Draft v0 defers:

- numbered lifecycle behavior clauses;
- glossary terms beyond names needed in this decision file;
- state-machine definitions for open, in-progress, closed, retry, escalation,
  blocked, exhausted, loop-cap, and stop states;
- formal interface definitions for work order, packet, dispatch gate, manage
  decision, run state, seed card, and knowledge record;
- JSON schemas for Seeds issue fields or lifecycle handoff objects;
- conformance cases for command behavior, artifact validation, and lifecycle
  transitions;
- Quint promotion or canonical model traces;
- implementation guidance for TypeScript, shell, or agent wrappers;
- migration or compatibility policy for future protocol versions.

These deferrals are intentional. Future work may add them under
`.spec/work-lifecycle/` with explicit decisions or numbered clauses.

## Open Decisions

### OD1: Draft v0 Completeness

Open: which later file declares draft v0 self-sufficient enough for readers to
understand the protocol without opening skill sources?

Current stance: not this file. Traceability and behavior work should decide the
self-sufficiency bar.

### OD2: Future Schemas

Open: which lifecycle objects need JSON schemas?

Current stance: defer schemas until state and interface prose stabilizes.
Likely candidates include Seeds issue fields, work order, packet, dispatch
gate, manage decision, run state, and knowledge record.

### OD3: Future Conformance

Open: which observable behaviors require conformance cases?

Current stance: defer conformance until numbered behavior clauses exist. Likely
cases include happy path, retry, escalation, stale snapshots, dirty queue state,
dispatch queue mutation rejection, terminal exclusivity, and no-op knowledge
capture.

### OD4: Quint Promotion

Open: when should lifecycle state become a canonical Quint model?

Current stance: defer Quint promotion until state transitions and terminal
vocabulary are stable. Exploratory models may inform review, but canonical
Quint should not outrank draft prose until explicitly promoted.

### OD5: Seeds CLI Drift

Open: how should this spec track future Seeds CLI changes?

Current stance: v0 pins evidence to the source refs used for inventory. Later
promotion work should decide whether to track a commit, version, or command
contract.

## Non-Goals

This file does not:

- run Seedstack;
- run Dispatch Work beyond this assigned artifact;
- call Seeds CLI mutation commands;
- close or update any issue;
- append `.seeds/knowledge.jsonl`;
- create schemas, conformance cases, or Quint files;
- promote draft v0 to release status.
