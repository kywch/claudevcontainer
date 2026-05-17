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
