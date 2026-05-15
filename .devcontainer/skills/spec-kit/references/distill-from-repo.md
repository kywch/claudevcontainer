# Distill Spec From Existing Repo

## Inventory First

Build read-only maps:

- public surface: CLI commands, API routes, exported packages, file formats
- persisted state: schemas, migrations, storage layout, config
- state transitions: lifecycle, graph edits, locks, retries, background jobs
- tests: unit, integration, fixtures, property tests, golden outputs
- docs: README, guides, ADRs, comments with product intent
- error surfaces: codes, messages, status codes, exit codes
- portability assumptions: filesystem, env, process, network, encoding

Use subagents when available:

- surface map: commands/APIs/files and user-visible behavior
- state map: lifecycle, invariants, transitions, persistence
- test map: coverage, fixture quality, weak oracles, missing negatives
- risk map: bugs, undefined behavior, portability, safety, concurrency

Subagents are read-only and should return file:line evidence.

## Reverse-Spec Rules

- Existing behavior is evidence, not law.
- Copy boring behavior only when safe, in scope, and language-neutral.
- Correct unsafe, accidental, or unclear behavior through decisions.
- Defer features that are present but outside the spec line.
- New protocol meaning needs decision before conformance or port work.

Classify every discovered slice as `copy`, `correct`, `defer`, or `new`.

## Trace Code

Trace from public entry points to persistence/output:

```text
entry point
  -> parse/validate
  -> load/discover state
  -> compute transition
  -> write/commit
  -> output/error
```

Record:

- observable behavior
- hidden assumptions
- failure branches
- state mutation point
- whether rejected/no-op paths mutate raw storage
- test evidence or absence

If behavior differs by implementation or test, stop and capture a decision.

## Extract Conformance

Seed conformance from:

- existing integration tests that call public surface
- golden fixtures and snapshot-like outputs
- bug regression tests with clear observable behavior
- model traces for lifecycle/graph behavior

Reject weak cases:

- only mirror implementation internals
- assert broad subsets when exactness matters
- depend on incidental object key order or runtime error prose
- use fake runner success as protocol proof

## Quint Modeling

Use Quint when repo has:

- lifecycle state
- dependency graph
- readiness/eligibility predicates
- concurrency, locks, retry, stale state, or claim/reservation
- terminal/immutable states

Keep model abstract. Actions should match public operations, not helper
functions. Replay counterexamples against real implementation before changing
spec.

## v0 From Repo

Output:

- source inventory with evidence
- ambiguity/bug list needing decisions
- initial glossary and decisions
- numbered clauses that describe intended behavior
- conformance cases from observable behavior
- minimal model if stateful
- implementation guide naming which code is reference evidence only
