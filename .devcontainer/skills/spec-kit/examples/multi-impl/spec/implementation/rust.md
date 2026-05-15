# Rust Implementation

Non-normative current facts for this port. Protocol meaning belongs in
decisions, numbered clauses, schemas, and conformance.

## Status

- spec target: flag-store-0.1
- planned path: impl/rust
- conformance status: not yet runnable by shared runner
- known gaps: no active implementation or implementation-executing runner yet

## Runtime And Tooling

- toolchain: Rust stable, edition 2024
- package manager/build: Cargo
- formatter: `cargo fmt`
- lint: `cargo clippy`
- unit/integration tests: `cargo test`
- property tests: `proptest`

## Simplified Layout

```text
impl/rust/
  Cargo.toml
  src/
    main.rs           # public CLI/API entry
    lib.rs
    flag_store.rs     # behavior
    schema.rs         # boundary validation
  tests/
    flag_store.rs
    conformance.rs
    properties.rs
```

## Test Suite

- schema accepts valid records and rejects missing `key`/`enabled`
- mutation preserves unknown fields in `serde_json::Value`
- property: enabled set remains subset of known keys
- portable conformance case: `preserve-unknown-fields`
- real binary/API tests for public output

## Local Commands

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Port-Specific Risks

- Typed structs can drop unknown fields unless an extension map is retained.
- If stable errors are specified later, `unwrap`/panic paths must not surface as
  protocol errors.
