# SeedSpec Example

Use this reference when decomposing SeedSpec work or similar spec-driven,
multi-implementation projects.

## Source Order

SeedSpec authority:

1. `spec/glossary.md`
2. `spec/decisions.md`
3. numbered clauses in `spec/*.md`
4. `spec/schemas/*.json`
5. `spec/conformance/cases/*.yaml`
6. `spec/quint/*.qnt`
7. `docs/`

Plan dependency edges in the same direction. If behavior is new or ambiguous,
create a `decision` seed before spec/conformance/code seeds.

work queue CLI cannot create caller-chosen issue IDs or issue slugs. Use
`network_slug` and `seed_slug` only as plan handles. If creating seeds, use
titles and optional labels for human grouping.

## Common Seed Families

### Quick Bug Fix

Use for implementation behavior already covered by spec.

```text
N1 [impl,<lang>,<boundary>] fix bug
N2 [review,verification] verify bug fix against source refs
```

Acceptance:

- local regression test fails before fix and passes after
- existing conformance stays green when public behavior is affected
- gate types: `unit` or `integration`, plus `conformance` if protocol-visible

### Protocol Behavior Change

Use when observable SeedSpec meaning changes.

```text
N1 [decision] decide intended behavior
N2 [spec] update clauses/schema
N3 [model] update Quint invariant, if state/graph behavior
N4 [conformance] add focused case
N5 [impl,<lang>,<boundary>] implement behavior
N6 [review,source-precedence] attack spec/conformance grounding
N7 [docs] update workflow/implementation guide, if needed
```

Edges:

```text
N1 -> N2 -> N4 -> N5 -> N6 -> N7
N2 -> N3 -> N4
```

### Full Implementation Port

Use for a new language implementation. Keep ports independent unless one is
declared reference. Each implementation seed owns local tests and targeted
gates for its boundary; final conformance is an aggregate gate, not the first
proof that behavior works.

The `R1` discovery seed below is optional. Prefer resolving source mapping and
sizing during planning; include `R1` only when source authority, blast radius,
or verification remains unresolved after planning research. When planning is
settled, start with the scaffold/foundation seed and renumber.

```text
R1 [discovery] source map + language slice plan, only if planning left unknowns
R2 [impl,<lang>,cli] tooling + dispatch + envelopes + errors + help
R3 [impl,<lang>,validation] types + validation + deterministic id/time
R4 [impl,<lang>,storage] discovery + config parser + init
R5 [impl,<lang>,storage] JSONL read/write + unknown-field preservation
R6 [impl,<lang>,safety] path/symlink/non-regular primitives + non-graph health
R7 [impl,<lang>,lock] lock + atomic mutate harness + changed:false no-rewrite
R8 [local-test,<lang>] foundation cleanup + test-hardening checkpoint
R9 [impl,<lang>,command] create + early init/create smoke
R10 [impl,<lang>,command] update fields + labels
R11 [impl,<lang>,lifecycle] status lifecycle + close/release
R12 [impl,<lang>,graph] graph helpers + graph health + dep list/projection
R13 [impl,<lang>,command] dep add/remove mutation
R14 [impl,<lang>,query] list/ready/blocked ordering + labels
R15 [impl,<lang>,ready] ready selection atomic readiness
R16 [impl,<lang>,cli] option syntax and usage parity
R17 [conformance,<lang>] full-run integration
R18 [review,source-precedence] protocol behavior
R19 [review,test-quality] PBT/model/raw-stutter oracle quality
R20 [review,safety] storage/lock/path safety
R21 [cleanup,<lang>] simplify LLM-generated code and tests after review fixes
R22 [local-test,mutation,<lang>] mutation-test critical helpers, if hardening
R23 [docs,<lang>] guide sync
R24 [release,<lang>] full gates
```

Suggested edges:

```text
R1 -> R2,R3 when R1 exists
R2 -> R3 -> R4 -> R5 -> R6 -> R7 -> R8 -> R9 -> R10
R9 -> R11
R6 -> R12
R11,R12 -> R13
R12 -> R14
R11,R14 -> R15
R13,R15 -> R16
R10,R16 -> R17
R17 -> R18,R19,R20
R18,R19,R20 -> R21
R21 -> R22
R21,R22 -> R23
R17,R18,R19,R20,R21,R22,R23 -> R24
```

Split any implementation seed estimated above 1200 LOC or touching more than
eight files. Comfortable implementation seeds are often 300-800 LOC, but the
executor can handle larger coherent slices. Hard split above 1500 LOC unless
the user asks for a large seed.

Testing rides with the owner seed:

- parser/config/JSONL PBT belongs with `R3`, `R4`, or `R5`
- path and raw storage stutter tests belong with `R6`, `R8`, or `R9`
- lifecycle model-refinement traces belong with `R11` and `R15`
- graph/readiness/cycle PBT belongs with `R13` and `R14`
- dependency no-op/error raw stutter belongs with `R16`
- early init/create smoke belongs with `R9`
- full conformance belongs with `R17`
- mutation testing belongs with `R22` only when hardening critical helpers or
  LLM-generated tests; skip it for early feature construction

Review/fix guidance:

- For broad LLM-generated implementation work, plan at least two critical
  review-fix iterations after `R17`: source/protocol and test/safety.
- Add a third review when storage/path/locks, lifecycle/dependencies,
  conformance runner, or generated test oracles changed.
- `R21` cleanup is a milestone seed, not a fixed tax. Keep it when reviews find
  duplication, brittle tests, dead abstractions, unclear names, or test helpers
  that mirror the implementation too closely.
- `R22` mutation testing is optional hardening. Keep it focused on pure helpers,
  validators, graph/state logic, and safety-sensitive branches.
- Network changes are expected. Checkpoints may split oversized seeds, add
  follow-up bugs, change dependency edges, or record accepted risk.

## SeedSpec Slice Heuristics

- `logic.md` or `state.md` touched -> invariant or lifecycle seed.
- `io.md` or `errors.md` touched -> CLI/envelope/error seed.
- `storage.md` touched -> fixture/file/lock/path seed.
- `decisions.md` touched -> coordination seed before code.
- `spec/schemas/**` touched -> schema gate plus conformance fixture.
- `spec/conformance/cases/**` touched -> test-quality review seed.
- `spec/quint/**` touched -> model replay or invariant gate.
- `docs/implementation/<lang>.md` touched -> docs-sync seed after code.

## Model Boundaries

For SeedSpec, use Quint for lifecycle, dependency, readiness, selection, and path
classification abstractions. Do not add model seeds for CLI parsing, JSON
schemas, storage bytes, lock timing, timestamps, `changed:false`, or
auto-selection ordering unless a current model explicitly owns that behavior.

Use conformance for CLI/storage/IO/schema-visible behavior. Use local tests and
PBT for implementation mechanics and pure helper invariants.

## SeedSpec Gates

Use exact gates from `AGENTS.md` when current. Common examples:

- spec schemas/conformance metadata: `just check`
- conformance runner: from `spec/conformance/runner`, `bun run check`,
  `bun run typecheck`, `bun run test:smoke`
- implementation seeds: run language/tool gates from the seed's declared
  `area` path, treated as an opaque repo-relative directory or scope.
- Do not infer roots such as `impl/ts`, `impl/python`, `impl/rust`, or
  `impl/go` from label spelling, language name, or historical convention
  unless the seed explicitly names that area.
- Examples of gate shapes once rooted at the declared area: TypeScript may use
  `bun test`, `bun run lint`, and `bun run typecheck`; Python/Go may use
  `make check` or `make conformance`; Rust may use format, clippy, tests, and
  conformance runner commands.

Gate entries should name test type and command/review:

```yaml
gates:
  - type: unit
    command: bun test tests/logic.property.test.ts
  - type: pbt
    command: bun test tests/logic.property.test.ts
  - type: conformance
    command: bun ../../spec/conformance/runner/bin/seedspec-conformance.mjs --impl "bun $(pwd)/src/index.ts"
  - type: review
    command: read-only review, lens=test-quality-pbt-model-raw-stutter
  - type: mutation
    command: targeted mutation run for validation/graph helpers
```

## Bad Splits

- one seed for "implement SeedSpec"
- one seed mixing decision, conformance, and multiple language ports
- one late seed for PBT, model replay, raw stutter, and miscellaneous tests
- docs seed blocking behavior work
- conformance seed without governing clause/decision/schema ref
- full conformance seed used as substitute for per-boundary targeted gates
- implementation seed without local or conformance gate
- mutation testing as a default early gate for every seed
- model seed for CLI parsing, JSON schema, storage bytes, locks, timestamps,
  or ordering that Quint intentionally excludes
- review seed without named lens and target files
