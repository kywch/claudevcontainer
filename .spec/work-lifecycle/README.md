# Work Lifecycle Spec

Status: draft v0.

This spec kit describes the work lifecycle around Seeds issues, Seedstack,
Dispatch Work, and knowledge capture. It is a draft normalization layer, not a
release protocol and not a replacement for live tooling.

Draft status: spec work for this draft performed no Seeds issue creation,
dispatch, run-loop execution, or `.seeds/**` mutation.

## Authority Order

When lifecycle sources disagree, use this order:

1. Definitions in `glossary.md`.
2. Accepted decisions in `decisions.md`.
3. Numbered behavior clauses in `behavior.md`.
4. Future schemas, conformance cases, and canonical models only after a later
   work item explicitly promotes them.
5. Source documents, implementation evidence, and runtime observations from
   `.seeds/` or command output.

Future schemas, conformance cases, and canonical models have no authority in
draft v0 because they do not exist in this spec kit. Current state, interface,
and traceability files support the draft but do not outrank glossary,
decisions, or numbered behavior clauses.

## Source Precedence

`decisions.md` records source inventory and accepted ownership decisions.
`behavior.md` may summarize lifecycle behavior, but it must stay within the
boundaries accepted there. `glossary.md` defines shared terms for readers and
does not override accepted decisions.

If a source document is more specific than this draft, treat the source as
evidence until a later accepted decision or behavior clause normalizes it.

## Relationship To `.seeds/`

`.seeds/` is live queue state owned by Seeds CLI and flows that are authorized
to use it. This draft may refer to `.seeds/` as evidence, but spec authoring
must not edit `.seeds/**`, close issues, mutate dependencies, append knowledge,
or run queue management as part of this skeleton.

Capture Knowledge may write `.seeds/knowledge.jsonl` only through its own gate
and tool. Dispatch Work must not mutate `.seeds/**`.

## Draft Scope

Draft v0 includes only:

- `README.md`
- `decisions.md`
- `glossary.md`
- `behavior.md`
- `state.md`
- `interfaces.md`
- `traceability.md`

Draft v0 intentionally does not include schemas, conformance cases, Quint
models, release versioning, or executable promotion artifacts.

## v1 Hardening Backlog

The v1 hardening backlog must be completed before this draft can be considered
for promotion:

- schemas: define machine-readable contracts for Seeds issues, readiness
  evidence, seed cards, dispatch work orders, dispatch packets, local gates,
  manage decisions, run terminal reports, knowledge records, and capture audits.
- conformance: add executable cases for owner selection, dirty queue guards,
  readiness rejection, dispatch handoff validation, terminal exclusivity,
  `done` not closing Seeds issues, retry bounds, escalation disposition,
  follow-up nonterminal behavior, and no-op knowledge capture.
- errors and IO clauses: specify command inputs, outputs, exit/status behavior,
  rejection codes, operator messages, recovery paths, and artifact paths for
  Seeds CLI, Seedstack, Dispatch Work, and Capture Knowledge boundaries.
- Quint model: model lifecycle transitions, graph and queue guards, terminal
  exclusivity, retry loops, escalation stops, loop caps, and capture timing.

## v0 Review Disposition

Review disposition for v0 risks:

- accepted: draft v0 is prose-only and source-backed; it may describe ownership
  boundaries, local terminal vocabulary, and high-level lifecycle order.
- deferred: schemas, conformance cases, exact errors or IO clauses, command
  contracts, artifact contracts, and the Quint model remain v1 hardening
  backlog work.
- user decision before promotion: promotion requires explicit approval for
  scope, source authority, schema surface, conformance coverage, model coverage,
  and any release label or version boundary.
