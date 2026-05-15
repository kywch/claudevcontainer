---
name: spec-kit
description: Use to create, reverse-specify, refine, or harden a spec kit for a product/protocol/library: turn rough intent or an existing repo into normative specs, decisions, schemas, conformance tests, Quint/state models, implementation guidance, and iterative review plans.
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
  glossary.md
  decisions.md
  behavior.md
```

Common once behavior is executable or shared:

```text
spec/
  decision-index.md
  schemas/
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
  storage.md                  # persisted format, locks, paths, durability
  io.md                       # CLI/API/files/env/stdout/stderr contract
  implementation.md           # implementation-neutral contract only
  conformance/runner/         # shared black-box runner exists
  quint/                      # state/graph/concurrency invariants
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

Tiny specs may inline glossary and decisions in `README.md`. Larger specs split
by numbered clause families, not by implementation. Empty future-port files
create drift; do not create them.

## Source Precedence

Use this normative precedence for the normalized kit. If the target repo already
has its own authority chain, record it as source evidence, then map conflicts
into this order:

1. `spec/glossary.md` for terminology
2. accepted decisions in `spec/decisions.md`
3. numbered clauses in normative spec files, excluding explicitly
   non-normative guide/template/research/workflow files
4. schemas in `spec/schemas/`
5. conformance cases in `spec/conformance/cases/`
6. canonical Quint/state models and `role: canonical` traces in `spec/quint/`
7. implementations as evidence only

If sources conflict, follow the higher source and report the mismatch.
Non-normative guidance, examples, research notes, and exploratory Quint models
never fill contract gaps. Use them as reading aids or evidence only.

Decisions control behavioral choices until the kit explicitly supersedes them.
When a decision is incorporated into clauses, keep it aligned or mark it
superseded by the clause/decision that now governs.

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
  -> decisions
  -> numbered spec
  -> schemas where data crosses boundary
  -> conformance cases for observable behavior
  -> Quint/state model for lifecycle/concurrency/graph rules when risk warrants
  -> reference implementation when requested or needed to validate ambiguity
  -> independent reviews
  -> next iteration
```

Classify each slice:

- `copy`: copy existing behavior because it is safe, boring, and in scope
- `correct`: intentionally diverge from existing behavior; capture decision
- `defer`: document out-of-scope behavior and trigger for adding it later
- `new`: define new behavior through decision, spec, tests, model, and code

Product intent unclear -> ask for decision before making normative text.
Implementation-only bug -> local regression test first; add conformance only
when other implementations could drift the same observable way.
Normative behavior change -> decision, spec/schema update, conformance, version
update, affected implementation updates.

## Acceptance By Mode

- Scratch: scope, non-goals, glossary, decisions for ambiguity, numbered clauses,
  and explicit deferrals exist; conformance/model files only when behavior needs
  executable or state evidence.
- Distill: source inventory, implementation evidence, copied/corrected/deferred
  behavior, and ambiguity list are captured with file references.
- Iteration: changed clauses/decisions/schemas/cases/models/implementations agree,
  targeted gates ran, reviews are dispositioned, and residual risk is recorded.
- Implementation: normative implementation contract is separate from
  non-normative guides; every claimed command or conformance status is current.
- Templates: placeholders are replaced before target handoff except in template
  source files.

## Iteration Budget

For new or multi-implementation kits, plan these passes when scope warrants:

1. **v0**: glossary, decisions, minimal numbered clauses, minimal conformance,
   one thin implementation or sandbox.
2. **v0 hardening**: negative cases, raw/no-op/error stutter, model traces,
   stronger schemas, source-precedence review.
3. **release candidate**: cross-implementation pass, Rust then Go hardening
   when useful, freeze criteria, residual-risk list.

Stop when review signal converges, not after a fixed count.

## Language Strategy

When choosing a new implementation or validation harness, use this sequence
unless the user explicitly chooses another stack or repo constraints make it
impractical:

- TypeScript + Bun for the first executable pass: fast iteration, simple runner,
  easy conformance and Quint integration.
- Rust next for hardening: strict types, explicit error paths, storage/path/lock
  discipline, fewer accidental dynamic-shape assumptions.
- Go next for portability and operational shape: process, filesystem, JSON, env,
  and test ergonomics differ enough to expose spec leaks.
- Python only when the repo already uses it or scripting/property-test ergonomics
  beat a new compiled port.

Implementations never outrank spec sources. Treat them as evidence and drift
detectors.

## Required Practices

- Number normative clauses with stable IDs.
- Every decision records context, decision, consequences, conformance impact,
  model impact, and references.
- Every conformance case cites a governing clause, schema, or decision.
- Multi-implementation release candidates include a traceability matrix. Each
  normative clause, accepted unsuperseded decision, schema boundary, and
  canonical model invariant maps to conformance, schema validation, local test,
  model check, or an explicit deferral.
- Negative and rejection cases assert no unintended mutation where relevant.
- Quint models stay abstract: lifecycle, graph, readiness, concurrency, stutter.
  Use them only when state/concurrency risk warrants. Only `role: canonical`
  models/traces are normative; example/exploratory models are evidence only.
- Guidance files are non-normative only; move current protocol meaning into
  numbered spec clauses, decisions, or schemas.
- Review prompts use narrow lenses and no-edit instructions.
- Non-trivial review loops keep a durable finding ledger: finding, severity,
  disposition, fix references, verification, and deferral trigger.

## Missing Often

Watch for gaps the user did not name:

- explicit non-goals and scope boundaries
- compatibility/versioning policy
- glossary before field bikeshedding
- decision log for ambiguity, not only final spec text
- schema evolution and unknown-field preservation rules
- negative conformance and no-op/rejection stutter checks
- deterministic hooks for IDs, time, randomness, ordering
- source-to-test traceability matrix
- fixture minimization and fake-runner limits
- portability matrix for filesystem, env, process, newline, encoding, locks
- implementation contract vs guidance split inside `spec/`
- shared implementation guide, per-language guides, and research provenance
- release/freeze criteria and residual-risk register

## Closeout

Report:

- files changed
- source precedence chosen
- decisions captured or still needed
- conformance/model/test coverage added
- review passes run or skipped
- no files changed, when review-only
- known gaps and next iteration target
