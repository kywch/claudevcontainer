# Implementation Guide Research

Non-normative provenance for spec-kit implementation guidance. Read this only to
audit why guidance exists or preserve provenance; it is not needed for normal
spec-kit creation. Do not treat this file as target-repo requirements.

## Executive Summary

Spec-led implementation work benefits from precision over volume:

- think before coding
- keep scope small
- keep dependencies minimal
- make surgical changes
- define verification before implementation
- use named quality gates
- document architecture agents should not rediscover
- separate normative contract from local tooling guidance

The inspected repos converge on the same pattern: one operational guide, exact
command matrix, clear ownership boundaries, strict local tooling, observable
behavior tests, and deferred automation until project scale earns it.

## Sources Inspected

| Ecosystem | Repo / Source | Why It Matters |
| --- | --- | --- |
| General | `https://github.com/forrestchang/andrej-karpathy-skills` | concise agent coding principles and skill-style task guidance |
| TypeScript | `https://github.com/jayminwest/seeds` | Bun/TS CLI, small protocol repo, agent workflow discipline |
| TypeScript | `https://github.com/vercel/chat` | production TypeScript monorepo, strict tooling, docs-to-architecture mapping |
| TypeScript | `https://github.com/openai/openai-agents-js` | agent framework, skills, ExecPlans, release/change validation |
| Python | `https://github.com/PrefectHQ/fastmcp` | Python MCP/server framework, `uv`, `pyproject`, agent guidance |
| Python | `https://github.com/huggingface/smolagents` | Python agent framework, public API/data-contract lessons |
| Go | `https://github.com/uber-go/guide` | Go API, error, concurrency, and test style |
| Go | `https://google.github.io/styleguide/go/` | clarity-first Go guidance |
| Go | `https://github.com/gastownhall/gascity` | agent-heavy Go CLI/SDK repo patterns |
| Rust | `https://github.com/pydantic/monty` | Rust runtime project and CLI/runtime boundaries |
| Rust | `https://github.com/astral-sh/uv` | production Rust CLI/workspace and real-binary testing posture |
| Rust | `https://github.com/BurntSushi/ripgrep` | mature Rust CLI with reusable crate boundaries |
| Rust | `https://github.com/RAprogramm/RustManifest` | Rust style, review, and safety guidance |

## Source Takeaways

### General Agent Principles

`forrestchang/andrej-karpathy-skills` contributed the posture:

- name assumptions instead of hiding uncertainty
- make smallest useful change
- keep changes surgical
- define success criteria before implementation
- loop until verified, not until code is merely written

Spec-kit turns these into workflow defaults: classify each slice, state source
precedence, define verification, and keep spec/guidance/code synchronized.

### TypeScript Sources

`jayminwest/seeds` contributed:

- Bun as fast CLI/test runtime
- direct source execution for short feedback cycles
- repo-local agent guidance and closeout discipline
- small command-oriented implementation shape
- quality gates before handoff

`vercel/chat` contributed:

- strict TypeScript as a default posture
- tooling policy owned by package config
- production dependency restraint
- architecture notes that keep agents from reverse-engineering every flow
- monorepo patterns where local package guidance exists only when workflow
  differs

`openai/openai-agents-js` contributed:

- skills as reusable task playbooks
- explicit validation before release or handoff
- changeset/release checks for published packages
- ExecPlan-style long-running work breakdown
- hooks and checks that run on touched work where scale justifies them

Spec-kit adopted: TypeScript/Bun as good first executable pass, strict typecheck
and lint, package scripts as command truth, skill references one level deep, and
named gates. Spec-kit defers: changesets, hooks, generated package docs, and
monorepo release automation until target repo scale warrants them.

### Python Sources

`PrefectHQ/fastmcp` contributed:

- `AGENTS.md` as operational agent entry
- `pyproject.toml` as tooling source of truth
- `uv` for reproducible local workflow
- Ruff and type checking as named gates
- examples that can become executable behavior checks
- explicit generated and noisy paths

`huggingface/smolagents` contributed:

- public API facades should be intentional
- tool/data contracts need useful runtime diagnostics
- examples should stay runnable when they carry public behavior
- provider/model matrices belong in tests only when product surface needs them

Spec-kit adopted: Python as strong portability/PBT pass, pytest/Hypothesis for
subprocess and helper properties, type/lint gates as local truth, and low
runtime dependencies. Spec-kit defers: provider matrices, example execution,
secret scanning, and public SDK curation unless target scope requires them.

### Go Sources

`uber-go/guide` and Google Go style guidance contributed:

- clarity before cleverness
- small interfaces owned by consumers
- explicit error handling
- explicit goroutine lifecycle
- diagnostic tests with helpers and temp dirs
- table tests for edge cases

`gastownhall/gascity` contributed:

- Makefile targets as agent-facing command API
- domain package ownership maps
- generated artifact drift checks where generation exists
- concrete safety rules for process and external-state operations
- agent-heavy workflow guidance that stays operational rather than
  tutorial-like

Spec-kit adopted: Go as portability check for stdlib CLI and process/filesystem
behavior, Makefile gates when present, table tests, temp dirs, and fuzz targets
for parsers/validators. Spec-kit defers: broad `pkg/` API policy, generated
drift checks, shard runners, and cross-platform matrices until needed.

### Rust Sources

`astral-sh/uv`, `BurntSushi/ripgrep`, `pydantic/monty`, and RustManifest
contributed:

- split crates only when a boundary earns it
- keep CLI/schema glue separate from behavior as scale grows
- use real-binary tests for stable CLI output
- keep internal errors typed and public output stable
- avoid panics and unchecked unwraps in production paths
- make feature flags additive
- review production diff size, not just test diff size

Spec-kit adopted: Rust as hardening pass for state, errors, path/storage/lock
behavior, real-binary integration tests, strict lint/test gates, and explicit
error mapping. Spec-kit defers: `nextest`, coverage, audit/deny, mutation
tests, snapshots, and crate splits until target repo needs them.

## Cross-Repo Commonalities

### Agent Guides Are Operational

Common pattern:

- one top-level guide says where to work, what to run, what not to break
- package/local guides exist only when local workflow differs
- critical invariants appear in durable docs, not only source comments
- guide detail grows with architecture, generated files, and safety hazards

Spec-kit recommendation:

- use `spec/workflow.md` or equivalent for source order, change loop, review
  loop, and closeout
- use per-implementation guidance only when local tooling/layout/gates differ
- keep shared protocol rules in spec or shared guide, not duplicated per port

### Quality Gates Are Named Commands

Common pattern:

- done maps to commands, not prose
- fast and full gates are distinct
- targeted gates are selected by touched path
- gate truth lives in `package.json`, `pyproject.toml`, `go.mod`, Makefile,
  Cargo files, or CI config

Spec-kit recommendation:

- every language guide lists setup, fast check, full check, conformance
- guidance must not claim a gate exists unless repo tooling exposes it
- release evidence records command, pass/fail count, and skipped checks

### Tooling Policy Lives In Config

Common pattern:

- formatter/linter/typechecker settings live in tool config
- prose names commands and ownership, not every option
- dependency policy says when to add dependencies, not a hard universal ban

Spec-kit recommendation:

- shared guide explains dependency and verification principles
- language guide points to config files and exact commands
- future tools live in `Adopt Later` with trigger

### Tests Mirror Observable Behavior

Common pattern:

- public CLI/API behavior gets real process or near-process tests
- storage behavior uses real temp dirs
- pure helpers get unit/property tests
- unhappy paths matter because they define useful diagnostics and stutter
- examples become tests only when they carry public behavior

Spec-kit recommendation:

- conformance for language-neutral observable behavior
- local regression for implementation mechanics
- property tests for pure helpers with independent oracle
- model/refinement tests for lifecycle, graph, ordering, locking, or replay

### Public API Is Late And Curated

Common pattern:

- public API is intentional facade, not accidental reexport
- CLI glue should not become SDK surface accidentally
- package/crate splits happen after real reuse or review boundary appears

Spec-kit recommendation:

- keep `spec/implementation.md` implementation-neutral
- do not specify SDK/public APIs unless target spec owns them
- mark SDK and package split ideas as deferred until trigger appears

## Guidance Derived For Spec-Kit

Spec-kit recommends:

- `spec/implementation.md` only for normative implementation-neutral contract
- shared implementation guidance under `spec/` for cross-port guidance
- per-language guidance under `spec/implementation/` for current facts,
  tooling, local commands, and traps
- research notes as provenance/deferred ideas only
- TypeScript or another fast runtime first when iteration speed matters
- Rust or another strict implementation as hardening when state, error,
  storage, or path rigor matters
- Go/Python or other ecosystem ports to expose portability leaks

## Deferred Ideas

Add only when target repo scale earns them:

- generated drift checks
- file-size and dead-code gates
- doc execution gates
- secret scanning once examples or provider tests involve tokens
- sharded test runners
- cross-platform CI matrices
- release evidence automation
- crate/package splits
- public SDK facades
- snapshot tests for stable public output
