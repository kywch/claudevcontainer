---
name: spec-kit
description: "Use to create, reverse-specify, refine, or harden a spec kit for a product/protocol/library: turn rough intent or an existing repo into normative specs, decisions, schemas, conformance tests, Quint/state models, implementation guidance, and iterative review plans."
---

# Spec Kit

## Purpose

Create and refine a durable spec kit: a small source-of-truth system that keeps
product intent, normative behavior, executable tests, state models, and
implementation lessons synchronized.

Use this when the user asks to:

- create a spec from rough intent
- distill a spec from an existing repo
- design conformance for multiple implementations
- model lifecycle/state behavior with Quint
- harden a spec through TypeScript, Rust, Go, or another port
- run review/refinement loops until spec, tests, and code converge

## Core Shape

Do not start from the expanded tree. Start minimal, then add files when the
contract pressure is real. Keep the kit self-sufficient under `spec/`. For
distillation, preserve existing repo docs/formats as evidence, but normalize the
output into this `spec/` layout.
For calibrated examples, inspect `examples/minimal/` or `examples/multi-impl/`
only when needed; do not load examples by default.

Minimal:

```text
spec/
  README.md
  <glossary>.md
  <normative-spec>.md
  <decisions>.md
```

Common once behavior is executable or shared:

```text
spec/
  decision-index.md
  schemas/                    # file/wire/storage shapes and validation contract
  conformance/
    README.md
    case.schema.json
    cases/
  errors.md
  versioning.md
```

Expanded, conditional:

```text
spec/
  logic.md                    # pure rules/predicates outgrow behavior.md
  state.md                    # lifecycle, readiness, terminal states
  storage.md                  # persisted semantics, paths, locks, durability
  io.md                       # CLI/API/env/stdin/stdout/stderr contract
  compat.md                   # legacy API behavior kept for compatibility
  implementation.md           # implementation-neutral obligations only
  conformance/runner/         # shared black-box runner exists
  quint/                      # state/graph/concurrency invariants
  traceability.md             # separate evidence/test matrix earns its keep
  review-ledger.md            # durable review findings for non-trivial loops
  workflow.md                 # portable contributor/agent workflow needed
  implementation-guide.md     # shared porting guidance needed
  implementation-template.md  # repeated new-port scaffold needed
  implementation-research.md  # provenance/audit trail worth preserving
  implementation/
    typescript.md             # active/planned TS port only
    rust.md                   # active/planned Rust port only
    go.md                     # active/planned Go port only
    python.md                 # active/planned Python port only
```

Keep `spec/README.md` as the authority root and keep all kit artifacts under
`spec/`. The authority root may declare project-specific filenames for one
glossary, one or more normative specification modules, and one decisions file.
Larger specs split by numbered clause families, not by implementation.
Per-language files record binding/guidance status for active or planned ports;
they are not alternate sources of protocol truth. Empty future-port files
create drift; do not create them.

Distillation should extract implementation-neutral behavior first. Treat current
code as evidence, not architecture to preserve, unless compatibility requires it.

## Authority And Reading Chain

`spec/README.md` is the required authority root. Its manifest declares the
project's actual file roles and reading order. Filenames, numbering, and domain
splits may vary, but the semantic chain is:

1. glossary: controls the meanings of defined terms
2. normative specification: provides the complete current behavioral contract
   in one or more modules
3. active decisions: records accepted product choices and consequences that are
   not obvious from the clauses
4. schemas in `spec/schemas/`, when present
5. conformance cases in `spec/conformance/cases/`, when present
6. canonical state/model artifacts in `spec/quint/`, when present
7. implementations as evidence only, never as normative source

This chain defines ownership and reading order; it does not silently resolve
contradictions. A conflict among the glossary, normative specification, active
decisions, or another normative artifact is a specification defect. Stop and
repair it through an explicit product decision and aligned artifact updates.

Schemas are normative for structure, validation, and compatibility constraints
they explicitly encode. Conformance cases and canonical Quint/state models are
normative for the behavior they explicitly encode. They must agree with the
semantic chain. Non-normative guidance, examples, research notes, superseded
history, and exploratory models never fill contract gaps.

Active decisions retain normative force but must agree with the glossary and
current normative specification. Prefer a compact `ID | Decision and
consequence` table. Use a detailed decision record only when context, evidence,
or audit needs cannot be represented accurately in one row.

Retain displaced decisions as history rather than deleting or silently
rewriting them. Put them in an explicitly `NONNORMATIVE` superseded-history
section with `ID | Superseded by | Former choice | Current consequence`.
Superseded entries never govern implementation or conformance.

## Mode Selection

Pick one primary mode from the user goal. Add secondary references only for
requested artifacts, except load review lenses for non-trivial spec,
conformance, test, or implementation changes.

| user asks | mode | load |
| --- | --- | --- |
| rough idea to spec, grill me, spec from scratch | Scratch | `references/from-scratch.md` |
| existing repo to spec, reverse spec, distill spec | Distill | `references/distill-from-repo.md` |
| iterate, harden, refine, cross-language work | Iteration | `references/iteration-and-hardening.md` |
| implementation guide, language guide, research notes | Implementation | `references/implementation-docs.md`; load `references/implementation-guide-research.md` only for provenance/audit requests |
| create files/templates only | Templates | `references/artifact-templates.md` |

## Universal Loop

```text
intent or implementation evidence
  -> source inventory and authority conflicts
  -> glossary and numbered normative specification
  -> active decisions
  -> traceability: clause -> evidence file:line -> tests -> status
  -> schemas where data crosses boundary
  -> CLI/API contract for observable invocation and process behavior
  -> language bindings only after contract boundaries are stable enough to port
  -> conformance cases for observable behavior
  -> Quint/state model for lifecycle/concurrency/graph rules when triggered
  -> sandbox/reference implementation only when requested or needed to validate ambiguity
  -> independent reviews
  -> next iteration
```

Classify each slice:

- `copy`: copy existing behavior because it is safe, boring, and in scope
- `correct`: intentionally diverge from existing behavior; capture decision
- `defer`: document out-of-scope behavior and trigger for adding it later
- `new`: define new behavior through decision, spec, tests, model, and code
- `exclude`: observed behavior intentionally not normative because it is
  implementation-specific, unsafe, accidental, or outside the product line

Product intent unclear -> ask for decision before making normative text.
Implementation-only bug -> local regression test first; add conformance only
when other implementations could drift the same observable way.
Accepted product change -> update the governing normative clauses; add the new
active decision; move each displaced decision into superseded history with an
explicit replacement and current consequence; update affected version, schemas,
conformance, models, and implementations. Editorial-only corrections that do
not alter behavior need no product decision.

## Spec Maturation Loop

Do not expect a durable spec in one pass. Treat v0 as a hypothesis, not a
handoff artifact.

For non-trivial spec-kit work, use subagents when available to protect the main
agent's context budget. Keep subagents read-only unless the user explicitly asks
for parallel implementation work. Prefer narrow lenses: source inventory,
state/model, schema, conformance, self-sufficiency, traceability, target
portability, and risk review. Subagents return concise findings with file:line
evidence and no edits.

Repeat until handoff gates pass or remaining gaps are explicit deferrals:

1. Inventory evidence, public surfaces, state, schemas, tests, conflicts, and
   unknowns.
2. Capture decisions for ambiguity and authority conflicts.
3. Update numbered clauses, schemas, errors, boundaries, and deferrals.
4. Add or update conformance cases and Quint models when triggered.
5. Run self-sufficiency, traceability, schema, conformance, model, and target
   gates.
6. Review with narrow lenses.
7. Repair findings by updating decisions, clauses, schemas, cases, or models.
8. Record residual gaps, deferrals, and the next loop target.

Stop only when self-sufficiency passes, authority conflicts are resolved or
deferred, traceability maps important clauses to evidence/tests, schemas cover
active boundaries, conformance/model gates pass or are explicitly deferred,
target-ready gates pass for claimed implementation targets, and review findings
are dispositioned.

Each loop must either improve spec artifacts or record why the gap is deferred.
Do not call a distilled spec ready only because source inventory is complete.

## Self-Sufficiency And Traceability

Spec and traceability have separate jobs: the spec must be implementable without
source files; traceability proves provenance, audit coverage, and drift risk.
Source references never carry required behavior. If an implementer must open
source code, docs, examples, implementation notes, or evidence links to know a
required input, default, state transition, error, artifact shape, path/env/process
rule, or conformance expectation, the normative spec is incomplete.

Before reimplementation handoff, run a self-sufficiency gate:

- accepted inputs, outputs, and artifact shapes are defined in clauses or schemas
- defaults and absent/null/zero/empty behavior are defined at boundaries
- state transitions, terminal states, and no-op/rejection behavior are explicit
- error codes/classes and rejection behavior are stable where observable
- path, env, process, stdout/stderr, and exit/status behavior is defined when
  user-visible
- conformance expectations cite governing clauses, schemas, decisions, or models

Report `self-sufficiency: pass` only when the gate passes. Otherwise report
`self-sufficiency: fail` with blocking gaps.

For distilled specs that target a new implementation, create
`spec/traceability.md` from the first pass unless the user explicitly accepts
inline traceability for a tiny one-implementation draft. Use this row shape:

```text
clause_id | source_id | source file:line/symbol | observed fact | tests/fixtures | decision | schema/case/model | status | disposition
```

Traceability never fills missing semantics. If a target implementer must open
source files to implement behavior, the clause is incomplete regardless of
traceability quality.

## Boundary Schema Checklist

Every boundary object that crosses process, file, wire, CLI, storage, or
implementation boundaries needs a schema once another implementation, runner, or
external consumer depends on it. Each boundary schema states:

- schema draft/version and object version field policy
- required fields and optional fields
- defaults: producer emits, consumer applies, or reject absent
- null policy; null is allowed only by explicit union
- unknown fields: reject, drop, preserve, or extension map
- additional properties policy
- field ordering: normative or non-normative
- numeric ranges, integer width, float precision, and overflow behavior
- timestamp format, timezone, precision, and parse failure behavior
- enum open/closed policy and unknown value behavior
- valid and invalid examples
- evolution rules: add, remove, rename, widen, narrow, deprecate

## Target-Ready Handoff Gate

Use target-specific gates when a language/runtime is active, requested, or
needed to expose portability risk. Do not require a language lens only because it
is listed here. Active target gates override the default language preference.

Before claiming an implementation target is ready or conformant:

- target identity is recorded: language, runtime/toolchain version, package
  manager, OS/filesystem assumptions, and last checked date/commit
- install, build, test, and conformance commands are listed and run, or marked
  `unverified`
- every public input/output object has a schema or explicit deferral
- absent/null/zero/empty string/list/map behavior is covered at boundaries
- path normalization, symlink, traversal, permissions, newline, encoding, env
  unset vs empty, process signal/exit, stdout/stderr, time, randomness, ordering,
  and lock behavior are covered where observable
- stable error codes/classes are separate from runtime prose where consumers need
  them
- conformance includes malformed payloads, unknown fields, null/absent/zero/empty
  values, timestamp failures, path/env edge cases, and rejection/no-op mutation
  checks where relevant
- golden output is normalized for newline, ordering, encoding, and platform path
  separators unless exact bytes are normative
- each case cites a governing clause, schema, error, decision, or model

Per-language guides record binding facts only for active or planned ports. When
needed, include target mapping notes such as field names/tags, pointer vs value
or nullable vs non-nullable representation, omit/serialize-empty policy, nil vs
empty collection behavior, timestamp representation, extension-field strategy,
and error type/sentinel/exception/result policy. These notes never redefine
protocol behavior.

## Quint Model Gate

Create a canonical Quint model, or record an explicit deferral, when in-scope
behavior has important:

- lifecycle or terminal states
- readiness, eligibility, scheduling, or turn order
- retry, resume, crash/reload, or persistence
- graph/dependency rules
- locks, reservations, deduplication, idempotency, or check-then-act shared state
- monotonic counters, quotas, budgets, or resource caps

Skip with rationale only when the behavior is a pure function, the invariant is
fully expressible as type/schema validation, I/O/LLM/wall-clock behavior
dominates, unbounded strings/floats/time drive the model, or the model would
exceed useful abstraction.

Every canonical model needs a negative control. The negative control must violate
a named externally observable invariant before a green canonical run counts as
evidence. For each model, record one target state machine, state vars/actions/
invariants prose sketch, scoped-out sibling state, canonical and negative-control
paths under `spec/quint/`, commands run, and results.

## Implementation Sandbox Rule

Spec-kit must not modify current product implementation code unless the user
explicitly asks for implementation changes.

When executable validation is needed, create throwaway work under:

```text
tmp/spec-kit/<slug>/
```

Use sandbox code only for validating ambiguous clauses, prototyping reference
behavior, trying conformance runner shape, checking target-language portability,
or exploring schemas/models/test fixtures.

Sandbox outputs are evidence only. They do not become normative until promoted
into decisions, clauses, schemas, conformance cases, or canonical models. Do not
import sandbox architecture into product code by default. Delete, ignore, or
clearly mark sandbox artifacts as non-normative unless the user asks to keep
them.

## Acceptance By Mode

- Scratch: scope, non-goals, glossary, decisions for ambiguity, numbered clauses,
  and explicit deferrals exist; conformance/model files only when behavior needs
  executable or state evidence.
- Distill: source inventory, implementation evidence,
  copied/corrected/deferred/excluded behavior, ambiguity list, draft status,
  authority-conflict decisions, self-sufficiency status, and source references
  are captured. Reimplementation distill creates `spec/traceability.md` unless
  explicitly deferred for a tiny one-implementation draft.
- Iteration: changed clauses/decisions/schemas/cases/models/implementations agree,
  traceability is updated, targeted gates ran, reviews are dispositioned, and
  residual risk is recorded.
- Implementation: normative implementation contract is split into core behavior,
  file/schema contract, CLI/API contract, language binding, compatibility, and
  non-normative implementation notes; target gate evidence exists for every
  claimed supported implementation; every claimed command or conformance status
  cites runner/version/date/commit or says unverified.
- Templates: placeholders are replaced before target handoff except in template
  source files.

## Completion Gates

Do not finish a spec-kit turn until the applicable mode acceptance is satisfied
or explicitly deferred, closeout fields are reported, unresolved blockers are
named, and claimed test/conformance/model status cites command/date/commit or
says `unverified`.

## Iteration Budget

For new or multi-implementation kits, plan these passes when scope warrants:

1. **v0**: glossary, decisions, minimal numbered clauses, minimal conformance,
   one thin sandbox/reference check when executable feedback is needed.
2. **v0 hardening**: negative cases, raw/no-op/error stutter, model traces,
   stronger schemas, source-precedence review.
3. **release candidate**: cross-target pass for every planned implementation
   target, freeze gate, residual-risk list.

Stop when review signal converges, not after a fixed count.
Freeze means release-candidate stabilization only. Open ambiguities, missing
boundary schemas, unresolved authority conflicts, self-sufficiency failures,
untriaged review findings, or clauses that rely on evidence links/examples/
implementation notes for required behavior block freeze.

## Implementation Target Strategy

When choosing a new implementation or validation harness, follow the user target
and repo constraints first. Use other languages only when requested, already
active, or useful as a cheap portability lens:

- TypeScript + Bun: fast executable feedback, simple runner, conformance and
  Quint integration.
- Rust: strict types, explicit error paths, storage/path/lock discipline, fewer
  accidental dynamic-shape assumptions.
- Go: process, filesystem, JSON, env, and test ergonomics that expose portability
  leaks.
- Python: existing Python repos, scripting, fixtures, and property-test
  ergonomics.

Implementations never outrank spec sources. Treat them as evidence and drift
detectors. Language binding docs describe requested or active ports; they do not
replace the implementation order above or redefine behavior.
If the user explicitly targets TypeScript, Rust, Go, Python, or another
implementation, prioritize that target's ready gate, binding guide, and
conformance harness. Use other languages only when requested or when they resolve
ambiguity cheaply.

## Required Practices

- Normative clauses must be implementable without reading the source evidence.
  Source references are provenance annotations, not part of the contract. If a
  clause requires the reader to follow an evidence link to understand required
  behavior, the clause is incomplete.
- Glossaries should read like Seeds by default: start with a short authority
  note, then use domain-grouped section titles such as `Primitives`,
  `Predicates`, `Operations`, and `Infrastructure` when they help scanning.
  Reserve a flat `Terms` section for tiny specs only.
- Number normative clauses with stable IDs.
- Prefer compact active decisions that state the accepted choice and material
  consequence. Use a detailed decision record when context, conformance/model
  impact, affected artifacts, or references cannot be represented accurately
  in one row.
- Preserve superseded decisions in an explicitly `NONNORMATIVE` history table
  that names the replacement, former choice, and current consequence. Check
  that obsolete choices do not leak into clauses, schemas, conformance, models,
  implementation guidance, or implementations as current authority.
- Distill output records clause -> evidence file:line -> conformance/local tests
  -> status inline by default. Create `spec/traceability.md` when the mapping is
  large, multi-source, conflict-heavy, needed for multi-implementation work, or
  used as a reimplementation handoff.
- Every boundary object that crosses process, file, wire, CLI, or implementation
  boundaries has at least a draft schema when another implementation, runner, or
  external consumer is planned. Schemas define required/optional fields,
  unknown-field behavior, version field policy, defaults, null behavior,
  numeric/timestamp/enum constraints, evolution, and rejection behavior.
- Every conformance family has a status tag: `existing`, `planned`, `deferred`,
  or `blocked`.
- Every conformance case cites a governing clause, schema, or decision.
- Multi-implementation release candidates include a traceability matrix. Each
  normative clause, accepted unsuperseded decision, schema boundary, and
  canonical model invariant maps to conformance, schema validation, local test,
  model check, or an explicit deferral.
- Negative and rejection cases assert no unintended mutation where relevant.
- Quint models stay abstract: lifecycle, graph, readiness, concurrency, stutter.
  Apply the Quint Model Gate for important state machines. Only `role:
  canonical` models/traces are normative; example/exploratory models are
  evidence only.
- Guidance files are non-normative only; move current protocol meaning into
  numbered spec clauses, decisions, or schemas.
- Reimplementation guidance separates core behavior, file/schema contract,
  CLI/API contract, language bindings, compatibility, and implementation notes.
- Language binding docs record current port facts and conformance status; they do
  not redefine behavior.
- Implementation notes may recommend tactics but must link to clauses, schemas,
  cases, or decisions for any contract claim.
- Executable validation happens under `tmp/spec-kit/<slug>/` unless the user
  explicitly asks for product implementation edits.
- Use read-only subagents for non-trivial inventory/review work when available.
  Review prompts use narrow lenses and no-edit instructions.
- Non-trivial review loops keep a durable finding ledger: finding, severity,
  disposition, fix references, verification, and deferral trigger.

## Missing Often

Watch for gaps the user did not name:

- explicit non-goals and scope boundaries
- compatibility/versioning policy
- compatibility lane for legacy APIs that should not define core behavior
- glossary before field bikeshedding
- decision log for ambiguity, not only final spec text
- unresolved authority conflicts before broad clauses
- draft/stable/compat/evidence/deferred labels on distilled requirements
- clauses that require following evidence links to understand required behavior
- self-sufficiency status omitted from handoff
- traceability used as substitute for missing normative semantics
- schema evolution, null/absent/default, and unknown-field preservation rules
- draft schemas for boundary objects when another implementation is planned
- negative conformance and no-op/rejection stutter checks
- canonical Quint model without negative control
- conformance family status tags: existing/planned/deferred/blocked
- conformance status without runner/date/commit or explicit unverified status
- deterministic hooks for IDs, time, randomness, ordering
- source-to-test traceability matrix
- fixture minimization and fake-runner limits
- portability matrix for filesystem, env, process, newline, encoding, locks
- language-specific hardening without active port, user request, or stated
  portability risk
- sandbox findings left in `tmp/spec-kit/<slug>/` without promotion or deferral
- implementation contract vs guidance split inside `spec/`
- shared implementation guide, per-language guides, and research provenance
- release/freeze criteria and residual-risk register

## Closeout

Report:

- files changed
- authority and reading chain declared
- self-sufficiency: pass/fail with blockers
- maturation loop status and remaining pass needed before handoff
- sandbox path used, or no implementation sandbox used
- product code touched: yes/no
- target gates run/deferred
- decisions captured or still needed
- traceability matrix updated/skipped with reason
- schema boundaries added/deferred
- conformance/model/test coverage added
- conformance status evidence
- review ledger entries added/dispositioned
- portability/reimplementation layer touched, if any
- review passes run or skipped
- no files changed, when review-only
- known gaps and next iteration target
