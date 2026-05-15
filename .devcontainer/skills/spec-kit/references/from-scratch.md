# Create Spec From Scratch

## Intake

Start from a few sentences. Extract:

- domain object nouns
- user-visible commands/APIs/workflows
- lifecycle states and terminal states
- data that crosses a boundary
- irreversible or safety-sensitive operations
- concurrency, ordering, locking, retries, time, randomness
- compatibility and migration expectations
- non-goals

Ask concise decision questions in batches. Prefer questions that split behavior:

```text
Decision needed: when X happens, should system A, B, or reject?
Why it matters: affects conformance, data model, and compatibility.
Default if no preference: B, because ...
```

Do not ask for wording preferences until behavior is clear.

## Grill Sequence

1. Purpose: what problem, who consumes output, what must interoperate?
2. Surface: CLI/API/files/protocol/events; success/error envelope shape.
3. State: entities, lifecycle, transitions, terminal states, no-ops.
4. Data: required/optional fields, unknown fields, schema versions.
5. Ordering: stable sort keys, tie-breakers, determinism.
6. Failure: invalid input, corrupt state, partial writes, retries, locks.
7. Safety: path/env/network/secrets/destructive operations.
8. Scope: explicit non-goals and future triggers.
9. Tests: smallest behavior set that proves the contract.
10. Models: state machine, graph, or concurrent rules worth modeling.

## v0 Output

Create:

- `spec/README.md`: status, scope, source precedence, reading order.
- `spec/glossary.md`: canonical terms and banned synonyms.
- `spec/decisions.md`: accepted decisions from grilling.
- one numbered behavior file, such as `spec/behavior.md`.
- `spec/decision-index.md` only when decisions become hard to scan.
- schemas only for boundary data.
- conformance cases only when observable behavior needs executable evidence.
- first Quint model only when state/graph/concurrency exists.
- `spec/workflow.md` only when the kit must carry its own change/review loop.
- `spec/implementation-guide.md`: non-normative implementation guidance, when
  useful.

## Minimal Conformance

Pick cases that would catch an incompatible implementation:

- one successful end-to-end workflow
- one rejected command/request
- one malformed persisted/input object
- one no-op or duplicate action, if no-ops exist
- one ordering/determinism case, if ordering matters

Each case must cite a clause, schema, or decision. If no citation exists, write
the decision/spec first.

## Sandbox Iteration

Use sandbox or thin implementation to discover missing decisions:

```text
write narrow implementation
  -> run conformance
  -> local tests expose ambiguity
  -> capture decision
  -> update spec/schema/conformance/model
  -> rerun
```

Do not let sandbox behavior become normative without decision/spec capture.
