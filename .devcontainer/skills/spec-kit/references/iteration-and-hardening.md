# Iteration And Hardening

## Review-Fix Loop

For non-trivial work:

1. Implement one coherent slice.
2. Run targeted gates.
3. Request 2-4 read-only reviews with narrow lenses.
4. Rank findings: blockers, in-scope hardening, out-of-scope deferrals.
5. Record findings in a review ledger with severity, disposition, fix refs,
   verification, and deferral trigger.
6. Fix blockers first.
7. Fix scoped hardening while slice remains coherent.
8. Rerun targeted gates.
9. Request verification review with prior findings.
10. Repeat until material new findings stop or residual risk accepted.
11. Run full gates.

Do not use cleanup as permission for broad refactors.

## Hardening Order

1. Spec alignment: glossary/decisions/clauses/schema consistency.
2. Conformance strength: exact assertions, negative cases, raw stutter.
3. Model: lifecycle/graph invariants, no-op/rejection stutter, counterexamples.
4. Implementation: storage/path/env/process/error stability.
5. Portability: run another language or runtime to expose hidden assumptions.
6. Guidance: only workflow and implementation guidance; no stale protocol facts.

## Implementation Hardening

Follow the target repo stack first. When choosing a new hardening port and no
repo stack dominates, TypeScript + Bun is useful for fast executable feedback;
Rust is useful for strict state/error/storage pressure.

Use strict implementations to pressure-test spec shape:

- enum exhaustiveness exposes vague states
- Result/error plumbing exposes unstable failures
- filesystem/path/lock code forces precise IO rules
- ownership/data modeling exposes mutation ambiguity
- integration tests expose process and env assumptions

Implementation findings should flow back into decisions/spec/conformance, not
only local code.

## Cross-Language Signal

Use extra ports to detect:

- hidden dependency on JS object behavior or Python dict behavior
- newline/encoding/path differences
- process exit/stdout/stderr mismatch
- locking semantics
- schema defaults and unknown-field handling
- timestamp/ID generation assumptions

When ports disagree, source precedence decides. If source is silent, create a
decision.

## Freeze Gate

Before release candidate:

- no pending product-intent decisions for in-scope behavior
- multi-implementation specs have a traceability matrix or explicit deferral
- all conformance cases cite sources
- schemas validate all boundary objects
- canonical Quint counterexamples either fixed, replayed, or explicitly out of
  scope
- at least one implementation passes full conformance
- strict implementation pass completed or deferred with reason
- guidance claims only tested or normative behavior
- residual risks listed with owner/trigger
