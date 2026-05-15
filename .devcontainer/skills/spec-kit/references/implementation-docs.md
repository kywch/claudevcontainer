# Implementation Guidance

Use implementation notes to keep implementation work repeatable without turning
tooling guidance into protocol law. Keep target artifacts under `spec/` so the
spec kit is self-sufficient.

## Contract Vs Guidance

Separate roles before choosing filenames:

- **Implementation contract**: optional normative, implementation-neutral
  requirements that every conforming implementation must satisfy.
- **Shared implementation guide**: optional non-normative guidance that applies
  across ports and prevents repeated rediscovery.
- **Per-port guide**: optional current facts for one active language, runtime,
  platform, or package.
- **Guide template**: optional scaffold for adding another port consistently.
- **Research notes**: optional provenance and deferred ideas.

Use target-repo names. Good default mapping:

- implementation contract: `spec/implementation.md`
- shared implementation guide: `spec/implementation-guide.md`
- per-port guide: `spec/implementation/typescript.md`,
  `spec/implementation/rust.md`, `spec/implementation/go.md`,
  `spec/implementation/python.md`, or another port name
- guide template: `spec/implementation-template.md`
- research notes: `spec/implementation-research.md`

Do not rely on archived worklogs or research notes as current sources. Mine
them, then move current lessons into durable guidance or spec clauses.

For provenance behind spec-kit guidance, read
`references/implementation-guide-research.md` only for provenance or audit
requests. In a target repo, create a research notes file only when the user wants
provenance preserved.

## Implementation Contract

Create `spec/implementation.md` only when implementation requirements are part
of the contract and must apply to every port.

Good content:

- conformance target and required observable surface
- required stability boundaries: stdout/API envelopes, file formats, exit/status
- implementation-neutral external-effect rules: network policy,
  credential/secret handling, path/resource rules, and allowed side effects
- deterministic hooks for conformance, if they are protocol-visible
- portability requirements that affect observable behavior
- what implementations must not expose or depend on

Bad content:

- language choice
- package manager
- formatter/linter
- module layout
- preferred helper libraries
- local developer workflow

If behavior is only advice, keep it in `spec/implementation-guide.md` or a
per-port guidance file, not the normative contract.

## Shared Implementation Guide

Use one shared guide when multiple implementation tasks would rediscover the
same rules. Default name: `spec/implementation-guide.md`.

Cover:

- source precedence reminder
- decision rules and slice triage
- implementation-only vs test-only vs normative changes
- protocol-sensitive boundaries: CLI/API, storage, locking, deterministic hooks
- safety and side effects
- local tests, property tests, model refinement, Quint replay guidance
- review checklist and closeout expectations

Keep shared guide language-agnostic. It explains behavior risks and verification
strategy, not every language command.

## Per-Language Guides

For multi-language specs, use per-port guides such as:

- `spec/implementation/typescript.md`
- `spec/implementation/rust.md`
- `spec/implementation/go.md`
- `spec/implementation/python.md`

Each guide should follow this shape:

- status: spec target, conformance status, known gaps, last checked
- runtime and tooling: versions, package manager, lockfile, formatter/linter,
  type checker, test tools, conformance command
- project layout: current files and ownership
- implementation repo files: local README/AGENTS status when relevant
- CLI/API boundary: entry point, parser, dispatch, envelopes, exit mapping
- storage/data boundary: representation, unknown fields, writes, locks, path
  checks, config parsing
- testing: runner, temp-project helper, subprocess/helper APIs, PBT/model replay
- style: language-specific conventions only
- local commands: setup, fast check, full local check, conformance
- adopt later: future items with triggers

Do not duplicate shared protocol rules in every language guide. Link back to
the shared guide and the normative implementation contract when present.

For one implementation, `spec/implementation-guide.md` can be enough. Split
into per-port files only when multiple ports exist or are expected soon.

## Conformance Runner Decision

Do not include a runner implementation by default. Start with conformance cases
as portable data. Add `spec/conformance/runner/` only when the cases and ports
need one shared black-box execution path.

Good triggers:

- two or more active implementations run the same observable checks
- external consumers need a single release gate
- port-local harnesses produce inconsistent results
- case format is stable enough to validate with `case.schema.json`

Wait if:

- there is only one implementation
- cases are still exploratory
- an existing upstream harness already runs them well
- maintaining the runner would slow spec iteration more than it prevents drift

## Generalized Tooling Notes

For each language guide, list exact runtime/toolchain, package manager or
lockfile policy, local gates, conformance command, public-boundary entry points,
and port-specific risks. Do not copy generic ecosystem advice unless it affects
the current port.

## Research Notes

Use research notes when:

- explaining why tooling or workflow guidance exists
- preserving cross-repo lessons
- recording deferred automation/tooling ideas
- comparing ecosystem-specific patterns

Research notes are not living protocol or gate truth. Promote current facts to
the shared guide, language guides, or `spec/` before relying on them in
handoff.

When building a spec-kit from this skill, keep source research under
`references/implementation-guide-research.md`. For a target repo, create a
`spec/implementation-research.md` only if the user wants provenance preserved.

## Guidance Drift Checks

Before handoff:

- commands in guidance exist in package scripts, Makefile, Cargo, or repo
  tooling
- guide status matches current implementation path
- generated/noisy paths are named
- guidance does not claim conformance without current evidence
- future ideas live under `Adopt Later`, not status
- research notes are cited as provenance only
- `spec/implementation.md`, if present, contains only normative
  implementation-neutral contract
