# Decisions

This file is the accepted decision log. Decisions remain normative until
explicitly superseded.

## DEC-0001 Preserve Unknown Fields

Status: accepted
Date: 2026-05-14
Spec: flag-store-0.1
Area: schema
Compatibility: new

### Context

Multiple implementations may read and write flag records while newer producers
add fields.

### Decision

Implementations preserve unknown fields when mutating a flag record.

### Consequences

Ports must avoid lossy decode/encode paths at the boundary.

### Conformance

`preserve-unknown-fields`

### Verification Impact

Schema permits unknown fields. Conformance checks mutation preservation.

### Affected Artifacts

- clauses: `spec/behavior.md`
- schemas: `spec/schemas/flag-record.v1.schema.json`
- case schemas: `spec/conformance/case.schema.json`
- conformance: `spec/conformance/cases/preserve-unknown-fields.yaml`
- models: none; unknown-field preservation is not modeled in Quint
- implementations: planned TypeScript, Rust, Go, Python

### References

- User intent: multi-implementation example.
