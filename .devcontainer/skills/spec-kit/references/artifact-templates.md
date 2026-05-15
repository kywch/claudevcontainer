# Artifact Templates

For complete tiny examples, see `../examples/minimal/` and
`../examples/multi-impl/`. Load them only when examples would clarify template
use; do not copy their domain details into target specs.

## spec/README.md

Keep optional sources out of precedence until they exist.

```markdown
# <Spec Name> <Version>

Status: draft

<One paragraph: what this spec defines.>

## Normative Precedence

1. `spec/glossary.md`
2. accepted decisions in `spec/decisions.md`
3. numbered clauses in normative spec files, excluding explicitly
   non-normative guide/template/research/workflow files
4. schemas in `spec/schemas/`, when present
5. conformance cases in `spec/conformance/cases/`, when present
6. canonical state/model artifacts in `spec/quint/`, when present
7. implementations as evidence only, never as normative source

Non-normative guidance, examples, research notes, and exploratory models never
fill contract gaps.

Accepted decisions remain normative until explicitly superseded. When a decision
is incorporated into clauses, keep the decision consistent or mark it superseded.

## Reading Order

1. `spec/glossary.md`
2. `spec/decision-index.md`, when present
3. `spec/decisions.md`
4. <numbered clause files>

## Scope

- <in-scope behavior>

## Out Of Scope

- <explicit non-goals>

## Conformance Command

```bash
<runner command>
```
```

## Decision Index Row

```markdown
| [DEC-0001](decisions.md#dec-0001-short-name) | YYYY-MM-DD | <spec-version> | <area> | <compat> | <summary>. |
```

## spec/glossary.md

```markdown
# Glossary

This file is normative. If term usage elsewhere conflicts with this glossary,
this glossary wins.

## Terms

- **Term**: Definition. Source: `spec/behavior.md#b1`.

## Terminology Normalization

| Context | Canonical | Not |
| --- | --- | --- |
| Field/API/name | `canonicalName` | `oldName`, `ambiguousName` |
```

## spec/decisions.md

```markdown
# Decisions

This file is the accepted decision log. Decisions are normative until explicitly
superseded. When numbered clauses incorporate a decision, keep this log
consistent or mark the old decision superseded.

## Decision Template

Copy this entry for each accepted decision.

## DEC-0001 <Short Name>

Status: accepted
Date: YYYY-MM-DD
Spec: <spec-version>
Area: <logic|state|storage|io|schema|conformance|versioning|implementation>
Compatibility: <copy|correct|defer|new|breaking>
Supersedes: <DEC-ID or none>
Superseded-By: <DEC-ID/clause or none>

### Context

<Why decision exists.>

### Decision

<Chosen behavior.>

### Consequences

<Tradeoffs.>

### Conformance

<Cases to add/update. If none, give reason: non-observable, covered by existing
case, or decision-only.>

### Verification Impact

<Schema, conformance, model, or implementation checks to add/update. Omit
artifact types that do not apply.>

### Affected Artifacts

- clauses: <files or none>
- schemas: <files or none>
- conformance: <cases or none>
- models: <files or none>
- implementations: <ports or none>

### References

- <evidence>
```

## spec/decision-index.md

```markdown
# Decision Index

Routing table for `spec/decisions.md`. The full decision log remains
normative.

| DEC | Date | Spec | Area | Compat | Summary |
| --- | --- | --- | --- | --- | --- |
| [DEC-0001](decisions.md#dec-0001-short-name) | YYYY-MM-DD | <version> | <area> | <compat> | <summary>. |

## Pending Decisions

| ID | Question | Impact | Blocking | Default | Affected Artifacts |
| --- | --- | --- | --- | --- | --- |
| None | n/a | n/a | n/a | n/a | n/a |
```

## Numbered Clause

```markdown
## L1 <Behavior Family>

L1.1 <Normative statement using MUST/SHOULD only when useful.>

L1.2 <Validation or edge behavior.>

L1.3 <Error/no-op/storage effect if relevant.>

### Traceability

| Decision | Schema | Conformance | Model | Notes |
| --- | --- | --- | --- | --- |
| <DEC or n/a> | <schema or n/a> | <case or n/a> | <model or n/a> | <non-normative notes> |
```

## spec/behavior.md

```markdown
# Behavior

This file is normative. If it conflicts with higher-precedence sources, the
higher source wins.

## B1 <Core Behavior>

B1.1 <Normative rule.>

B1.2 <Input/validation rule if visible to users or implementations.>

B1.3 <Observable output/state/error behavior.>

## B2 <Next Behavior>

B2.1 <Normative rule.>
```

## spec/errors.md

```markdown
# Errors

This file is normative. If it conflicts with higher-precedence sources, the
higher source wins.

Stable error shape and codes.

## E1 Error Shape

E1.1 <Envelope/API/exception shape.>

## E2 Codes

| Code | Condition | Stable fields | Source |
| --- | --- | --- | --- |
| `<CODE>` | <when returned> | <fields> | <clause/DEC> |
```

## spec/versioning.md

```markdown
# Versioning

This file is normative. If it conflicts with higher-precedence sources, the
higher source wins.

## V1 Version Identifier

V1.1 <How spec version is named and exposed.>

## V2 Compatibility

V2.1 <Compatible change policy.>
V2.2 <Breaking change policy.>

## V3 Migration

V3.1 <Migration/upgrade policy, or explicit non-goal.>
```

## spec/state.md

```markdown
# State

This file is normative. If it conflicts with higher-precedence sources, the
higher source wins.

## S1 States

| State | Meaning | Terminal |
| --- | --- | --- |
| `<state>` | <meaning> | <yes/no> |

## S2 Transitions

S2.1 <Allowed transition and preconditions.>
S2.2 <Rejected transition and error/no-op behavior.>

## S3 Invariants

S3.1 <Invariant that must hold after every operation.>
```

## spec/storage.md

```markdown
# Storage

This file is normative. If it conflicts with higher-precedence sources, the
higher source wins.

## ST1 Layout

ST1.1 <Persisted files/tables/keys if normative.>

## ST2 Read Semantics

ST2.1 <Encoding, parsing, missing/corrupt behavior.>

## ST3 Write Semantics

ST3.1 <Atomicity, locking, no-op/rejection stutter, durability.>

## ST4 Safety

ST4.1 <Path/symlink/network/secret constraints.>
```

## spec/io.md

```markdown
# IO

This file is normative. If it conflicts with higher-precedence sources, the
higher source wins.

## I1 Surface

I1.1 <Public operation/API/file/event entry points.>

## I2 Success Output

I2.1 <Stable success response shape.>

## I3 Error Output

I3.1 <Stable error response shape and status/exit behavior, if applicable.>

## I4 Determinism

I4.1 <Time/id/random/order controls if normative.>
```

## spec/implementation.md

```markdown
# Implementation Contract

This file is normative only for implementation-neutral requirements that every
conforming implementation must satisfy.

## IM1 Required Boundary

IM1.1 <Required observable surface or conformance target.>

## IM2 External Dependencies And Side Effects

IM2.1 <Allowed or forbidden network, credential, filesystem, global-state,
process, clock, randomness, or service dependencies, if normative.>

## IM3 Portability

IM3.1 <Implementation-neutral portability requirement.>
```

## spec/implementation-guide.md

```markdown
# Implementation Guide

Non-normative guidance. If this conflicts with `spec/README.md` source
precedence, the higher source wins.

## Source Precedence

Follow `spec/README.md` source precedence. If implementation behavior,
conformance, schemas, clauses, decisions, or glossary conflict, follow the
higher source and report the mismatch. Do not change normative behavior to fit
one implementation.

## Slice Triage

<copy/correct/defer/new rules for implementers.>

## Testing

<Local tests vs conformance vs property tests vs model replay.>

## Review Checklist

- <check>
```

## spec/implementation-template.md

Create this only when new ports are repeatedly created and need one shared
shape.

```markdown
# <Language> Implementation Guide

Non-normative. Describe how this port realizes shared rules.

## Status

- spec target: <version>
- conformance status: <current evidence>
- known gaps: <gaps>
- last checked: YYYY-MM-DD

## Runtime And Tooling

<runtime, package manager, lockfile, formatter, linter, type checker, tests>

## Project Layout

<current files and ownership>

## Boundary Mapping

<entry point, parser/API boundary, storage/data boundary, output/error mapping>

## Tests And Commands

<setup, fast check, full check, conformance>

## Adopt Later

- <item>: <trigger>
```

## spec/implementation/LANGUAGE.md

Do not create this file unless the port is active or planned and facts are
current.

```markdown
# <Language> Implementation

Non-normative current facts for this port. Protocol meaning belongs in
decisions, numbered clauses, schemas, and conformance.

## Status

- spec target: <version>
- active path: <path>
- conformance status: <evidence>
- known gaps: <gaps or none>

## Runtime And Tooling

<language version, package manager, lockfile, tool configs>

## Local Commands

```bash
<setup>
<fast check>
<full check>
<conformance>
```

## Port-Specific Risks

- <risk and mitigation>
```

## spec/implementation-research.md

```markdown
# Implementation Research

Non-normative provenance. Promote current facts into decisions, clauses, or
implementation guidance before relying on them.

## Sources

| Source | Why inspected | Takeaway |
| --- | --- | --- |
| <repo/doc> | <reason> | <lesson> |

## Adopted Guidance

- <guidance and where it landed>

## Deferred Ideas

- <idea>: <trigger>
```

## spec/workflow.md

```markdown
# Workflow

Non-normative process guidance for changing this spec kit.

## Change Loop

1. Identify governing source.
2. Classify as `copy`, `correct`, `defer`, or `new`.
3. Update decisions/clauses/schemas/conformance/model/implementation as needed.
4. Run targeted gates.
5. Review and verify.

## Review Loop

<When to request read-only reviews and how to close findings.>
```

## spec/quint/README.md

```markdown
# Quint Model

`<model>.qnt` is an abstract model for <state/graph/concurrency concern>.

This model intentionally excludes <IO/schema/runtime details>. Those belong in
schemas, conformance, or implementation guidance.

## Models

- `<model>.qnt`: <what it shadows>.

## Negative Controls

- `<model>_bug.neg.qnt`: <bug this should catch>.
```

## spec/quint/<model>.qnt

```quint
// SPEC: <spec-version> (role: example|canonical)
// SHADOWS: spec/<file>.md :: <clause>
// INVARIANTS: <invariant names>
// REPLAY: spec/conformance/cases/<case>.yaml (canonical traces only)
// LAST-SYNCED: <spec-version> YYYY-MM-DD
//
// Abstract model for <state>. Excludes <out-of-scope details>.

module <model> {
  pure val IDS = Set("a", "b")

  var existing: Set[str]

  action init = all {
    existing' = Set(),
  }

  action create(id: str): bool = all {
    IDS.contains(id),
    not(existing.contains(id)),
    existing' = existing.union(Set(id)),
  }

  val knownOnly =
    existing.subset(IDS)
}
```

## Conformance Case Skeleton

Use the target runner's schema. Generic shape:

```yaml
id: <case-id>
title: <short title>
sources:
  - <clause-or-decision-ref>
operation: <public operation>
input:
  <key>: <value>
expect:
  outcome: <success|error|no-op>
  observable:
    <key>: <value>
```

SeedSpec-style YAML runner shape:

```yaml
id: <case-id>
specVersion: <spec-version>
title: <short title>
fixture: <fixture-name>
steps:
  - name: <step-name>
    argv: [<command>, <arg>]
    expect:
      exitCode: 0
      json:
        ok: true
```

Adjust schema to target runner. Keep each case focused on one failure mode.

## spec/schemas/*.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/schemas/<name>.v1.schema.json",
  "title": "<Name>",
  "type": "object",
  "description": "Boundary data shape. Source: spec/<file>.md#<clause> and/or DEC-0001.",
  "required": ["<field>"],
  "properties": {
    "<field>": {
      "type": "string",
      "description": "Source: spec/<file>.md#<clause>."
    }
  },
  "additionalProperties": false
}
```

State unknown-field policy explicitly. If unknown fields must survive or be
accepted, use `additionalProperties: true` or a typed extension field and cite
the governing clause/decision.

## Traceability Matrix

Required before release candidate for multi-implementation specs.

```markdown
| Behavior | Glossary Term | Clause | DEC | Schema | Error Code | Conformance | Model | Impl/Local Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <behavior> | <term or n/a> | <clause> | <DEC or n/a> | <schema or n/a> | <code or n/a> | <case or n/a> | <model or n/a> | <test or n/a> |
```

Omit columns that do not apply to the target kit. Use `deferred: <reason>` or
`untestable: <reason>` instead of blank coverage.

## Review Log

Use for non-trivial review-fix loops.

```markdown
| ID | Lens | Severity | Finding | Disposition | Fix / Deferral | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | source alignment | blocker | <file:line issue> | fixed | <files/commit or reason> | <command/review> |
```

## Review Prompt

```text
Critically review <files/area> against <spec/guidance/prior findings>.
Do not edit files.
Focus on <specific risks>.
Return findings ordered by severity with file:line refs and concrete fixes.
```

## Verification Prompt

```text
Verify recent fixes in <files>.
Do not edit files.
Check whether prior issues are fixed:
- <finding>
Look for regressions or remaining gaps.
Return remaining findings only, severity ordered, with file:line refs.
```
