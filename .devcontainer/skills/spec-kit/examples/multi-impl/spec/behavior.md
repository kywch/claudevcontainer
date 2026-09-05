# Behavior

This file is normative. A conflict with another normative artifact is a
specification defect that must be repaired.

## B1 Flag Record

B1.1 A flag record has a flag key and an enabled boolean.

B1.2 Mutations that change `enabled` preserve unknown fields.

### Traceability

| Decision | Schema | Conformance | Model | Notes |
| --- | --- | --- | --- | --- |
| D-001 | `flag-record.v1.schema.json` | `preserve-unknown-fields` | none | Unknown-field preservation is boundary JSON behavior; `flag_state.qnt` covers known flag state only. |
