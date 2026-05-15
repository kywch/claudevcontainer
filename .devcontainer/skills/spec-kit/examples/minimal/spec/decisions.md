# Decisions

This file is the accepted decision log. Decisions remain normative until
explicitly superseded.

## DEC-0001 ASCII Whitespace Only

Status: accepted
Date: 2026-05-14
Spec: token-counter-0.1
Area: logic
Compatibility: new

### Context

Tokenization can mean Unicode word segmentation, shell-like parsing, or simple
delimiter splitting. The v0 scope needs one portable rule.

### Decision

Token Counter counts non-empty spans separated by ASCII whitespace only.

### Consequences

This is easy to implement consistently. Unicode segmentation is deferred.

### Conformance

None yet. Reason: minimal draft example.

### Verification Impact

Add a delimiter case before release candidate.

### Affected Artifacts

- clauses: `spec/behavior.md`
- schemas: none
- conformance: none
- models: none
- implementations: none

### References

- User intent: minimal spec-kit example.
