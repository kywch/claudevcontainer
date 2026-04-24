# Property patterns

High-value patterns to look for when mining properties from code. Test a property only if the code (docstring, comments, caller usage) actually claims it.

## Invariants

Relationships that must always hold regardless of input.

- `len(filter(pred, x)) <= len(x)`
- `set(sort(x)) == set(x)`
- `min(x) <= mean(x) <= max(x)` (for non-empty numeric `x`)
- Size / shape preservation across transforms

## Round-trip properties

`decode(encode(x)) == x`, `parse(format(x)) == x`, `deserialize(serialize(x)) == x`. Very high bug-finding yield — encode/decode asymmetries are common.

## Inverse operations

Pairs that should cancel: `add`/`remove`, `push`/`pop`, `create`/`destroy`, `open`/`close`. After `op⁻¹(op(x))`, state should equal the original.

## Multiple implementations

- Fast path vs reference path (e.g. SIMD vs scalar, cached vs uncached)
- Optimized vs naive
- New impl vs legacy — test they agree on shared domain

## Mathematical properties

- **Idempotence**: `f(f(x)) == f(x)` (normalizers, canonicalizers, sort, dedup)
- **Commutativity**: `f(x, y) == f(y, x)` (set ops, addition, max/min)
- **Associativity**: `f(f(x, y), z) == f(x, f(y, z))`
- **Identity**: `f(x, id) == x` (concat with empty, multiply by 1)
- **Distributivity**: `f(x, g(y, z)) == g(f(x, y), f(x, z))`

## Confluence

Order-independence of operation application. Common in compiler optimization passes, CRDT merge, config layering. `apply([a, b, c], x) == apply([c, a, b], x)`.

## Metamorphic properties

A known relationship between `f(x)` and `f(g(x))` even without knowing the correct value of `f(x)`:

- `sin(π − x) == sin(x)`
- `classify(rotate(image)) == classify(image)` (for rotation-invariant classifiers)
- `sort(reverse(x)) == sort(x)`
- `search(list + [new_item], new_item)` returns a valid index

Great for testing ML models, numeric code, and anything where ground truth is expensive.

## Single entry point ("fuzz")

For libraries with 1–2 public entrypoints (parsers, serializers, validators), test that **valid inputs never crash**. No specific property needed beyond "doesn't raise unexpected exception types". Very effective against parser-style code.

## Prioritization

When a module has many functions:

1. Public API (no leading underscore) with substantive docstrings
2. Multi-function properties (usually stronger)
3. Well-grounded single-function properties
4. Skip internal helpers and trivial utilities
