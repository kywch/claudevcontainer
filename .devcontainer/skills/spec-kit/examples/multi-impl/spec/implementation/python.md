# Python Implementation

Non-normative current facts for this port. Protocol meaning belongs in
decisions, numbered clauses, schemas, and conformance.

## Status

- spec target: flag-store-0.1
- planned path: impl/python
- conformance status: not yet runnable by shared runner
- known gaps: no active implementation or implementation-executing runner yet

## Runtime And Tooling

- runtime: Python 3.11+
- package manager: `uv`
- config: `pyproject.toml`
- tests: pytest
- property tests: Hypothesis
- lint/format: Ruff
- type check: ty

## Simplified Layout

```text
impl/python/
  pyproject.toml
  src/flagstore/
    __init__.py
    cli.py             # public CLI/API entry
    store.py           # behavior
    schema.py          # boundary validation
  tests/
    test_store.py
    test_schema.py
    test_conformance.py
    test_properties.py
```

## Test Suite

- pytest cases for schema validation
- mutation preserves unknown fields in dict records
- Hypothesis property: unknown fields survive enabled toggles
- portable conformance case: `preserve-unknown-fields`
- subprocess tests for public CLI/API boundary if present

## Local Commands

```bash
uv sync
uv run pytest
uv run ruff check .
uv run ty check
```

## Port-Specific Risks

- If stable errors are specified later, exception messages must not become
  protocol output.
- Dict copies must retain unknown fields through mutation.
