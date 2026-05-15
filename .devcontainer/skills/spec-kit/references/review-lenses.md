# Review Lenses

Use narrow read-only reviews. Do not ask whether work "looks good".

## Source Alignment

Find:

- glossary/decision/clause/schema/conformance conflicts
- implementation behavior treated as normative without decision
- missing source citations for tests
- stale guidance that contradicts spec
- unversioned normative changes

## Conformance Quality

Find:

- weak oracles
- subset assertions where exactness matters
- missing negative/rejection/no-op cases
- fake runner behavior mistaken for protocol proof
- fixture coupling to incidental runtime formatting
- missing raw storage/state stutter assertions

## Model And State

Find:

- missing invariants
- terminal states that can reopen
- graph cycles, dangling refs, projection mismatch
- readiness/eligibility ambiguity
- action granularity too far from public operations
- counterexamples not replayed against implementation

## Implementation Portability

Find:

- OS/runtime/library error text leaking into stable output
- path/symlink/lock assumptions
- hidden env/network/secrets reads
- process stdout/stderr/exit drift
- encoding/newline assumptions
- language-specific behavior not captured in spec

## Cleanup And Hardening

Find only in-scope cleanup:

- duplicate tests with same oracle
- dead helper code touched by slice
- abstractions with no current value
- missing focused edge coverage
- nondeterminism in tests

Do not recommend broad rewrites unless current slice cannot be made correct
without them.
