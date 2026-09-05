# Iteration And Hardening

## Spec Maturation Loop

Do not expect a durable spec in one pass. Repeat until handoff gates pass or
remaining gaps are explicit deferrals:

1. Inventory evidence and conflicts.
2. Capture decisions for ambiguity/conflicts.
3. Update numbered clauses, schemas, errors, and boundaries.
4. Add or update conformance cases and Quint models when triggered.
5. Run self-sufficiency, traceability, schema, conformance, model, and target
   gates.
6. Review with narrow lenses.
7. Repair findings by updating decisions/spec/schemas/cases/models.
8. Record residual gaps, deferrals, and next loop target.

Stop only when self-sufficiency passes, authority conflicts are resolved or
deferred, important clauses map to evidence/tests, schemas cover active
boundaries, conformance/model gates pass or are explicitly deferred, target-ready
gates pass for claimed implementation targets, and review findings are
dispositioned.

## Review-Fix Loop

For non-trivial work:

1. Implement one coherent spec slice, or sandbox validation slice under
   `tmp/spec-kit/<slug>/`.
2. Run targeted gates.
3. Request 2-4 read-only subagent reviews with narrow lenses when available.
4. Rank findings: blockers, in-scope hardening, out-of-scope deferrals.
5. Record findings in a review ledger with severity, disposition, fix refs,
   verification, and deferral trigger.
6. Fix blockers first.
7. Fix scoped hardening while slice remains coherent.
8. Rerun targeted gates.
9. Request read-only verification review with prior findings.
10. Repeat until material new findings stop or residual risk accepted.
11. Run full gates.

Do not use cleanup as permission for broad refactors. Do not modify product
implementation code unless the user explicitly asks for implementation changes.
Subagents should protect main-agent context by handling bounded inventory,
review, and verification lenses; they should return concise file:line findings
and make no edits unless explicitly assigned parallel implementation work.

## Hardening Order

1. Spec alignment: glossary/decisions/clauses/schema consistency.
2. Conformance strength: exact assertions, negative cases, raw stutter.
3. Model: lifecycle/graph invariants, no-op/rejection stutter, counterexamples.
4. Implementation: sandbox/reference checks for storage/path/env/process/error
   stability.
5. Portability: run active or risk-relevant language/runtime checks to expose
   hidden assumptions.
6. Guidance: only workflow and implementation guidance; no stale protocol facts.

## Implementation Hardening

Follow the target repo stack first. When choosing a new hardening port and no
repo stack dominates, TypeScript + Bun is useful for fast executable feedback;
Rust is useful for strict state/error/storage pressure.

Use strict implementations or sandbox prototypes to pressure-test spec shape:

- enum exhaustiveness exposes vague states
- Result/error plumbing exposes unstable failures
- filesystem/path/lock code forces precise IO rules
- ownership/data modeling exposes mutation ambiguity
- integration tests expose process and env assumptions

Implementation findings should flow back into decisions/spec/conformance/models,
not only local code or sandbox files.

## Cross-Language Signal

Use extra ports to detect:

- hidden dependency on JS object behavior or Python dict behavior
- newline/encoding/path differences
- process exit/stdout/stderr mismatch
- locking semantics
- schema defaults and unknown-field handling
- timestamp/ID generation assumptions

When ports disagree, check the authority chain. A contradiction among normative
artifacts is a specification defect; repair the affected artifacts. If the
normative specification is silent, create an active decision and update it.

## Freeze Gate

Before release candidate:

- no pending product-intent decisions for in-scope behavior
- self-sufficiency gate passes, or blockers are explicit deferrals
- multi-implementation specs have a traceability matrix or explicit deferral
- all conformance cases cite clauses, schemas, decisions, errors, or models
- schemas validate all boundary objects
- canonical Quint models have negative controls; counterexamples are fixed,
  replayed, or explicitly out of scope
- at least one implementation passes full conformance
- target-ready gates for claimed implementation targets completed or deferred
  with reason
- guidance claims only tested or normative behavior
- product code was not touched unless explicitly requested
- residual risks listed with owner/trigger
