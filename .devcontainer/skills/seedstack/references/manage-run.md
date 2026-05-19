# Manage And Run

## Manage Flow

```text
Read current stack state
  -> Read latest dispatch gate/report for seed
  -> Run dispatch reconciliation preflight
  -> Classify result:
      closed_clean | closed_with_followups | retryable_escalation |
      boundary_deferred | blocked_user | graph_drift | all_closed
  -> Decide graph mutation:
      none | add_followups | adjust_deps | reprioritize | block/escalate
  -> Write decision artifact
  -> Re-read CLI state (`list`, `ready`, `blocked`, plus health if supported)
  -> Apply allowed mutation if state still matches decision snapshot
  -> Write result, manage log row, latest summary
  -> Return continue / retry / block_user / done
```

`run-state.json` is canonical. Refresh `run.md` from it with
`skills/seedstack/scripts/update-run-state.ts`, which writes both files
atomically from one state object. On legacy resume, read `run.md`, then create
`run-state.json` before the next dispatch.

Manager may create at most two follow-up seeds per iteration unless the user
raises the cap. Prefer one seed when follow-up scope is coherent. Follow-ups do
not make incomplete current work closeable.

All split operations are structural mutations and require explicit user
approval. Dispatch may propose a split, but manage applies it only after user
choice.

## Operator Packets

Operator packets are advisory run artifacts for bounded subagent diagnostics.
Persist them under the current run artifact directory, not under `.seeds/**`:

```text
operator/
  operator_run.json
  preflight.packet.json
  artifacts.packet.json
  verifier.packet.json
  recovery.packet.json
  knowledge.packet.json
  operator_summary.json
```

Operator scopes:

- `preflight`: environment, backend, manifest, credentials, and config validity.
- `artifacts`: required artifacts, schema validity, redaction, and trajectory.
- `verifier`: verifier failure classification and false-positive suspicion.
- `recovery`: next safe action proposal; no execution.
- `knowledge`: reusable lessons with evidence refs.

Every packet uses `packet_version: "operator.v1"`, the matching `operator`
value, `run_id`, optional `task_id`, `seed`, `trial_id`, optional
`queue_snapshot_id`, `readonly: true`, `status: ok|warn|fail|blocked`,
`findings[]`, and `recommendations[]`. Recommendations must set
`queue_mutation_allowed: false` unless `owner` is `main_agent`; even then, the
packet is only evidence for a later main-agent/Seedstack decision.

Validate packet sets with:

```bash
bun skills/seedstack/scripts/check-operator-packets.ts --operator-dir tmp/seedstack/<slug>/operator --pretty
```

Invalid packets are discarded and reported by the checker. Conflicting
recommendations for the same target block automatic queue mutation. Operator
subagents never mutate queue files, run the queue CLI, or execute recovery
actions. The main agent receives only `operator/operator_summary.json` as
compact context and keeps queue mutation Seedstack-owned.

## Manage Queue Proposals

Manage children are proposal-only. They may classify a dispatch result and
recommend queue operations, but they must not run Seeds CLI mutation commands
such as `sd close`, `sd create`, dependency edits, label edits, or priority
edits, and they must not write `.seeds/**` directly.

Structured proposals may express `close-current`, `create-follow-up`,
`add-dependency`, `adjust-labels`, or `no-op`. Each proposal records the target
seed, rationale, source artifact refs, expected preconditions, and whether it
is required for safe continuation. A proposal is not a mutation grant.

The supervisor/main process owns all queue mutation. Before applying any
proposal, it performs a fresh scan/reconcile guard in the normalized worktree,
verifies the proposal preconditions still match current queue state, and uses
the configured `seed-cli` path. It records command argv, cwd, before/after seed
ids, resulting dirty queue paths, and applied operation ids in run artifacts.
Unsupported operations, stale preconditions, attempts to close a non-current
seed, or multiple mutating operations that would risk partial application stop
the run before mutation.

## Mutation Eligibility

Allowed through work queue CLI only:

- add follow-up seeds within caps to the adopted stack
- close the just-dispatched seed after dispatch-work reports local done and
  fresh state still matches the decision snapshot
- adjust deps, labels, or priority on adopted open, unassigned, nonterminal seeds
- repair deps on unassigned blocked seeds when graph/ready/blocked output
  shows the dependency is wrong

Forbidden:

- mutate seeds outside `adoption-selection.json` without explicit user
  approval to expand the adopted stack
- mutate active or assigned-to-other seeds
- mutate closed or unknown-status seeds
- close any seed except the just-dispatched local-done seed
- duplicate unresolved acceptance from the just-dispatched seed
- mutate from a stale decision snapshot

Run graph checks before and after dependency repair. Abort with `graph_drift`
on mismatched work order ids, statuses, deps, labels, or priorities.

## Knowledge Lifecycle

`.seeds/knowledge.jsonl` is the append-only knowledge log. Existing records are
never rewritten, sorted, compacted, or deleted during Seedstack/Dispatch runs.
Each capture attempt records exactly one lifecycle state in the relevant
dispatch, manage, or run artifact:

- `recorded`: at least one qualified record was appended to
  `.seeds/knowledge.jsonl`.
- `none_qualified`: the capture step ran, but no candidate passed the
  knowledge recording gate.
- `store_missing`: `.seeds/knowledge.jsonl` or required store setup was absent;
  no store was initialized as a side effect.
- `skipped_user_waived`: user explicitly waived capture for this point.

Capture points:

- after a clean seed close is reconciled by manage mode
- after an escalation is resolved by retry, user decision, split, follow-up, or
  accepted stop disposition
- after run terminal `done`, before final run summary

Ownership boundary:

| actor | may mutate `.seeds/issues.jsonl` and queue files | may mutate `.seeds/knowledge.jsonl` | notes |
| --- | --- | --- | --- |
| Dispatch child | no | no | queue context and knowledge store are read-only; it may write dispatch artifacts only |
| Manage child | through work queue CLI only | no | no direct `.seeds/**` writes |
| Supervisor/current agent | queue CLI, run/manage artifacts, commits | no | records capture state; does not append knowledge directly |
| `capture-knowledge` | no | append only | sole writer for `.seeds/knowledge.jsonl` |

Knowledge capture dirties only `.seeds/knowledge.jsonl`. Any other `.seeds/**`
dirty path from a capture step is unexpected and blocks normal continuation.

Out-of-plan seed creation or dependency reshaping requires a plan-change event
before mutation. Record origin, scope, acceptance, gates, deps, adoption impact,
and approval/review level. Mechanical typo/format edits need only a mechanical
check; structural split/merge, out-of-stack expansion, or broad new behavior
needs explicit user approval and review before creation.

## Boundary-Deferred Gate Assertions

When a dispatch stops on failed gates, manage may classify exact failed
assertions as `gate_boundary_mismatch` and continue without user approval only
when all conditions below hold. This is not a user waiver and must not be
recorded as one.

Eligibility:

- each failed assertion maps to behavior explicitly assigned to a later adopted
  seed by work order id, acceptance text, gate/case name, and finding/code/field
- the current seed packet, acceptance, or non-goals excluded that behavior
  before Execute began
- any in-boundary assertion from the same gate has passing focused evidence or
  documented filtered evidence
- the later owner seed is adopted, open, unassigned, nonterminal, and its
  acceptance or required gates already include the deferred behavior
- fresh CLI list/ready/blocked, health if supported, graph checks, dirty guard, and gate
  inventory drift checks match the decision snapshot
- no safety, security, data-loss, destructive mutation, lock/corruption, or
  uncertain-correctness risk is involved

Allowed action:

- write a manage decision/result artifact with failed assertion ids, exact
  expected/actual deltas, current-boundary quotes, later-owner seed quotes,
  commands proving in-boundary pass, dirty-state summary, residual risk, and
  resume plan
- route the current work item back to `dispatch-work` for a local done/retry/escalate
  decision that records `boundary_deferred` assertions in `gate.md`
- require the later seed's dispatch packet to mark deferred assertions and
  their gates as mandatory before dispatch
- continue auto run only after `dispatch-work` reports local done and seedstack
  completes any queue close/retry decision under the boundary-deferred contract

Forbidden:

- waiving or dropping a whole gate when only some assertions are out of
  boundary
- calling the classification a user waiver
- closing if any failed assertion may indicate incomplete current acceptance
- deferring to a vague, future, closed, assigned-to-other, unadopted, or non-owner seed
- mutating an active or assigned-to-other seed directly from manage mode

## Dispatch Artifact Intake

Before deciding, run the deterministic reconciliation preflight:

```bash
bun skills/seedstack/scripts/check-dispatch-reconcile.ts --seed <work-id> --commit-policy none --seedstack-dir tmp/seedstack/<slug> --pretty
```

Use its `dispatch_reconcile_check.v1` decision before manage reconciliation.
Block on `blocked_*`. Continue to manage only on `manage_reconcile`. For
per-seed commit/continue after manage reconciliation, rerun with
`--commit-policy per_seed` and the expected dirty path inputs; continue or
commit only on `commit_ready`.

The preflight validates dispatch artifacts via `dispatch-work` and, for
per-seed commit policy, classifies dirty state via Seedstack. Pass through
`--round`, `--round-path`, `--gate`, `--expected-seed`, `--preexisting`, and
`--seedstack-dir` as needed.

Dispatch validation is artifact-only. It checks:

- `gate.md` and `dispatcher-report.md` are nonempty under
  `tmp/dispatch-work/<work-id>/`
- seedstack child result JSON, gate files, dispatcher reports, and reconcile
  outputs are supervision/gate artifacts; they are not repo edits and are not
  dispatch child status evidence
- terminal decision is `close` or `escalate`, not both; follow-up proposals
  are nonterminal `follow_up_proposals[]`, never a third terminal state
- verdict values are known
- latest round artifacts referenced by dispatcher report exist
- close evidence includes dirty guard result, gate drift reconciliation,
  waivers, and prompt-contract attestation
- accepted paths are repo-root-relative; misplaced artifacts are ignored or
  rejected

Fresh CLI seed-state and assignee checks are mandatory manage/dispatcher
barriers, but they are not proven by `validate-dispatch-work.ts`.

## Run Flow

```text
Adoption scan existing work queue
  -> if open seeds exist and no explicit stack decision:
       write adoption summary and ask user how to proceed
  -> initialize stack only after user chooses adopt existing / create new / stop
  -> after creating seeds, commit the `.seeds/**` queue baseline before auto run
  -> while open seeds remain:
       pick one explicit ready work order id from the adopted selection
       write run-state.json with state=dispatching and in-flight work order id
       refresh run.md as the human view
       invoke `dispatch-work` with that explicit work order id
       run dispatch reconciliation preflight
       manage latest dispatch result, including escalations
       if seed closed cleanly and commit policy is per-seed:
         rerun dispatch reconciliation preflight with commit policy per-seed
         manual run: pause after manage reconciliation for git diff review and commit
         auto run: review diff, commit, record hash, and continue
         run commit ledger checker before selecting the next seed
       write run-state.json with state=managing, then state=idle/done/blocked
       refresh run.md as the human view
       stop on done, no-ready-deadlock, user block, escalation, or loop cap
```

Run mode invokes `dispatch-work`; it does not inline dispatch execution,
review, verify, or close logic. Every dispatch terminal result must be
reconciled by manage mode or recorded as unreconciled in `run-state.json`
before stop.
On resume, use canonical state per above; reconcile any active or unreconciled
dispatch before selecting another seed.

## Recovery Runbook

Use this sequence when a Seedstack run stops, resumes after interruption, or
has unclear local state. These commands are read-only until the final
`update-run-state.ts` step.

1. Scan queue:

```bash
bun skills/seedstack/scripts/scan-seedspec-cli.ts \
  --repo . \
  --cli sd \
  --worktree-policy linked-ok \
  --adoption-selection tmp/seedstack/<slug>/adoption-selection.json \
  --pretty
```

`--repo` is normalized to the git worktree root before scans, dirty checks,
child launch, queue mutation, and commit operations. The scanner records the
original repo argument, normalized repo, git dir, git common dir, branch, head,
linked/main worktree status, and active policy. Default policy is `linked-ok`:
linked worktrees are accepted, same-branch duplicate linked worktrees are
blocked, and `--allow-same-branch-worktree` or
`--worktree-policy allow-same-branch` is required to override. Add
`--require-worktree` when an operator intentionally wants the command to fail
outside a linked worktree.

2. Check adoption selection:

```bash
bun skills/seedstack/scripts/check-adoption-selection.ts \
  --adoption-selection tmp/seedstack/<slug>/adoption-selection.json \
  --scan-file tmp/seedstack/<slug>/scan.json \
  --pretty
```

3. Classify dirty state before any dispatch, manage, commit, or state update:

```bash
bun skills/seedstack/scripts/classify-dirty-state.ts \
  --repo . \
  --seed <work-id> \
  --seedstack-dir tmp/seedstack/<slug> \
  --dirty-policy loop \
  --pretty
```

Use `--dirty-policy commit` only for the per-seed commit checkpoint after
manage reconciliation. Unexpected dirty paths block recovery until the user
reviews or resolves them. Do not hide them as preexisting unless they were
captured before the run step that produced the stop.

4. Validate dispatch result when `run-state.json` is `dispatching` or the
latest dispatch has not been reconciled:

```bash
bun skills/seedstack/scripts/check-dispatch-reconcile.ts \
  --seed <work-id> \
  --seedstack-dir tmp/seedstack/<slug> \
  --commit-policy none \
  --pretty
```

Continue only on `decision: "manage_reconcile"`. Blocked decisions require
manage/escalation handling, not another dispatch.

5. Reconcile dispatch through manage mode. Manage must consume the
`dispatch_reconcile_check.v1` result, write its decision/result artifacts, and
apply any queue mutation only through the work queue CLI. Never hand-edit
`.seeds/**`.

6. Check the proposed run transition:

```bash
bun skills/seedstack/scripts/check-run-transition.ts \
  --run-state tmp/seedstack/<slug>/run-state.json \
  --next-state <idle|dispatching|done|blocked|escalated|loop_cap> \
  --seed <work-id> \
  --scan-file tmp/seedstack/<slug>/scan.json \
  --adoption-check tmp/seedstack/<slug>/adoption-check.json \
  --dirty-result tmp/seedstack/<slug>/dirty.json \
  --reconcile-result tmp/seedstack/<slug>/reconcile.json \
  --pretty
```

7. Check commit ledger before leaving a per-seed clean close:

```bash
bun skills/seedstack/scripts/check-commit-ledger.ts \
  --seedstack-dir tmp/seedstack/<slug> \
  --seed <work-id> \
  --pretty
```

For `commit_policy: "per_seed"` and `latest_dispatch.status:
"closed_clean"`, do not transition back to idle/done while
`latest_dispatch.commit_pending` is true.

8. Update run state only through the approved script after the transition
checker approves:

```bash
bun skills/seedstack/scripts/update-run-state.ts \
  --seedstack-dir tmp/seedstack/<slug> \
  --state <state> \
  --seed <work-id> \
  --pretty
```

`run-state.json` is canonical and `run.md` is the generated human view. Do not
edit either file by hand during recovery.

The advisory checker can identify the next safe command without writing:

```bash
bun skills/seedstack/scripts/check-recovery-state.ts \
  --seedstack-dir tmp/seedstack/<slug> \
  --scan-file tmp/seedstack/<slug>/scan.json \
  --adoption-check tmp/seedstack/<slug>/adoption-check.json \
  --dirty-result tmp/seedstack/<slug>/dirty.json \
  --reconcile-result tmp/seedstack/<slug>/reconcile.json \
  --run-transition tmp/seedstack/<slug>/transition.json \
  --commit-check tmp/seedstack/<slug>/commit-check.json \
  --pretty
```

It emits `recovery_check.v1` with `next_safe_command`. It is advisory only,
does not mutate queue or run artifacts, and is not wired into
`seedstack-loop.ts`.

Recovery artifacts are grouped by attempt under
`tmp/seedstack/<slug>/recovery/rec-####/`. Use canonical recovery paths such as
`recovery/rec-0001/scan.json`, `dirty.json`, `validation.json`,
`reconcile.json`, `transition.json`, `commit-check.json`,
`recovery-check.json`, and `notes.md`. Do not create root-level recovery files
for new runs.

Recovery decisions:

- `scan_required`: run the queue scan first.
- `adoption_check_required`: validate adoption before choosing work.
- `dirty_check_required`: classify worktree state before recovery action.
- `blocked_dirty`: stop; unexpected dirty paths need user review/resolution.
- `reconcile_required`: validate the in-flight dispatch before any new work.
- `run_transition_required`: run the transition checker.
- `commit_ledger_required`: verify per-seed commit ledger before leaving
  manage.
- `dispatch_allowed`: transition to `dispatching` via `update-run-state.ts`,
  then invoke dispatch-work for the explicit seed.
- `run_state_update_required`: apply the approved state transition through
  `update-run-state.ts`.
- `no_op`: terminal state such as `done`; do not mutate state.

Seed creation dirties `.seeds/issues.jsonl` and sometimes related queue files.
The required workflow is: create seeds -> commit queue baseline -> run auto.
Before first auto dispatch, the supervisor checks `.seeds/**` queue paths after
scan/adoption and before normal dirty classification, loop-cap checks, or
dispatch transition. If any queue path is dirty, excluding
`.seeds/knowledge.jsonl`, it stops with
`preexisting_queue_dirty_before_auto_run`, includes `queue_dirty_paths`, and
reports the remedy to commit seed creation/queue baseline first.

At every loop boundary (resume, before dispatch, before manage mutation,
before commit, and before selecting the next seed), refresh dirty state and
classify each path as `preexisting_user`, `dispatcher_owned`,
`expected_artifact`, `expected_seed`, or `unexpected`. Auto run stops on any
`unexpected` path. A mixed state may continue only when every path is
classified and recorded in the current decision/result. Use
`skills/seedstack/scripts/classify-dirty-state.ts` for deterministic
classification.

Before adoption checker and run-state updates, normalize fresh CLI state with
`skills/seedstack/scripts/scan-seedspec-cli.ts`. It runs only read-only
`list/ready/blocked --json` commands, tries `health --json` when the CLI
supports it, and emits `seedstack_scan.v1`.
Persist the JSON, then pass it with the adopted set:

```bash
bun skills/seedstack/scripts/check-adoption-selection.ts --adoption-selection <adoption-selection.json> --scan-file <scan.json> --pretty
```

Continue only on `adoption_selection_check.v1` with `ok=true`, then choose only
from `explicit_candidate_ids`.

Before dispatch selection and before any retry/continue that would start the
next loop iteration, run
`skills/seedstack/scripts/check-loop-caps.ts --run-state <run-state.json> --adoption-selection <adoption-selection.json> --scan-file <scan.json> --seed <work-id> --increment-loop --pretty`.
Continue only on `loop_cap_check.v1` with `ok=true`; in auto mode, a
per-seed `blocked_attempt_cap` may be recorded as a checked skip before trying
another candidate. Stop on blocked loop, no-progress, or follow-up growth caps.

After classification or reconciliation, call
`skills/seedstack/scripts/check-run-transition.ts` before every
`update-run-state.ts` state change. Pass `--run-state <run-state.json>`,
`--current-state <state>`, `--next-state <state>`, `--seed <work-id>` when a
seed is selected or active, and evidence JSON already persisted from
`--adoption-check`, `--scan-file`, `--dirty-result`, `--reconcile-result`, or
`--commit-check` as relevant. Before dispatch, include adoption check, scan,
and dirty result. For `dispatching -> managing`, include
`--reconcile-result`. For per-seed closed-clean `managing -> idle|done`,
include `--commit-check`. Continue only on `run_transition_check.v1` with
`ok=true`.

After the transition check passes, call
`skills/seedstack/scripts/update-run-state.ts --seedstack-dir <dir> --state <state>`
with the current state, selection, dirty result, reconciliation result, and
stop/done reason. `dispatching` and `managing` require `--seed <work-id>`,
`--decision <decision>`, and `--rationale <text>`. Terminal states require a
reason. Do not hand-edit `run-state.json` and then separately update `run.md`;
that causes drift.

After a per-seed commit is recorded, run
`skills/seedstack/scripts/check-commit-ledger.ts --seedstack-dir <dir> --run-state <run-state.json> --seed <work-id> --commit <sha> --commit-policy per_seed --expected-path <path> --pretty`
before selecting the next seed. Pair it with
`check-dispatch-reconcile.ts`: dispatch reconciliation proves the clean close;
commit ledger check proves the recorded commit, ledger row, commit path
allowlist, and current dirty guard. Use `--expected-path` for expected dirty
paths, or rely on the existing dirty_state allowlist already recorded in run
state. The default ledger artifact is the Markdown table at
`<seedstack-dir>/commit-ledger.md`; override with `--commit-ledger` only when
using a nonstandard path.

## Cheap Loop Testing

Use fixture mode to exercise the real outer supervisor without real Codex
children or real work queue mutation:

```bash
bun skills/seedstack/scripts/seedstack-loop-fixture.ts --self-test --pretty
```

The fixture runner creates a temp git repo, symlinks `skills/`, runs
`seedstack-loop.ts`, supplies a fake work queue CLI through `--seed-cli`, and
supplies a fake child launcher through `--codex-bin`. It still runs the normal
scan, adoption, dirty-state, dispatch validation, reconciliation, transition,
and run-state update scripts.

Built-in scenarios live under `skills/seedstack/test/loop-scenarios/`.
Add narrow JSON scenarios there for orchestrator paths such as happy done,
dispatch validation block, manage follow-up cap, no-ready deadlock, or done
revalidation. Keep real dogfood runs as canaries; use fixture mode for cheap
regression coverage.

Script result contract: checkers emit one JSON object. The supervisor emits
JSONL events and a final JSON event. Persist each JSON result before passing it
to the next checker/tool. Continue only when `ok=true`; for contracts that
expose `decision`, also require the expected decision for that step. Exit code 1
means the check failed; exit code 2 means usage or tool failure.

## Supervisor Artifact Layout

Run-loop artifacts use Option 1.5 layout:

```text
tmp/seedstack/<slug>/
  loop-state.json
  loop/
    0001-scan.json
    0001-dispatch-<seed>.log
    0002-pre-manage-dirty-<seed>.json
  recovery/
    rec-0001/
      manifest.json
      scan.json
      dirty.json
      validation.json
      reconcile.json
      transition.json
      commit-check.json
      recovery-check.json
      notes.md
```

`loop-state.loop_iteration` means the last allocated supervisor artifact
number. New supervisor processes allocate
`max(loop-state.loop_iteration, max existing loop/NNNN-*) + 1`; this may leave
a gap after a crash but must not overwrite earlier artifacts. Managed
same-seed retry also allocates a fresh loop number before dirty checks or
child launch, so retry logs and results remain non-clobbering.

## Auto Run Mode

`seedstack run auto` means the orchestrator may continue across cleanly closed
seeds without asking the user which ready seed to dispatch next. Auto mode does
not remove adoption, mutation, dispatch, review, verify, close, or dirty-guard
rules.

Auto mode still needs a fixed adopted set recorded in the active adoption
manifest. For legacy runs this is `adoption-selection.json`; for epoch-aware
runs it is `adoption/active.json` or the active epoch path recorded in
`run-state.json`. If no adoption selection exists, run the read-only adoption
scan first. When the user supplied an explicit stack filter or label, write the
active manifest from that filter before dispatching. When no explicit stack
filter or label exists, ask once before mutating or dispatching. After adoption
is fixed, run `skills/seedstack/scripts/check-adoption-selection.ts --adoption-selection <active-manifest.json> --scan-file <scan.json> --pretty`
before dispatch selection. Auto run may select only from `explicit_candidate_ids` in the
`adoption_selection_check.v1` result. The checker orders ready adopted
candidates by active manifest order: `planned_order` rank/order first when
present, otherwise `adopted_seed_ids` order. Raw CLI ready order is only a
readiness input.

When the adopted set/filter changes, create a new adoption epoch. Preserve
prior manifests and record the active epoch in `run-state.json`; legacy
manifests without an epoch are epoch `0`. Mutations outside the active adopted
epoch require explicit user-approved expansion.

Selection is constrained:

1. Candidate ids must be open, unassigned, ready, and present in the active
   adoption manifest.
2. Never use a generic next-work selector after adoption; dispatch receives the
   chosen explicit id.
3. Prefer the first ready adopted seed in active manifest order/rank. Use
   `planned_order` rank/order when present, otherwise `adopted_seed_ids` order.
   That order should follow the planned dependency spine. Skipped seeds are
   ignored. Do not use raw CLI ready order, numeric priority, `createdAt`, or
   generated id hashes as scheduling signals.
4. Record candidate ids, chosen id, and selection rationale in
   `run-state.json`; refresh `run.md`.
5. If no adopted candidate is ready, stop and classify the state instead of
   expanding the stack.

Auto mode commit behavior:

- `commit_policy=per_seed`: after a clean close and manage reconciliation,
  review the diff, create the per-seed commit, record the hash in the commit
  ledger, and continue.
- `commit_policy=none`: never commit.

`seedstack run auto` implies `commit_policy=per_seed` unless the user or
existing canonical run state explicitly says `none`. Manual
`seedstack run` keeps the non-auto default: pause at the per-seed commit point
for user review.

Auto mode stops immediately on failed gates, dispatch escalation, user block,
unexpected dirty worktree, no-ready deadlock, loop cap, or follow-up growth cap
requiring user approval. Exception: after failed gates or dispatch escalation,
manage may retry the same seed without asking under the Post-Escalation Retry
Worktree Posture below, or may continue through the boundary-deferred gate
assertion path above after `dispatch-work` reports local done and manage closes
the current seed under that contract.

## Git Commit Policy

Seedstack does not automatically create git commits. The default recommended
commit point is after one seed closes cleanly and manage mode reconciles the
dispatch result. At that point, the orchestrator should pause for git diff
review and commit unless the user explicitly chose batch commits or no commits.

Exception: in `run auto` with `commit_policy=per_seed`, the orchestrator should
create the per-seed commit automatically after diff review and before selecting
the next seed.

Use per-seed commits when the closed seed produced a coherent implementation,
spec, conformance, or test slice that is understandable and rollbackable on its
own. Use `commit_policy=none` only when an explicit outer workflow will handle
commits later.

Do not commit before review/verify, while gates are failing, or
before SeedSpec close unless the user explicitly requests a checkpoint/WIP
commit.

## Post-Escalation Retry Worktree Posture

After a dispatch escalation or failed-gate stop, the orchestrator may retry the
same seed without asking only when retry is non-destructive and every dirty path
is freshly classified as dispatcher-owned, expected artifact, or expected seed
state for that same seed. The default no-ask posture is
`continue_from_dirty_attempt`.

The orchestrator must ask before any destructive or policy-changing action:
commit, reset, revert, discard, user waiver, scope expansion, graph mutation, or
continuing with unexpected/preexisting-user dirty paths.

Allowed retry postures:

- `continue_from_dirty_attempt`: keep dispatcher-owned implementation changes
  and start a new dispatch/execute round after fresh dirty-state
  classification. This is the default no-ask posture when all dirty paths are
  owned/expected for the same seed and retry budget remains.
- `reset_attempt`: revert dispatcher-owned implementation changes only after
  explicit user approval; preserve work queue CLI state and audit artifacts unless
  the user explicitly requests otherwise.
- `checkpoint_wip`: create a clearly labeled WIP/checkpoint commit only when
  the user explicitly requests it; record failed gates, unresolved risk, and
  rollback impact. This is not a per-seed clean-close commit.

Before retry, refresh CLI state, dirty-state classification, dispatch attempt
count, and required gate inventory. Prior failed gates and risk verdicts remain
context only; they do not satisfy the retry close contract.

When `commit_policy=per_seed`, maintain an append-only commit ledger with seed
id, commit hash, subject, gates, dirty snapshot/classification, and policy in
`<seedstack-dir>/commit-ledger.md` as a Markdown table.
Workflow-only commits during auto run need an explicit `workflow_commit` ledger
entry with reason, diffstat, gates, and rollback impact.

Recommended commit message body includes the work order id and gates:

```text
Implement CLI option syntax diagnostics in Go

Work order: seedspec-72da
Gates: make check; make conformance
```

Never call a generic next-work selector from run mode after adoption. The orchestrator
chooses from ready seeds whose ids are present in the active adoption manifest;
dispatch gets an explicit id. If no adopted seed is ready, run health checks
and classify the stop state instead of selecting outside the adopted set.

Default loop caps:

- 50 total iterations
- 3 dispatch attempts per seed
- 3 consecutive no-progress iterations
- follow-up growth checkpoint after `max(2, floor(initial_open * 0.2))`
  manager-created seeds; record baseline in `run-state.json`

Before declaring no-ready deadlock, run fresh CLI list/ready/blocked checks
and classify as `active_wait`, `assigned_other`, `blocked_graph`,
`corrupt_graph`, or `true_done`.

## Adoption Scan

Run mode starts with a read-only adoption scan of existing work queue state:
list/ready/blocked plus labels, assignees, deps, and terminal states.

If open seeds exist and the user did not explicitly choose a stack, write
`tmp/seedstack/<slug>/adoption.md` and ask before dispatching or creating:
adopt all, adopt a labeled subset, create a separate stack, or stop.

After the user chooses, write `tmp/seedstack/<slug>/adoption-selection.json`
with adopted work order ids, selected label/filter, excluded open ids, baseline state
counts, baseline follow-up growth counter, timestamp, and user decision
summary. Manage mutations are limited to this manifest unless the user expands
it.

Do not relabel, add deps, create seeds, assign seeds, or dispatch during the
adoption scan.

## CLI Preflight

Before manage or run mutates state, resolve the repo-root work queue CLI from
`AGENTS.md` and record the exact command prefix in the decision/run artifact.
This skill defaults to `sd`; verify it before closing, creating, or changing
dependencies.
If `sd` is missing, stop and ask the user to install seed from
https://github.com/jayminwest/seeds before any queue read or mutation. Do not
substitute another queue CLI without explicit user input.
If `.seeds` is missing in run/manage mode, stop and ask before `sd init`; never
auto-initialize queue state.
