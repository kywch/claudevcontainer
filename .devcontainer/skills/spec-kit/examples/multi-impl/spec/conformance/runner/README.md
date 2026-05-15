# Case Shape Runner

This example includes portable conformance case data and a tiny shape checker.
It does not execute implementations and must not be reported as conformance
evidence. Real specs should add an implementation-executing runner only after
this decision point:

- 2+ active implementations need one black-box oracle
- conformance cases are stable enough to validate
- release evidence needs one command and pass/fail count

An implementation-executing runner should execute public behavior only. It must
not import private implementation helpers.

## Command

```bash
(cd skills/spec-kit/examples/multi-impl && bun spec/conformance/runner/run.ts --cases spec/conformance/cases)
```

This TypeScript example runner is intentionally tiny and validates the case
shape used by this example. It is a smoke check, not full YAML or JSON Schema
validation. Passing `--impl` is an error because this runner does not execute
implementations.

## Report

The runner prints one JSON object:

```json
{"ok":true,"command":"case-shape","cases":1,"passed":1,"failed":0,"implExecuted":false,"failures":[]}
```
