# TypeScript Implementation

Non-normative current facts for this port. Protocol meaning belongs in
decisions, numbered clauses, schemas, and conformance.

## Status

- spec target: flag-store-0.1
- planned path: impl/ts
- conformance status: not yet runnable by shared runner
- known gaps: no active implementation or implementation-executing runner yet

## Runtime And Tooling

- runtime/package manager: Bun
- lockfile: `bun.lock`
- formatter/linter: Biome
- type checker: `tsc --noEmit`
- unit/integration tests: `bun:test`
- property tests: `fast-check`

## Simplified Layout

```text
impl/ts/
  package.json
  tsconfig.json
  biome.json
  src/
    index.ts          # public CLI/API entry
    flag-store.ts     # behavior
    schema.ts         # boundary validation
  test/
    flag-store.test.ts
    schema.test.ts
    conformance.test.ts
    properties.test.ts
```

## Test Suite

- schema accepts valid records and rejects missing `key`/`enabled`
- mutation preserves unknown fields
- property: toggling a known flag never drops unknown fields
- portable conformance case: `preserve-unknown-fields`
- real public-boundary tests, not private helper mocks

## Local Commands

```bash
bun install
bun test
bun run typecheck
bun run lint
```

## Port-Specific Risks

- Object spreading can accidentally drop unknown fields.
- If stable errors are specified later, runtime exception text must not become
  protocol output.
