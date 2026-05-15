# Labels and Edge Rules

## Labels

Labels are metadata and do not enforce behavior. Use them to make the network
searchable and to cue dispatch/review posture. Prefer multiple labels over a
single "type".

| label | use when | typical blockers |
| --- | --- | --- |
| `discovery` | sources/files/risks unclear | none |
| `decision` | product intent or protocol meaning unclear | discovery |
| `spec` | normative prose/glossary/schema must change | decision |
| `model` | abstract state, graph, lifecycle, or concurrency invariant matters | spec |
| `conformance` | observable behavior could drift across impls | spec, model if relevant |
| `impl` | code change in one coherent boundary | spec/conformance when protocol-visible |
| `local-test` | implementation mechanic or regression not suited to conformance | impl or before it for TDD |
| `review` | non-trivial slice needs independent read-only attack | impl/conformance |
| `cleanup` | refactor, delete dead code, simplify LLM-generated code | behavior seeds |
| `docs` | durable workflow or implementation guidance changes | behavior seeds |
| `release` | versioning, changelog, packaging, broad gates | all required seeds |

When a `network_slug` is defined, include the shared network label in every
seed's labels array. Do not declare it only in the plan header.

## Edge Rules

Use `blockedBy` edges for true dependencies:

- `decision -> spec/schema -> conformance-case -> implementation` when new
  shared protocol behavior is being defined
- `spec -> model -> conformance` when model owns abstract behavior
- `model -> implementation:<lang>:lifecycle-or-deps` when replay or invariant
  traces must guide implementation
- `implementation:<shared helper> -> implementation:<command>` when command
  needs helper API
- `conformance -> implementation:<lang>` for shared observable behavior
- `implementation:<lang>:boundary -> review:<lens>` for risky boundary work
- `conformance-case -> review:test-quality` for shared conformance changes
- `implementation:<lang>:boundary -> conformance:<lang>:full-run` only when
  the seed is an aggregate gate, not a prerequisite for unrelated boundaries
- `implementation:<lang>:boundary -> docs:<lang>` when docs describe current
  implementation
- `all required seeds -> release`

Do not block parallel implementation ports on each other unless one is a
reference implementation by explicit choice.

Do not add blockedBy edges that are already implied by transitivity. If A
blocks B and B blocks C, do not add A blocks C unless there is a direct
dependency beyond what B mediates.

## Algorithm Edges for Fresh SeedSpec Ports

- `types/validation -> JSONL/config/issue loading`
- `path-safety primitives -> init reserved-file recovery -> health path findings`
- `lock + atomic mutate harness -> create/update/claim/close/dep mutations`
- `graph helpers -> dep add/remove/list`
- `graph helpers -> graph health findings`
- `readiness/order helpers -> ready/blocked`
- `readiness/order helpers + lock harness -> ready selection`
- `deterministic id/time -> create and timestamping mutations`
- command seeds with no-op/error paths -> raw-stutter tests
