---
name: parse-dont-validate
description: Review code for validation that discards what it learned instead of parsing input into a type that carries the proof. Finds shotgun parsing, redundant re-checks, "impossible" branches, weakened return types (Optional/Maybe/nullable where the argument type should be strengthened), and data representations that admit illegal states. Use when asked to review types, invariants, input handling, or boundaries, or when someone says "parse don't validate". Language-agnostic; read-only.
metadata:
  upstream: https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
---

# Parse, Don't Validate — Review

Read-only review applying Alexis King's "Parse, Don't Validate" to a diff or a set of files. Report findings; do not edit.

## The principle in one line

A **validator** checks a condition and throws the result away. A **parser** checks the same condition and returns a value whose *type* records that the check happened, so downstream code cannot forget it and never re-checks it.

```
validate: Input -> ()            # knowledge lost; caller still holds raw Input
parse:    Input -> Refined       # knowledge kept; caller holds Refined
```

Everything below is a way of spotting the first shape where the second was possible.

## Scope

Accept optional arguments:

- `--base=<ref>`: review the diff against this ref (default: `origin/main`, then `origin/master`, then upstream). Without a diff target and no paths, review the current branch diff.
- `--paths=<path-or-glob>`: review these files in full instead of a diff.
- `--include-dirty`: include staged, unstaged, and untracked changes.

Paths named in the user's request are the effective `--paths` scope, even when no explicit flag is present. When `--include-dirty` is active, enumerate untracked files rather than relying only on Git diff output.

Exclude generated, vendored, lock, and fixture files. State the reviewed scope up front and never claim a clean verdict for code you did not read.

## Establish context first

1. Read `AGENTS.md` / `CLAUDE.md` and note how the project already models domain types (newtypes, dataclasses, branded types, enums, smart constructors).
2. For each changed function that touches external or loosely-typed data, trace it upward to the boundary it came from (I/O, config, HTTP, DB, CLI args, env) and downward to every consumer.
3. Prefer static reading. Do not run the test suite or reformat anything.

## What to look for

Apply only the lenses relevant to the change. Every finding must cite the code and name the invariant.

### 1. Validators that return nothing

- Functions whose success path returns `()`, `None`, `void`, `bool`, or just "didn't throw" while the caller keeps using the original raw value and the language or type checker does not refine its type.
- `assert`, `check_*`, `ensure_*`, `validate_*`, `is_valid_*` helpers whose result is not needed by the type checker to continue. Do not flag language-supported type predicates, type guards (`TypeGuard`/`TypeIs`), assertion functions, or recognized assertions when they narrow the downstream type and therefore carry the proof.
- Ask: what did this function *learn*? Could it return a value that carries that knowledge (`NonEmpty[T]`, `PositiveInt`, `Email`, `ParsedConfig`, `Map` instead of list-of-pairs)?

### 2. Weakened return types where the argument should be strengthened

- `head :: [a] -> Maybe a` shape: a function that returns `Optional`/`Maybe`/`null`/`Result` only because its input type is too permissive.
- The fix direction is usually to demand a stronger input (`NonEmpty a -> a`) and push the parse to the boundary, not to make every caller unwrap.
- Flag when a `Maybe`/`Optional` produced this way is then handled with `unwrap()`, `!`, `.get()`, `or raise`, or an `else: raise Impossible` branch.

### 3. Redundant re-checking and "impossible" branches

- The same invariant checked in more than one place along a call chain (length > 0, key present, string non-blank, id well-formed).
- Branches annotated `# unreachable`, `error "impossible"`, `assert False`, `default: throw new IllegalStateException("cannot happen")`.
- Non-null assertions, casts, or `as` conversions that exist only because an earlier check did not change the type.
- Each of these is a place where a proof was established earlier and then lost.

### 4. Shotgun parsing

- Validation interleaved with business logic instead of performed once at the boundary: parse a field, do a side effect, parse another field, do another side effect.
- Effects (writes, network calls, file creation) that run *before* all required input has been proven valid, leaving partially applied state when a later check fails.
- Direction: stratify into a parse phase that produces one fully-typed value, then an execution phase that consumes it.

### 5. Representations that admit illegal states

- Lists of pairs where a map is meant; parallel arrays that must stay the same length; two booleans where an enum of three states is meant; a struct with several `Optional` fields where only certain combinations are valid.
- Denormalized copies of the same fact that must be kept in sync by hand.
- Strings carrying structure (`"user:123"`, comma-separated lists, raw JSON) passed several layers deep before being decoded.
- Direction: choose the data type that makes the illegal combination unrepresentable, so the check happens by construction.

### 6. Where the parse lives

- Parse an invariant at the earliest point where it is both knowable and required. This is often the system boundary (deserialization, CLI, request handler, config loader), but variant-dependent invariants may be parsed after a discriminator or control-flow branch selects the relevant representation.
- Multi-pass and branch-sensitive parsing are valid when later invariants cannot yet be known or do not apply earlier. Require that no effect depending on the unproven invariant occurs before that later parse; a parse buried in a helper called from ten places is still a sign the boundary is unclear.
- When full type enforcement is impractical, a wrapper type with a private constructor and a single smart-constructor entry point is an acceptable substitute — check that there is exactly one way to build it and that the raw constructor is not exported.

### 7. Over-parsing

Report when the principle is being *over*-applied:

- A newtype introduced for a value with no invariant.
- A "proof" type that is trivially constructible from raw data anywhere, so it proves nothing.
- Parsing done eagerly on data that the program never uses.

The goal is that types reflect real invariants, not that every string gets a wrapper.

## Evidence and restraint

For each candidate finding:

1. Cite the check and every place the raw value is used afterward.
2. Name the invariant that was established and where it is lost or re-derived.
3. Check whether an existing constraint (framework contract, upstream schema, database constraint) already makes the value safe; if so, the finding may reduce to "document the guarantee" or disappear.
4. Propose the smallest type change that lets the compiler or type checker carry the proof. Prefer changing one return type and one argument type over introducing a type hierarchy.
5. State what must be preserved: error messages, error timing, serialization format, public API shape.

Do not report style, naming, formatting, or general cleanup. Do not recommend a wholesale domain-model rewrite when moving one check to the boundary suffices. Do not treat a language without a strong type checker as exempt — the principle still applies through constructors, dataclasses, TypedDict/Pydantic, branded types, or opaque types; adjust the remedy to the tooling the project already uses.

## Output

Rank findings by how much downstream code depends on the lost proof. Use:

```text
[level] file:line — concise title
Invariant: what the check establishes
Lost at: where the proof is discarded, re-derived, or bypassed
Consumers: downstream code that still holds the raw value
Direction: minimal type-level change (strengthen argument / return refined type / pick a stricter representation / move parse to boundary)
Preserve: behavior, errors, or compatibility that must not change
Confidence: high | medium
```

Levels:

- **Defect**: a concrete path where the lost proof leads to a real bug (an unchecked value reaches code that assumes the invariant, or a partial effect is left behind).
- **Lost proof**: a validator or re-check with no current bug, but downstream code must remember the invariant by convention.
- **Representation**: a data type that permits illegal states, with the specific illegal state named.
- **Over-parse**: a wrapper or parse step that proves nothing or is never consumed.

Omit low-confidence findings. Prefer three findings someone can act on over a catalog of smells.

End with the reviewed scope and one of:

- `Parses at the boundary`: no findings of any level in the reviewed scope.
- `Over-parsing`: at least one Over-parse finding and no Defects, Lost proofs, or Representation findings.
- `Proofs lost`: at least one Lost proof or Representation finding, no Defects.
- `Changes recommended`: at least one Defect.
- `Partial review — disposition limited to reviewed scope`: material scope not read.
