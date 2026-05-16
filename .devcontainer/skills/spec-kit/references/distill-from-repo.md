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

Use read-only subagents when available to protect the main agent's context
budget:

- surface map: commands/APIs/files and user-visible behavior
- state map: lifecycle, invariants, transitions, persistence
- test map: coverage, fixture quality, weak oracles, missing negatives
- risk map: bugs, undefined behavior, portability, safety, concurrency

Subagents are read-only and should return concise findings with file:line
evidence. Do not ask subagents to edit product code during distillation.

## Reverse-Spec Rules

- Existing behavior is evidence, not law.
- Copy boring behavior only when safe, in scope, and language-neutral.
- Correct unsafe, accidental, or unclear behavior through decisions.
- Defer features that are present but outside the spec line.
- Exclude behavior that is implementation-specific, unsafe, accidental, or
  tempting to copy but not part of the intended contract.
- New protocol meaning needs decision before conformance or port work.

Classify every discovered slice as `copy`, `correct`, `defer`, `new`, or
`exclude`.

Core clauses must not mention source language classes, functions, or modules
unless those names are portable public API or compatibility surface. Source
language facts belong in `spec/implementation/<language>.md` or `spec/compat.md`.

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

## Self-Sufficient Distill

For reimplementation targets, `spec/` must be sufficient to implement behavior
without opening source files. Source refs prove provenance only; they must not
carry required behavior.

Create `spec/traceability.md` from the first pass unless explicitly deferred for
a tiny one-implementation draft. Use:

```text
clause_id | source_id | source file:line/symbol | observed fact | tests/fixtures | decision | schema/case/model | status | disposition
```

If an implementer must read source to learn accepted inputs, defaults, field
types, transitions, errors, artifact shapes, paths, env/process behavior, or
conformance expectations, the normative spec is incomplete.

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
functions. Canonical models require a negative control that violates a named
externally observable invariant before green results count as evidence. Replay
counterexamples against sandbox or explicitly approved implementation code before
changing spec.

## Executable Validation

Do not modify product implementation code during distillation unless the user
explicitly asks for implementation changes. Put executable probes, reference
snippets, conformance runner experiments, and target-language portability checks
under `tmp/spec-kit/<slug>/`.

Sandbox findings are evidence only. Promote any durable behavior into decisions,
clauses, schemas, conformance cases, or canonical models before handoff.

## v0 From Repo

Output:

- source inventory with evidence
- ambiguity/bug list needing decisions
- initial glossary and decisions
- numbered clauses that describe intended behavior
- `spec/traceability.md` or explicit deferral
- self-sufficiency pass/fail status
- conformance cases from observable behavior
- minimal model if stateful
- implementation guide naming which code is reference evidence only
