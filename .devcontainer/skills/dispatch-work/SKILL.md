---
name: dispatch-work
description: Use to execute one bounded work item from either an inline prompt/work order or a prepared queue context, with research, implementation, review, verification, artifacts, and a done/retry/escalate decision. Do not use for multi-work planning or queue graph mutation; use seedstack.
---

# Dispatch Work

## Boundary

`dispatch-work` owns one unit of execution. It does not own queue planning,
queue selection, dependency edges, labels, priority, claim, close, or follow-up
creation. Queue/seed mechanics belong to `seedstack`.

Allowed inputs:

- inline prompt/work order from the user
- prepared work packet from `seedstack`
- queue id only when `seedstack` or repo docs already resolved and claimed it

If the user asks for `--next`, adoption, decomposition, dependency changes,
follow-up creation, or queue close, use `seedstack` first. `dispatch-work`
must not call `sd claim`, `sd close`, or mutate `.seeds/**`.

## Inputs

- repo path
- work text or work packet path
- stable work id or slug for artifacts
- optional queue id as context only
- acceptance criteria and expected gates, if provided

For inline prompt mode, derive a safe slug from the request and write artifacts
under `tmp/dispatch-work/<slug>/`. For queue-backed mode, use the id/slug
provided by `seedstack`.

## Quick Path

1. Read repo instructions, especially `AGENTS.md`.
2. Create or reuse `tmp/dispatch-work/<work-id>/`.
3. Normalize input into `work-order.md` with `contract: work-order.v1`.
   In prompt mode, ask the user for missing critical fields before Research
   when omission would risk wrong scope, acceptance, or verification.
4. Spawn a knowledge scout if `.seeds/knowledge.jsonl` exists; write
   `knowledge-scout.md`.
5. Spawn Research agents as needed. They write `research-<i>.md`.
6. Write `source-hints.json` and `packet.md` from work order, research,
   acceptance criteria, gates, likely files, risks, and refined scope budget.
7. Write `tool-preflight.md` with cwd, launcher availability, and gate tools.
8. Spawn one Execute agent for round 1. Execute owns the inner
   Implement -> Review loop.
9. Spawn independent Verify agents after Execute reports.
10. Validate artifacts:
   `bun skills/dispatch-work/scripts/validate-dispatch-work.ts --work-order <work-id>`.
11. Gate as Dispatcher. Decision is exactly one of:
   `done`, `retry`, or `escalate`.
12. Capture knowledge via `capture-knowledge` if anything non-obvious passes
   its recording gate.

Load references only when needed:

- Work-order normalization: `references/work-order.md`
- Packet building: `references/dispatch-packet.md`
- Spawn prompts: `references/prompt-contracts.md`
- Agent counts, retry, timeout, Execute/Verify details:
  `references/orchestration.md`
- Waiver and gate detail: `references/waivers-and-gating.md`
- Artifact/report validation: `references/report-schemas.md`
- Quint model and run commands: `references/model-artifacts.md`

## Mode Semantics

### Prompt Mode

Input is direct user work text. No queue mutation exists. Gate means:

- `done`: work is complete against local acceptance criteria
- `retry`: another Execute round is needed
- `escalate`: blocked, unsafe, ambiguous, or needs user/queue manager decision

Before Research, normalize direct prompts into `work-order.v1`. If `area`,
acceptance, gates, non-goals, or scope budget are missing and cannot be safely
inferred from repo instructions, ask the user for those details. For
spec/protocol-visible work, also require source refs or an explicit instruction
to discover them, and promotion boundary
(`none|draft|hardening|promotion|release`).

### Queue Context Mode

Input came from `seedstack` or another queue manager. Queue context may include
id, title, description, labels, deps, assignee, and close criteria. Treat that
as read-only evidence. Final gate still emits `done|retry|escalate`; the queue
manager decides whether to close, retry, split, or create follow-ups.
Seedstack seed cards map to `work-order.v1`; missing execution-critical fields
in the seed description remain missing and must be resolved before Execute.

## Agent Types

| role | spawned by | owns | may edit code |
| --- | --- | --- | --- |
| Dispatcher | current agent | preflight, Research, packet, Execute rounds, Verify, final gate | no |
| Research | Dispatcher | context, sources, source-hint candidates, likely files, criteria, gates, risks | no |
| Execute | Dispatcher | one outer round; inner Implement -> Review loop | no direct edits |
| Implement | Execute | code/docs/test changes and gates | yes |
| Review | Execute | independent review of current round | no |
| Verify | Dispatcher | independent check of Execute report and artifacts | no |

Research, Review, and Verify are repo-read-only except writing assigned audit
reports under `tmp/dispatch-work/<work-id>/`.
No role mutates queue state; queue context is read-only.

## Safety

- Do not hand-edit `.seeds/**`, except `capture-knowledge` may append
  `.seeds/knowledge.jsonl` through its tool when its recording gate passes.
- Do not call queue mutation commands such as `sd claim`, `sd close`,
  dependency edits, label edits, or follow-up creation.
- Preserve unrelated dirty worktree changes.
- Suggested follow-ups are nonterminal data in `gate.md` and final report;
  `seedstack` decides whether to create them.
- Spec/protocol version bumps require explicit current-turn user permission
  unless the work text itself owns that promotion.
- Nested child launch is required. A valid launcher is native `spawn_agent`,
  native Claude `Agent`, or a supervised CLI fallback recorded in
  `tool-preflight.md`.
- Every spawned prompt must say: use repo-native commands and obey active
  repo/parent command wrappers; do not assume unavailable aliases/wrappers.
- Before Execute, Verify, or gate commands, normalize gate PATH with
  `export PATH="$HOME/bin:$HOME/.bun/bin:$PATH"` and preflight needed tools.
- Before writing artifacts, every agent must confirm cwd is repo root and
  `tmp/dispatch-work/<work-id>` exists or can be created there.

## Context Invariants

- One explicit work item per active dispatch session unless user explicitly
  requests batch mode.
- Parent agents must not stream or poll child stdout/stderr into parent
  context. Parent liveness checks are status-only.
- Every spawned round child run (Execute, Implement, Review, or Verify) must
  have repo-root-relative prompt, log, status, launch evidence, and report paths
  under `tmp/dispatch-work/<work-id>/...`.
  Canonical child paths are computed only by
  `scripts/dispatch-work-paths.ts`; do not hand-derive names or directories.
- Before launching any round child, Dispatcher/Execute must paste the full
  5-path
  `path_manifest` returned by `childRunPaths` into the child prompt:
  `prompt`, `log`, `status`, `launch_evidence`, and `report`.
- Child artifact paths must live directly in the dispatch root or the correct
  `round-<n>/` directory. Do not create child artifact subdirectories named
  `prompts/`, `children/`, `logs/`, or `launch-evidence/`.
- Child prompt and launch evidence names use prefix-hyphen form only:
  `<prefix>-prompt.md` and `<prefix>-launch-evidence.json`. Dotted forms such
  as `execute.prompt.md` or `execute.launch-evidence.json` are invalid.
- Child reports are summary-first: `status`, `changed_files`, `tests`,
  `blockers`, and `next_action` near top.
- Missing, stale, malformed, or empty report; nonzero exit; signal; timeout; or
  unknown terminal status requires a bounded `failure-capsule.md`.

## Transition Sketch

```text
Research
  -> Packet
  -> Execute round n
      -> Implement
      -> Review
      -> Execute report
  -> Verify
  -> Gate
      -> Done
      -> Execute round n+1
      -> Escalate
      -> Suggested follow-ups for seedstack/queue manager
```

## Dispatch Invariants

- Dispatcher must not mark `done` on Execute pass alone.
- Dispatcher must write, validate, and snapshot `gate.md` before final report.
- Dispatcher must not use follow-up creation to justify `done`.
- `done` requires the Gate Decisions checklist in
  `references/waivers-and-gating.md`.
- Waivers that affect `done` must be recorded in `gate.md`; skipped gates must
  be user-waived.
- Dispatcher must not write `packet.md` unless Research coverage exists:
  governing sources, likely files, acceptance criteria, gates, and risks.
- Dispatcher must not write `packet.md` until `work-order.md` exists and all
  critical `work-order.v1` fields are filled, user-waived, or marked `unknown`
  with a bounded assumption that Research must resolve before Execute.
- Dispatcher must not start Execute until packet carries a refined scope
  budget. Split or escalate when estimated work exceeds 800 changed LOC, eight
  files, or multiple unrelated subsystems; stop above 1200 changed LOC unless
  the user explicitly accepts large-scope risk.
- Terminal outcomes are exclusive: `done` or `escalate`, never both.
- Nested subagent failure stops by escalation, never done.
- Report enum values are closed: Implement status `done|failed`;
  Execute/Review/Verify status `pass|block|risk`; Execute `next_action` and
  gate decision `done|retry|escalate`.

## Artifact Tree

Canonical paths are computed only by `scripts/dispatch-work-paths.ts`. Agents
receive exact paths via prompt contracts and write to those paths. Do not invent
file names, child artifact subdirectories, or dotted prompt/evidence names.

```xml
<artifacts root="tmp/dispatch-work/<work-id>">
  <tool_preflight path="tool-preflight.md" />
  <work_order path="work-order.md" contract="work-order.v1" />
  <knowledge_scout path="knowledge-scout.md" prefix="knowledge-scout" />
  <packet path="packet.md" />
  <source_hints path="source-hints.json" />
  <research path="research-<i>.md" prefix="research-<i>" />
  <round n="">
    <execute prefix="execute"
      prompt="execute-prompt.md"
      log="execute.log"
      status="execute.status"
      launch_evidence="execute-launch-evidence.json"
      report="executor-report.md" />
    <implement prefix="implement-a<m>"
      prompt="implement-a<m>-prompt.md"
      log="implement-a<m>.log"
      status="implement-a<m>.status"
      launch_evidence="implement-a<m>-launch-evidence.json"
      report="implement-a<m>-report.md" />
    <review prefix="review-r<i>-a<m>"
      prompt="review-r<i>-a<m>-prompt.md"
      log="review-r<i>-a<m>.log"
      status="review-r<i>-a<m>.status"
      launch_evidence="review-r<i>-a<m>-launch-evidence.json"
      report="review-r<i>-a<m>.md" />
    <verify prefix="verify-<i>"
      prompt="verify-<i>-prompt.md"
      log="verify-<i>.log"
      status="verify-<i>.status"
      launch_evidence="verify-<i>-launch-evidence.json"
      report="verify-<i>.md" />
  </round>
  <knowledge_capture path="knowledge-capture.md" />
  <events root="events/" done="events/<seq>-done.json" escalate="events/<seq>-escalate.json" />
  <gate path="gate.md" />
  <dispatcher path="dispatcher-report.md" />
</artifacts>
```

## Workflow

| phase | owner | required output | fail path |
| --- | --- | --- | --- |
| Preflight | Dispatcher | repo, work input, branch, dirty status, launcher | stop/report |
| Work Order | Dispatcher | `work-order.md` with critical fields resolved or bounded | ask user/escalate |
| Research | Research | `research-*.md` with enough coverage | retry/user waiver |
| Packet | Dispatcher | `packet.md` | stop until complete |
| Execute | Execute | `round-<n>/executor-report.md` | retry/escalate |
| Verify | Verify | `round-<n>/verify-*.md` | retry/user waiver |
| Gate | Dispatcher | `gate.md` | done, next Execute, or escalate |

Default budget: 3 Execute rounds, 3 Implement attempts per Execute round, 1
infrastructure-only respawn per failed agent. Details: `references/orchestration.md`.

## Stuck Index

- nested unavailable -> Safety
- incomplete packet -> `references/dispatch-packet.md`
- Verify block -> Dispatch Invariants, `references/waivers-and-gating.md`
- timeout -> `references/orchestration.md`
- context/large output -> Context Invariants,
  `references/orchestration.md`, `references/report-schemas.md`
- waiver request -> `references/waivers-and-gating.md`
- artifact/report validation -> `references/report-schemas.md`

## Quint Model Artifacts

- Inventory and run commands: `references/model-artifacts.md`
- The Quint model is advisory; Dispatch Invariants above are normative.
