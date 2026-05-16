# Plan Review

For `project` and `program` plans, review the plan artifact independently
before presenting. Full reviews use the 3-pass review-fix-verify loop.
Diff reviews are scoped and use the narrower diff flow below.

## Review-Fix-Verify Loop

Full reviews use this loop structure:

1. **Review**: spawn review agent(s) to critique the plan. Review artifacts
   must be written from the spawned agents' outputs, not locally authored by
   the planner.
2. **Fix**: planner fixes material findings.
3. **Verify**: spawn a fresh agent to confirm fixes landed and introduced
   no regressions in touched cards. Verify artifacts must be written from the
   spawned agent's output, not locally authored by the planner. Fresh agent =
   never the same agent that found the findings.
4. If verify is clean, exit loop. If still broken, back to Fix (max 2 fix
   attempts per pass). After fix sub-cap, finding becomes residual risk.
5. Cap: 3 passes per loop instance. Cap resets on each new draft (after
   rejection or fresh research round). After pass cap, record unfixed
   findings as residual risk in the plan artifact.

### Full Review Verify Scope

Verify re-checks only the specific findings from the review pass, plus a
targeted scan of seed cards and edges the fix touched. Verify does NOT
re-run the full lens set. If verify finds something genuinely new (not a
regression from the fix), it flags it — the finding counts toward the same
pass cap, not a new cycle.

## Review Modes

### Full Review

Used for: initial draft review, pre-creation gate.

| plan size | review agents | lenses |
| --- | ---: | --- |
| `single-fix` | 0 | — |
| `slice` | 0-1 | skill compliance if edge count > 4 |
| `project` | 2 | skill compliance, source reality; include chunking strategy and implementation boundary sketch when implementation, subsystem, or feature work is broad |
| `program` | 3 | skill compliance, source reality, risk/scope; include chunking strategy and implementation boundary sketch when implementation, subsystem, or feature work is broad |

### Diff Review

Used for: user adjustments during revision loop.

| condition | agents | scope |
| --- | ---: | --- |
| narrow change (1-2 seed cards changed, no edge topology change) | 1 | diff lens |
| broad change or uncertain | escalate to full review | all lenses |

**Narrow vs broad threshold**: "narrow" means the set of `blocked_by`
references across all seeds changed by at most 1 addition or removal, and
no seed's transitive dependency set changed topology. Anything beyond that
is "broad." When uncertain, default to full review.

**Escalation rule**: diff review that finds 3+ material findings or damage
outside the touched seed set must escalate to full review. The adjustment
that triggered the diff review already counted toward the adjustment cap;
escalation does not consume an additional adjustment.

Diff review is not a 3-pass full review loop. It is one scoped diff review
with at most two fix attempts and targeted verify. If still dirty after the
fix cap, present the revision with residual risk or escalate to full review
when the issue is broad/material. Diff review does not clear the dirty bit;
only a full review-fix-verify loop can clear it.

## Review Lenses

- **skill compliance**: sizing, edges, verification ownership, quality bar,
  decomposition rules, label usage, slug handling, seed-scoping readiness
  (grab-bag detection, acceptance testability, gate command exactness,
  scope-breadth check)
- **source reality**: module boundaries, LOC accuracy, missing spec concerns,
  implementation boundary sketch fit, edge accuracy (owns whether each edge
  reflects real code dependency), dependency realism
- **risk/scope**: blind spots, deferred items, milestone coverage, hardening
  distribution
- **chunking strategy**: whether the plan states and applies a chunking
  strategy from `chunking-strategies.md`; rejects pure file/module DAGs for new
  behavior, default discovery seeds after planning research resolved sources,
  huge MVP seeds without immediate hardening, missing early smoke after the
  first mutating happy path, and conformance batches used as the first behavior
  proof instead of verifier gates
- **implementation boundary sketch**: whether broad implementation/subsystem
  plans name stable responsibility boundaries (CLI, domain/model, storage,
  graph/lifecycle, command handlers, tests, docs as applicable), whether seed
  cards align to those boundaries, and whether the sketch avoids forcing a
  pure file/module DAG.
- **promotion safety**: whether draft/spec behavior is separated from version
  bump, release, implementation parity, and hardening gates. Assigned to
  the risk/scope agent when the plan contains promotion or release seeds.
- **diff lens** (diff review only): compare old plan to revised plan, verify
  edge conservation, acceptance conservation, no orphaned/dangling seeds,
  no duplicated criteria, LOC estimate consistency (including absolute
  sizing-band check), verification ownership shifts, target_gates drift,
  label consistency, dispatch_notes/source_refs staleness

Edge-checking ownership: skill compliance owns structural edge rules
(no transitive redundancy, valid references). Source reality owns whether
each edge reflects real code dependency.

## Pre-Creation Gate

Runs as the final gate before CLI creates seeds. Two phases:

### Phase 1: Scripted Mechanical Checks (deterministic)

Always run before CLI creation, even when dirty-bit logic skips Phase 2 agent
review. These checks are automated, not agent-reviewed:

- every `temp_id` is unique
- every `blocked_by` reference points to an existing `temp_id`
- creation order respects `blocked_by` (parents before dependents)
- every seed card uses `priority: 1`; priority is not used to encode DAG order
- shared network label present in every seed's labels array
- no empty acceptance or placeholder gate commands
- required seed-card fields are present
- no cycles or transitively redundant direct edges

Command:

```bash
bun skills/seedstack/scripts/check-plan.ts tmp/seedstack/<slug>/plan.md --shared-label <label>
```

If scripted checks fail, fix before proceeding to phase 2.

### Phase 2: Full Review-Fix-Verify Loop

Standard full review with all lenses, plus agent-reviewed check:

- no grab-bag seeds (acceptance is independently testable per seed)
- chunking strategy is stated, justified, and followed for broad
  implementation, subsystem, or feature plans
- implementation boundary sketch is present for broad implementation or
  subsystem plans and is used as orientation, not a file-first DAG
- early mini end-to-end smoke is present or explicitly waived for broad
  command/CLI implementation plans
- graph-changing discovery seeds are absent unless planning research left a
  documented unresolved unknown

### Dirty-Bit Skip

Skip Phase 2 agent review if the plan is unchanged since the last full review
that exited clean. Never skip Phase 1 scripted mechanical checks before CLI
creation. "Unchanged" means no semantic diff to the plan artifact. Fixes
during a review loop that exits clean do not set the dirty bit.

The dirty bit sets on: user adjustments, planner revisions after user
feedback. It clears on: full review-fix-verify loop exits clean.

### Pre-Creation User Gate

After pre-creation review, re-present to user:

- **Accept**: proceed to create seeds.
- **Reject**: route back to User reacts (where adjust/reject are available).
- No adjust option at pre-creation gate — prevents unbounded loop.
- Assumption check does not rerun at pre-creation.

## Rules

- Spawn review agents in parallel. Do not share findings between reviewers.
- Review agents are read-only. They read the plan artifact, skill spec, and
  source files. They do not edit the plan.
- Verify agents are read-only, fresh, and targeted (not full lens re-run).
- Planner-authored review or verify artifacts are invalid. If subagent use is
  unavailable, stop and report that the required review/verify gate cannot be
  satisfied; do not create placeholder artifacts.
- Each review/verify artifact must include or preserve subagent provenance
  (agent role/lens is enough) and the subagent's actual findings. Minimal
  formatting wrappers are allowed; substantive rewrites are not.
- Review artifacts written to `tmp/seedstack/<slug>/review-r<round>-a<agent>.md`.
- Diff review artifacts written to `tmp/seedstack/<slug>/review-diff-r<round>.md`.
- Verify artifacts written to `tmp/seedstack/<slug>/verify-r<round>.md`.
- Pre-creation review artifacts written to `tmp/seedstack/<slug>/review-precreation-a<agent>.md`.
- Verify review artifacts exist and are nonempty before proceeding.
- Fix material findings before presenting. Report unfixed findings as
  residual risk in the plan artifact.

## Presentation Contract

Do not present a `project` or `program` plan without review artifacts.

```xml
<present_requires alignment="answered_or_assumed"
  reviews="passed_or_findings_fixed" verify="clean_or_residual_risk_recorded"
  quality_bar="checked" sizing="estimated"
  edges="no_transitive_redundancy" shared_label="applied"
  assumptions_visible="true" />
```

For protocol/version plans, presentation must state whether the plan is
draft-only, hardening, promotion, or release. Reviewers should block plans that
let a behavior seed silently bump the global spec line or rely on dispatch to
create follow-up seeds.

## Draft-Reaction Flow

For `project` and `program`, first presentation is a draft:

1. Present draft with assumption callouts from research.
2. User reacts: accepts, adjusts assumptions, or rejects direction.
3. If accepted with no changes since last full review: plan is final; run
   pre-creation mechanical checks, then create seed records only (if
   explicitly requested). Otherwise stop.
4. If accepted with changes since last full review: run pre-creation
   gate, then create seed records only (if explicitly requested). Otherwise
   stop.
5. If adjusted: revise plan, run scoped diff review with targeted verify
   (escalate to full if broad), present revision.
   Max 1 adjustment round for `project`, 2 for `program`.
6. If rejected: new research round before revision (not a patch on the
   existing draft). Returns to draft plan step.

For `single-fix` and `slice`, present final directly — no draft gate needed.

Assumptions that the user does not challenge become accepted alignment.

Plan acceptance is not implementation authorization. Do not edit target code,
invoke `dispatch-work` or run the stack loop from plan mode unless
the user explicitly requests that follow-on action.
