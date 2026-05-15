# Go Implementation

Non-normative current facts for this port. Protocol meaning belongs in
decisions, numbered clauses, schemas, and conformance.

## Status

- spec target: flag-store-0.1
- planned path: impl/go
- conformance status: not yet runnable by shared runner
- known gaps: no active implementation or implementation-executing runner yet

## Runtime And Tooling

- toolchain: Go modules
- package manager/build: `go`
- formatting: `gofmt`
- tests: `go test`
- fuzz targets: parser/validator helpers
- command API: `Makefile` when present

## Simplified Layout

```text
impl/go/
  go.mod
  Makefile
  cmd/flagstore/main.go
  internal/app/
    flag_store.go
    schema.go
    flag_store_test.go
    conformance_test.go
    fuzz_test.go
```

## Test Suite

- table tests for schema validation
- mutation preserves unknown fields in `map[string]any`
- fuzz parser/validator for malformed JSON
- portable conformance case: `preserve-unknown-fields`
- process-level test for public CLI/API boundary if present

## Local Commands

```bash
go test ./...
go test -race ./...
go test -fuzz=Fuzz -run=^$ ./internal/app
```

## Port-Specific Risks

- If stable errors are specified later, error wrapping must not leak runtime text.
- Map decoding must preserve unknown fields through mutation.
