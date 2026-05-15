# Chunking Strategies

Use this when planning a new implementation port, subsystem, or broad feature.
Prefer behavior-first seed DAGs over file-first DAGs. Source mapping belongs in
planning; add discovery seeds only when planning research leaves real unknowns.

## Default Recommendation

Use a hybrid:

```text
thin layered foundation
  -> vertical behavior/command slices
  -> conformance batches as verifier gates
  -> hardening and review tail
```

This balances stable shared invariants with early runnable behavior. It is the
best default for `seedstack run auto` because it keeps the graph stable while
still producing useful end-to-end checkpoints.

## Strategy Table

| strategy | pros | cons | use when |
| --- | --- | --- | --- |
| layered | Shared invariants land once; stable dependency graph; good for storage, path, lock, parsing, and validation. | Delays visible CLI progress; foundation seeds can grow too large; can over-abstract. | Build a thin spine only, then switch to behavior slices. |
| vertical behavior slices | Early runnable behavior; acceptance is clear; easier local integration tests. | Shared rules can drift if foundation is weak; can duplicate storage or parser fixes. | After minimal foundation exists; use for commands, workflows, and user-visible contracts. |
| conformance-case batches | Strong external oracle; good protocol checklist; catches cross-implementation drift. | Failures can be hard to localize; can overfit runner; conformance may miss local mechanics. | Use as verifier gates or aggregate seeds, paired with local tests. |
| file/module slices | Simple ownership; clean diffs; easy module review. | Weak behavioral proof; incomplete code piles up; interfaces harden before real use. | Scaffolding or refactor checkpoints only, not primary build order. |
| MVP then harden | Fast demo and early full-path signal. | High retrofit risk for locks, health, raw storage stutter, path safety, and unknown fields. | Throwaway spike only, or when hardening seeds are mandatory and immediate. |

## Choosing A Shape

Use this decision flow:

```text
Need shared invariants before behavior?
  -> yes: thin foundation seed
  -> no: vertical behavior seed

Does a seed only name files/modules?
  -> rewrite around observable behavior or helper invariant

Does conformance cover the behavior?
  -> include conformance as a gate or aggregate verifier,
     but keep local tests for mechanics conformance cannot diagnose

Would the run graph change after first dispatch?
  -> move source mapping and sizing into planning,
     or split only with user approval / true blocker
```

## Foundation Guidance

Keep foundation mandatory but thin. Good foundation owns:

- stable error/envelope and command dispatch shell
- validation helpers and deterministic hooks
- config and JSONL parsers
- raw issue model and unknown-field preservation primitives
- project discovery and minimal path checks
- lock and atomic mutate harness if mutating commands are next

Avoid finishing a module that has no real behavior path. A module seed is not
done until at least one local test proves how a behavior will use it.

## Behavior Slice Guidance

Seed titles should name contracts, not files:

- good: `Implement atomic ready selection`
- weak: `Implement store.go`

For command-driven systems, prefer behavior order that unlocks tests:

```text
scaffold/envelope
  -> init/discovery/config
  -> create/read storage
  -> mini end-to-end smoke
  -> update/close lifecycle
  -> graph/deps
  -> ready/blocked/claim
  -> CLI syntax parity
  -> full conformance
  -> review/cleanup/release
```

Adjust order for the product, but preserve true dependencies.

Add an early mini end-to-end smoke as soon as the first mutating happy path is
real. For work-queue-like CLIs this is usually `init` plus `create`, run through
the binary or process boundary. The smoke is not a new architecture style and
does not make the plan vertical; it is a confidence checkpoint that proves the
layered spine can drive real user behavior before later command slices build
on it.

## Verification Ownership

Local tests ride with the seed that owns the behavior:

- pure helpers: unit/PBT in the helper seed
- lifecycle/dependency/readiness: integration plus model replay when useful
- mutating commands: raw no-op/error stutter tests
- storage/path/locks: local filesystem tests, not conformance alone
- protocol-visible behavior: targeted conformance gate or aggregate full run

Green conformance is not release readiness. It proves shared protocol behavior,
but local tests still own atomic writes, lock reloads, path safety, raw storage
stutter, unknown-field preservation, helper invariants, and weak-oracle risks.

## Anti-Patterns

- Pure file/module DAG for new behavior.
- One huge MVP seed followed by vague hardening.
- Discovery seed used as substitute for planning research.
- Full conformance seed used as the first proof that behavior works.
- Mutating command seed without raw no-op/error stutter proof.
- Conformance batch with no source refs or local tests for implementation
  mechanics.
- Tiny seed explosion that makes `run auto` spend more time managing graph than
  building behavior.
