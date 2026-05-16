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
`adoption_selection_check.v1` result.

When the adopted set/filter changes, create a new adoption epoch. Preserve
prior manifests and record the active epoch in `run-state.json`; legacy
manifests without an epoch are epoch `0`. Mutations outside the active adopted
epoch require explicit user-approved expansion.

Selection is constrained:

1. Candidate ids must be open, unassigned, ready, and present in the active
   adoption manifest.
2. Never use a generic next-work selector after adoption; dispatch receives the
   chosen explicit id.
3. Prefer lower numeric priority, then older `createdAt`, then lexicographic
   id. The LLM may override this tie-breaker only for a recorded local reason
   such as batching same-file work, avoiding an unexpected dirty path, or
   choosing a review/hardening seed after all implementation blockers closed.
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
