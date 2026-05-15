# Flag Store 0.1

Status: draft

Flag Store specifies a small JSON flag record, observable read/write behavior,
and implementation guidance for TypeScript, Rust, Go, and Python ports.

## Normative Precedence

1. `spec/glossary.md`
2. accepted decisions in `spec/decisions.md`
3. numbered clauses in normative spec files
4. schemas in `spec/schemas/`, when present
5. conformance cases in `spec/conformance/cases/`, when present
6. canonical state/model artifacts in `spec/quint/`, when present
7. implementations as evidence only, never as normative source

Non-normative guidance and example models never fill contract gaps.

## Reading Order

1. `spec/glossary.md`
2. `spec/decisions.md`
3. `spec/behavior.md`
4. `spec/io.md`
5. `spec/quint/README.md`
6. `spec/implementation-guide.md`

## Scope

- Store boolean feature flags by key.
- Read and write a JSON object at the public boundary.
- Preserve unknown JSON object fields.

## Out Of Scope

- Remote sync.
- User authentication.
- Flag targeting rules.

## Case Shape Check

```bash
(cd skills/spec-kit/examples/multi-impl && bun spec/conformance/runner/run.ts --cases spec/conformance/cases)
```

This example does not include an implementation-executing conformance runner.
The command above validates portable case shape only.
