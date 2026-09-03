---
name: arch-review
description: Review a branch or code change for architecture-induced latent bugs, with an optional broad mode for architectural regressions and structural simplification opportunities. Use for targeted architecture bug hunting, an overall architecture review, or a deliberately strict maintainability audit; do not use for ordinary cleanup, test-only review, or documentation review.
---

# Architecture Review

Perform a read-only, evidence-backed review of the architecture affected by a change. Default to narrow latent-bug discovery; make broader structural review explicit. Look beyond local style without turning the review into an unconstrained redesign.

Do not edit files during the review. Report findings and wait for a separate implementation request.

## Provenance

Adapted from Cursor's [Thermo-Nuclear Code Quality Review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md), Copyright (c) 2026 Cursor, under the [MIT License](https://github.com/cursor/plugins/blob/main/cursor-team-kit/LICENSE). This Codex adaptation paraphrases its structural-simplification rubric and adds read-only scope, evidence and severity requirements, independent latent-bug analysis, and concurrency safeguards. See [LICENSE.cursor-team-kit](LICENSE.cursor-team-kit).

## Modes

Accept `--mode=bug|broad`; default to `bug`.

- `bug`: search only for architecture-induced **Defects** and tightly evidenced **Design risks**. Use ownership, contracts, state, atomicity, ordering, and boundary analysis only to identify, explain, or falsify a concrete failure path. Do not emit standalone **Structural regressions**, **Opportunities**, counterfactual redesigns, or file-size findings. Consider a structural remedy only when needed to explain the failure or show why a local correction cannot restore the invariant.
- `broad`: within the same primary discovery pass, run the identical latent-bug analysis and then apply all relevant structural lenses. This mode may also emit **Structural regressions** and at most two evidence-backed **Opportunities**, use conditional counterfactual analysis, and perform the contextual file-size assessment.

Mode changes concern and lens breadth, never repository or file scope. Do not promote `bug` to `broad` because traversal reveals an interesting structural issue. Changing modes requires explicit user authorization and a newly stated, frozen scope and budget.

## Scope

Review the current branch against a base ref. Accept these optional arguments:

- `--base=<ref>`: comparison base; otherwise prefer an existing `origin/main`, then `origin/master`, then the configured upstream.
- `--include-dirty`: include staged and unstaged changes. Without it, describe dirty files as excluded.
- `--paths=<path-or-glob>`: restrict the review.

Use existing local refs; do not fetch or otherwise update repository state unless the user asks. Compute the merge base and inspect the diff, changed-file statistics, and rename status. Exclude generated, vendored, lock, fixture, and build-output files unless they materially define an architectural boundary.

Perform a full review for up to 15 changed source files or roughly 1,500 changed source lines. Above that, inventory the complete diff but deeply review a risk-ranked slice of at most 12 primary files. Supporting traversal may cross that limit only as needed to understand or test an invariant altered by the reviewed change. It may generate, prove, or falsify a candidate, but every finding must remain anchored to the reviewed change and unrelated defects must be omitted. State the reviewed and unreviewed scope; never issue a global `sound` verdict from partial coverage.

After inventory, state and freeze the mode, base, dirty-state inclusion, path filters, primary files, applicable lenses, and review budget. Supporting traversal does not add unchanged code to the discovery scope. Do not expand the mode, base, files, or lenses because traversal reveals unrelated issues. Expansion requires the user to explicitly name or clearly authorize a different mode or broader files, base, or concerns, followed by a newly stated scope and budget.

## Establish the design context

Before judging a change:

1. Read applicable `AGENTS.md`, `CLAUDE.md`, architecture documents, and package/module manifests.
2. Trace the changed behavior through relevant callers, callees, types, tests, and existing canonical helpers.
3. Distinguish constraints demonstrated by code or documentation from inferred preferences.
4. Treat tests as behavioral evidence, not proof that the design is sound.

Do not run broad lint or test suites by default; correctness-gate orchestration belongs to a general branch review. Prefer static inspection. Run a narrow diagnostic only when necessary to verify a specific claim and known not to mutate the worktree; otherwise ask first or skip it.

## Review workflow

1. Inventory the diff and identify affected boundaries, state, contracts, and consumers.
2. Perform exactly one primary discovery pass using the selected mode and its applicable lenses below. In `broad` mode, complete the same bug analysis as `bug` mode before considering structural findings.
3. If a material latent-bug risk trigger is present, run at most one independent failure-path review as described below.
4. Reopen the cited code and try to falsify every candidate against actual constraints and safeguards.
5. Deduplicate by architectural cause or failure scenario and emit only reconciled findings.

If independent delegation is unavailable, perform step 3 sequentially with the same narrow checklist and disclose that the pass was not independent.

Do not restart discovery, recursively delegate, or expand the run when verification uncovers a new unrelated issue. Treat a generic request to `re-review` as narrow verification of previously reported findings and user-approved changes in the existing mode and frozen scope; it does not repeat discovery or change modes. Expand only when the user explicitly names or clearly authorizes a different mode or broader files, base, or concerns, then state and freeze the new scope and budget.

## Review lenses

Apply only lenses relevant to the change.

In `bug` mode, center the **Architecture-induced latent bugs** lens and use **Ownership and cohesion**, **Contracts and valid states**, and **Atomicity, ordering, and concurrency** only to trace or falsify a failure path. Skip standalone structural-simplicity and decomposition analysis. In `broad` mode, apply every lens relevant to the changed architecture.

### Structural simplicity

Broad mode only.

- Can the change remove concepts, branches, modes, or layers rather than redistribute them?
- Did a refactor delete complexity, or only relocate the same branches and mental model?
- Does new conditional logic reveal a missing state model, policy boundary, or dispatcher?
- Can special cases become one simpler default path with fewer exceptions?
- Is the direct implementation clearer than a generic or magical mechanism?
- Does an abstraction reduce reasoning cost, or merely wrap and forward?

When changed code shows a concrete structural cost or invariant risk, restate the affected invariant and test one counterfactual using the existing architecture. Do not require an alternate design for an otherwise cohesive, direct change. Compare concepts, states, branches, and ownership points, and report an alternative only when it removes demonstrated complexity without introducing comparable indirection, coupling, or migration cost.

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

Broad mode only. The mandatory threshold assessment below does not apply in `bug` mode; there, file structure matters only when it participates in a concrete failure path.

- Judge file and component size contextually. Growth is evidence to investigate, not a defect by itself.
- Measure pre/post size. When a changed file crosses a project limit—or 1,000 lines when none exists—perform an explicit decomposition check: identify its responsibilities, a candidate ownership seam, what would move across that seam, and whether the split would reduce conceptual load rather than merely redistribute code.
- A qualifying seam must separate an independently owned responsibility with distinct invariants or consumers and reduce cross-seam coupling. Visual sections, file length, or the mere ability to extract code do not qualify.
- If such a stable responsibility seam exists, the split would materially improve cohesion or reduce reasoning cost, and the reviewed change introduces, exposes, or materially worsens it, report it as a high-confidence **Opportunity** even when no defect or structural regression exists. Cite the pre/post size, the concrete seam, the change's effect on it, and the architectural payoff; length supplies the trigger, not the evidence or impact.
- Otherwise, do not emit a finding based on length. Record a brief evidence-backed waiver in the review summary, including when a qualifying seam is merely pre-existing and unaffected by the reviewed change.
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

Classify something as a latent bug only when you can give a concrete failure scenario grounded in the changed code. A **Design risk** still requires an observed architectural condition, a plausible failure sequence, and one specifically identified unresolved premise; omit generic smells and imagined future misuse.

### Independent failure-path reviewer

In either mode, use exactly one independent subagent only when the changed path creates or materially alters a cross-call, cross-state, failure, or ordering invariant involving shared or persistent state, async events, transactions, retries, idempotency, caches, authorization or validation boundaries, serialization, migrations, or public contracts. Touching one of those categories alone is not a trigger. Skip delegation for pure renames, isolated presentation changes, straightforward pure functions, and local contract additions whose validation and effects are contained. The subagent remains bug-only in both modes; do not add a creative or structural-review subagent in `broad` mode.

Give the subagent the exact changed files, relevant base diff, and necessary design context, but not the primary reviewer's hypotheses. It may inspect unchanged supporting callers, callees, and safeguards only as needed to understand or test an invariant altered by the reviewed change. That traversal may generate or falsify a candidate, but every candidate must remain anchored to the changed path and unrelated defects must be omitted. Tell it not to delegate or expand scope. Ask only for latent-bug candidates, at most five. Each candidate must contain:

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
4. Default to the smallest local correction that resolves the issue. Recommend a broader structural change only when evidence shows a local fix cannot restore the invariant or canonical ownership; explain why, without designing an entire replacement spec.
5. State behavioral constraints that a refactor must preserve.
6. Confirm that the issue was introduced, exposed, or made materially harder to control by this change; omit unrelated pre-existing defects.

Do not:

- block on taste, file length alone, or speculative elegance;
- demand a new abstraction without showing what complexity it removes;
- expand into unrelated legacy architecture;
- recommend broad rewrites when a local boundary correction suffices;
- treat passing tests as evidence against a concrete architectural failure mode;
- present generic cleanup, naming, formatting, documentation, or test-suite observations unless they directly support an architectural finding.

In `broad` mode, state demonstrated structural costs plainly, without rhetorical severity unsupported by evidence. Limit discretionary opportunities to the two with the clearest immediate payoff. A threshold-crossing decomposition Opportunity that also meets the changed-code causality requirement is required and should displace a weaker opportunity; disclose every other threshold disposition as an evidence-backed waiver in the review summary.

## Severity and output

Use these levels:

- **Defect**: a concrete reachable failure scenario caused by the architecture, fully traced with high confidence.
- **Structural regression**: the change demonstrably adds ownership sources, invalid-state ambiguity, invariant duplication, or consumer coupling.
- **Design risk**: an observed architectural condition with a plausible failure sequence and one explicit unresolved premise.
- **Opportunity**: a non-blocking simplification with a clear payoff. A qualifying threshold-crossing decomposition is a strong Opportunity, never automatically a blocker.

In `bug` mode, report only **Defect** and **Design risk**. A structural condition tied to a failure path must meet one of those evidence bars; otherwise omit it. In `broad` mode, all four levels are available.

Each finding must use:

```text
[level] file:line — concise title
Evidence: changed code plus relevant supporting locations
Impact: concrete failure mode or architectural cost
Scenario: required for Defect and Design risk; preconditions -> numbered sequence -> violated invariant -> outcome; for Design risk, identify the single unresolved premise
Before/after: required for Structural regression; changed design and affected consumers
Direction: minimally scoped structural remedy
Preserve: behavior, ordering, compatibility, or failure semantics that must remain
Confidence: high | medium
```

Omit low-confidence findings. A Defect requires high confidence; an unresolved but materially plausible assumption is at most a Design risk. Rank defects first, then structural regressions, design risks, and opportunities. Prefer a few independently verifiable findings over a comprehensive smell catalog.

End with the selected mode, then:

- the reviewed diff/base and whether dirty changes were included;
- any material scope not reviewed;
- in `broad` mode, each crossed file-size threshold and its disposition: reported decomposition opportunity or evidence-backed waiver.

Use a mode-specific, non-binding conclusion:

- `bug`:
  - `No architecture-induced bug findings`: complete reviewed scope with no Defects or Design risks;
  - `Architecture-induced bug risks found`: no Defects, but at least one Design risk remains;
  - `Changes recommended`: at least one verified Defect affects an invariant;
  - `Partial bug review — disposition limited to reviewed scope`: any material scope was not reviewed.
- `broad`:
  - `sound`: complete reviewed scope, with no Defects, Structural regressions, or Design risks; Opportunities may remain;
  - `sound with concerns`: no Defects, but substantiated regressions or risks remain;
  - `changes recommended`: at least one verified Defect or high-confidence regression affects a core invariant;
  - `partial review — disposition limited to reviewed scope`: any material scope was not reviewed.
