# Seedstack Run Loop Mapping

`run_loop.qnt` is a Quint-backed target policy for the deterministic outer
supervisor in `skills/seedstack/scripts/seedstack-loop.ts`. It is not a model of
LLM behavior, child process IO, dirty worktree classification internals, commit
ledger details, or SeedSpec CLI parsing. The policy is intentionally ahead of
the current runtime until the supervisor scripts are updated to route all
concrete dispatch outcomes through manage.

## Phase Mapping

| Quint phase | Runtime representation |
| --- | --- |
| `Idle` | `run-state.json.state == "idle"` before scan/select |
| `Dispatching` | `run-state.json.state == "dispatching"` with one in-flight seed |
| `Reconciling` | dispatch artifacts exist and `check-dispatch-reconcile.ts` runs; not a persisted run-state |
| `Managing` | `run-state.json.state == "managing"` after clean dispatch reconcile |
| `Done` | `run-state.json.state == "done"` after fresh scan proves no adopted open/ready seeds |
| `Stopped` | one of `blocked`, `escalated`, or `loop_cap` |

## Result Policy

The runtime may retry a seed after dispatch starts only after reconciliation
and manage have classified the non-close result. Manage has two non-close
outcomes: retry the same seed within the attempt cap, or block loudly. Retries
must keep the same seed in flight and preserve dispatch artifacts.

| Quint result | Runtime behavior |
| --- | --- |
| `ClosedResult` | dispatch child returned `decision: "closed"`; exact validation and reconcile can enter `managing` |
| `RetryResult` | dispatch artifacts/gate request retry; reconcile enters `managing`; manage may choose bounded same-seed retry or stop |
| `EscalatedResult` | dispatch artifacts/gate request escalation; reconcile enters `managing`; manage may classify as retryable or stop/user-block |
| `BlockedResult` | dispatch child/reconcile block; reconcile enters `managing`; manage triages retry vs user block |
| `CrashedResult` | child launch/exit/timeout/crash; reconcile enters `managing`; manage triages infra retry vs user block |
| attempt-capped ready seed | while still `idle`, loop records `skipped_seeds`, emits `seed_skipped`, and selects the next unskipped candidate |

Attempt cap matters before dispatch and before managed same-seed retry:
`check-loop-caps.ts` prevents starting another dispatch when
`dispatch_attempts[seed] >= 3`. Before dispatch, the supervisor records checked
skip evidence and selects another unskipped candidate. After dispatch, manage
cannot retry past the cap; it must block loudly instead. If all remaining ready
work is skipped, the loop reaches `exhausted`; it must not mark the run `done`
while skipped open work remains.

## Invariant Mapping

| Quint invariant | Runtime evidence | Alignment fixture |
| --- | --- | --- |
| `doneRequiresFreshScanAndNoOpen` | `check-run-transition.ts` blocks `idle -> done` when scan has adopted open/ready work; `seedstack-loop.ts` also requires `scan_epoch > manage_epoch` | `doneRequiresFreshScanAndNoOpen` |
| `exhaustedRequiresFreshScanAndAllOpenSkipped` | `check-run-transition.ts` allows `idle -> exhausted` only with a fresh scan where all adopted open/ready ids are in `--skipped-seed` evidence | `attemptCapSkipMatchesModel`, `attempt-cap-skip-continues` |
| `oneDispatchAtATime` | persisted run-state has at most one `in_flight_seed_id`; transition graph prevents `dispatching -> idle` | `manageBeforeNextDispatch` |
| `manageBeforeNextDispatch` | dispatching must reconcile to managing before returning idle; idle selection always writes dispatching before child launch | `manageBeforeNextDispatch` |
| managed same-seed retry | all concrete dispatch results enter manage; non-close manage either retries the same seed within attempt cap or blocks loudly | `retryPolicyMatchesModel` |
| `followupCapsRespected` | manage step enforces per-manage cap 2 and total cap 5; `check-loop-caps.ts` enforces persisted follow-up growth cap | `followupCapsRespected`, `perManageFollowupCap` |
| `retryCapRespected` | `check-loop-caps.ts` attempt cap default is 3, matching `MAX_ATTEMPTS` | `attemptCapMatchesModel` |
| `skippedSeedsNeverDone` / `skippedSeedsAreAttemptCapped` | `seedstack-loop.ts` filters skipped candidates, records only checked `blocked_attempt_cap` skips, and uses `exhausted` instead of `done` while skipped work remains open/ready | `attemptCapSkipMatchesModel`, `attempt-cap-skip-continues` |
| `stoppedIsLoud` / `stopReasonMatchesPhase` | `check-run-transition.ts` requires stop reason or blocker evidence for terminal states | `stoppedIsLoud` |
| `followupCapStopMatchesRequest` | loop stops with `loop_cap` when requested follow-ups would exceed budget | `followupCapsRespected` |

`seedPartition` and `adoptedWithinUniverse` are model-level abstractions. Runtime
coverage comes from `scan-seedspec-cli.ts` and `check-adoption-selection.ts`,
not from this Quint model.

`skipReachabilityProbe` is an intentional non-invariant used only by
`attemptCapSkipMatchesModel`; it must be violated to prove the skip path is not
vacuous.

## Gates

`check-run-loop-model-alignment.ts` must fail while runtime is still behind the
target policy. The model gates should pass independently.

```bash
rtk quint typecheck skills/seedstack/quint/run_loop.qnt
rtk quint run skills/seedstack/quint/run_loop.qnt --backend=typescript --invariant=allInvariants --max-samples=2000 --max-steps=40
# expected violation / nonzero exit:
rtk quint run skills/seedstack/quint/run_loop.neg.qnt --backend=typescript --invariant=doneRequiresFreshScanAndNoOpen --max-samples=500 --max-steps=15
# expected nonzero until runtime catches up:
bun skills/seedstack/scripts/check-run-loop-model-alignment.ts --self-test --pretty
```
