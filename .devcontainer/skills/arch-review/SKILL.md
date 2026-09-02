---
name: arch-review
description: Review a branch or code change for architectural regressions, structural simplification opportunities, and latent bugs caused by ownership, state, boundary, atomicity, or concurrency design. Use for an architecture review, deep structural review, or deliberately strict maintainability audit; do not use for ordinary cleanup, test-only review, or documentation review.
---

# Architecture Review

Perform a read-only, evidence-backed review of the architecture affected by a change. Look beyond local style without turning the review into an unconstrained redesign.

Do not edit files during the review. Report findings and wait for a separate implementation request.

## Provenance

Adapted from Cursor's [Thermo-Nuclear Code Quality Review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md), Copyright (c) 2026 Cursor, under the [MIT License](https://github.com/cursor/plugins/blob/main/cursor-team-kit/LICENSE). This Codex adaptation paraphrases its structural-simplification rubric and adds read-only scope, evidence and severity requirements, independent latent-bug analysis, and concurrency safeguards. See [LICENSE.cursor-team-kit](LICENSE.cursor-team-kit).

## Scope

Review the current branch against a base ref. Accept these optional arguments:

- `--base=<ref>`: comparison base; otherwise prefer an existing `origin/main`, then `origin/master`, then the configured upstream.
- `--include-dirty`: include staged and unstaged changes. Without it, describe dirty files as excluded.
- `--paths=<path-or-glob>`: restrict the review.

Use existing local refs; do not fetch or otherwise update repository state unless the user asks. Compute the merge base and inspect the diff, changed-file statistics, and rename status. Exclude generated, vendored, lock, fixture, and build-output files unless they materially define an architectural boundary.

Perform a full review for up to 15 changed source files or roughly 1,500 changed source lines. Above that, inventory the complete diff but deeply review a risk-ranked slice of at most 12 primary files. Supporting traversal may cross that limit only far enough to prove or disprove a finding. State the reviewed and unreviewed scope; never issue a global `sound` verdict from partial coverage.

## Establish the design context

Before judging a change:

1. Read applicable `AGENTS.md`, `CLAUDE.md`, architecture documents, and package/module manifests.
2. Trace the changed behavior through relevant callers, callees, types, tests, and existing canonical helpers.
3. Distinguish constraints demonstrated by code or documentation from inferred preferences.
4. Treat tests as behavioral evidence, not proof that the design is sound.

Do not run broad lint or test suites by default; correctness-gate orchestration belongs to a general branch review. Prefer static inspection. Run a narrow diagnostic only when necessary to verify a specific claim and known not to mutate the worktree; otherwise ask first or skip it.

## Review workflow

1. Inventory the diff and identify affected boundaries, state, contracts, and consumers.
2. Perform the primary structural and counterfactual review using the lenses below.
3. If a latent-bug risk trigger is present, run one independent failure-path review as described below.
4. Reopen the cited code and try to falsify every candidate against actual constraints and safeguards.
5. Deduplicate by architectural cause or failure scenario and emit only reconciled findings.

If independent delegation is unavailable, perform step 3 sequentially with the same narrow checklist and disclose that the pass was not independent.

## Review lenses

Apply only lenses relevant to the change.

### Structural simplicity

- Can the change remove concepts, branches, modes, or layers rather than redistribute them?
- Did a refactor delete complexity, or only relocate the same branches and mental model?
- Does new conditional logic reveal a missing state model, policy boundary, or dispatcher?
- Can special cases become one simpler default path with fewer exceptions?
- Is the direct implementation clearer than a generic or magical mechanism?
- Does an abstraction reduce reasoning cost, or merely wrap and forward?

For each meaningful changed behavior, restate its invariant and sketch the simplest alternate shape that satisfies it using the existing architecture. Compare concepts, states, branches, and ownership points. Report the alternative only when it is concrete, materially simpler, and supported by the code. `Minimally scoped remedy` means the smallest sufficient direction after considering this counterfactual—not automatically the smallest patch.

### Ownership and cohesion

- Is each rule implemented in the module that canonically owns it?
- Is feature-specific behavior leaking into shared infrastructure or across API boundaries?
- Does the change duplicate an existing helper or create competing sources of truth?
- Has a cohesive module become responsible for unrelated concerns?
- Is orchestration entangled with domain logic in a way that obscures retry, ordering, or partial-failure boundaries?

### Contracts and valid states

- Do types and interfaces express the actual invariant?
- Do optional values, booleans, casts, fallbacks, or loosely shaped data permit invalid combinations?
- Are validation and normalization performed once at the correct boundary?
- Are compatibility and migration semantics explicit where a contract changes?

### Decomposition

- Judge file and component size contextually. Growth is evidence to investigate, not a defect by itself.
- Measure pre/post size. When a changed file crosses a project limit—or 1,000 lines when none exists—perform an explicit decomposition check: identify its responsibilities, a candidate ownership seam, what would move across that seam, and whether the split would reduce conceptual load rather than merely redistribute code.
- If a stable responsibility seam exists and the split would materially improve cohesion or reduce reasoning cost, report it as a high-confidence **Opportunity** even when no defect or structural regression exists. Cite the pre/post size, the concrete seam, and the architectural payoff; length supplies the trigger, not the evidence or impact.
- If no such seam exists, do not emit a finding based on length. Record in the review summary that the threshold was checked and why decomposition was waived.
- Never elevate the finding to **Defect** or **Structural regression** from size alone; those levels require their independent behavioral or ownership evidence.
- Reject extra modules or helpers that increase navigation without reducing conceptual load.

### Atomicity, ordering, and concurrency

- Can related updates leave partially applied or contradictory state?
- Are ownership, transaction, retry, idempotency, and failure boundaries aligned?
- Does correctness depend on undocumented call order or timing?
- Suggest parallelism only after proving independence and preserving ordering, rate-limit, load, transaction, cancellation, and error semantics.

### Architecture-induced latent bugs

Actively search for behavioral defects created or exposed by structure:

- duplicated state or split ownership that can diverge;
- check-then-act races, stale reads, lost updates, or non-atomic multi-step writes;
- invalid state combinations admitted by weak contracts;
- retries or partial failures that duplicate or strand effects;
- cache, persistence, or in-memory representations with inconsistent lifecycle rules;
- abstraction leaks that bypass validation, authorization, normalization, or cleanup;
- ordering assumptions contradicted by asynchronous or event-driven execution;
- fallback paths that silently violate the primary path's invariant.
- temporary modes or dual paths without an owner and removal condition that can drift indefinitely.

Classify something as a latent bug only when you can give a concrete failure scenario grounded in the changed code. Otherwise report it as a design risk or omit it.

### Independent failure-path reviewer

Use exactly one independent subagent only when the diff touches shared or persistent state, async/event ordering, transactions, retries, idempotency, caches, authorization or validation boundaries, serialization or migrations, or public contracts. Skip it for pure renames, isolated presentation changes, and straightforward pure functions.

Give the subagent the exact changed files, relevant base diff, and necessary design context, but not the primary reviewer's hypotheses. Ask only for latent-bug candidates, at most five. Each candidate must contain:

- changed location and supporting call path;
- required preconditions and numbered event or failure sequence;
- violated invariant and externally observable outcome;
- existing safeguard checked;
- confidence.

It must ignore style, general cleanup, and redesign opportunities. Do not publish its output directly. Verify each candidate and actively search for falsifiers such as transactions, locks, unique constraints, serialization guarantees, upstream validation, downstream idempotency, intentional snapshot semantics, and documented degraded behavior.

## Evidence and restraint

For every candidate finding:

1. Cite the changed location and the supporting caller, type, test, or competing implementation.
2. Explain the concrete reasoning cost, failure mode, or boundary violation.
3. Check whether an existing constraint makes the apparent smell intentional.
4. Propose the smallest structural direction that resolves the issue; do not design an entire replacement spec.
5. State behavioral constraints that a refactor must preserve.
6. Confirm that the issue was introduced, exposed, or made materially harder to control by this change; omit unrelated pre-existing defects.

Do not:

- block on taste, file length alone, or speculative elegance;
- demand a new abstraction without showing what complexity it removes;
- expand into unrelated legacy architecture;
- recommend broad rewrites when a local boundary correction suffices;
- treat passing tests as evidence against a concrete architectural failure mode;
- present generic cleanup, naming, formatting, documentation, or test-suite observations unless they directly support an architectural finding.

State demonstrated structural costs plainly, without rhetorical severity unsupported by evidence. Limit discretionary opportunities to the one or two with the clearest immediate payoff. A qualifying threshold-crossing decomposition opportunity is mandatory rather than discretionary and should displace a weaker opportunity; if several qualify, report the two highest-payoff seams and disclose the remaining threshold dispositions in the review summary.

## Severity and output

Use these levels:

- **Defect**: a concrete reachable failure scenario caused by the architecture, fully traced with high confidence.
- **Structural regression**: the change demonstrably adds ownership sources, invalid-state ambiguity, invariant duplication, or consumer coupling.
- **Design risk**: credible but not yet demonstrated failure or maintainability risk.
- **Opportunity**: a non-blocking simplification with a clear payoff. A qualifying threshold-crossing decomposition is a strong Opportunity, never automatically a blocker.

Each finding must use:

```text
[level] file:line — concise title
Evidence: changed code plus relevant supporting locations
Impact: concrete failure mode or architectural cost
Scenario: required for Defect; preconditions -> numbered sequence -> violated invariant -> outcome
Before/after: required for Structural regression; changed design and affected consumers
Direction: minimally scoped structural remedy
Preserve: behavior, ordering, compatibility, or failure semantics that must remain
Confidence: high | medium
```

Omit low-confidence findings. A Defect requires high confidence; an unresolved but materially plausible assumption is at most a Design risk. Rank defects first, then structural regressions, design risks, and opportunities. Prefer a few independently verifiable findings over a comprehensive smell catalog.

End with:

- the reviewed diff/base and whether dirty changes were included;
- any material scope not reviewed;
- each crossed file-size threshold and its disposition: reported decomposition opportunity or evidence-backed waiver;
- `No architectural findings` when nothing meets the evidence bar;
- a non-binding verdict:
  - `sound`: complete reviewed scope, with no Defects, Structural regressions, or Design risks; Opportunities may remain;
  - `sound with concerns`: no Defects, but substantiated regressions or risks remain;
  - `changes recommended`: at least one verified Defect or high-confidence regression affects a core invariant;
  - `partial review — disposition limited to reviewed scope`: any material scope was not reviewed.
