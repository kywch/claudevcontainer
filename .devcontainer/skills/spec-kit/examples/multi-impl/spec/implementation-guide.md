# Implementation Guide

Non-normative guidance. It never overrides the authority and reading chain in
`spec/README.md`.

## Authority And Reading Chain

Follow the roles and order declared by `spec/README.md`. If implementation
behavior conflicts with a normative artifact, follow the normative artifact.
If normative artifacts conflict with each other, report and repair the
specification defect.

## Testing

Use local tests for parser and serialization mechanics. Use portable
conformance cases for observable boundary behavior. Treat the included runner as
a case-shape check only; it is not release conformance evidence.

## Shared Conformance Data

Do not include an implementation-executing runner by default. This example
models four planned implementations, so it keeps conformance cases as portable
data and includes only a shape checker. Add a black-box runner after at least
two active implementations need the same execution path or external consumers
need a single release gate.

Include `spec/conformance/runner/` for implementation execution when:

- case data is stable enough to deserve a schema
- two or more active ports run the same observable checks
- port-local test harnesses are drifting
- release evidence needs one command and pass/fail count

Do not include it when:

- there is only one implementation
- cases are still exploratory
- a mature upstream test harness already executes the cases
- runner work would outpace the spec itself

## Review Checklist

- Unknown fields survive mutation per `spec/behavior.md#b1-flag-record` and
  `D-001`.
- If stable errors are added to normative IO clauses later, tests assert the
  public error contract without depending on runtime exception text.
- Port guide commands match package tooling.
