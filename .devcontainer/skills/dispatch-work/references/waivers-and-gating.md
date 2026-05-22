# Waivers And Gating

## Waivers

- Only user may waive agent timeout/failure, skipped or failed required gates,
  blocking Review/Verify findings, or `risk` verdicts.
- Subagents may recommend waivers but cannot grant them.
- Dispatcher records each waiver in `gate.md` with approver, reason, scope,
  residual risk, and expiry if any.
- `boundary_deferred` is not a user waiver. It is allowed only when
  `seedstack` manage classifies exact failed assertions as out-of-boundary for
  the current seed, maps them to a later adopted owner seed, and records the
  required evidence. Dispatcher may report local `done` with
  `boundary_deferred` only for those exact assertions; all in-boundary
  assertions from the same gates must pass or be user-waived.
- `risk` permits local `done` only with accepted residual risk in `gate.md`.
- `block` requires retry, explicit user waiver, or escalation. A waived
  Review/Verify block does not become `pass`; `gate.md` must record the waiver
  and residual risk.

## Gate Decisions

Report local `done` only if:

- latest Execute verdict is `pass`
- latest Execute recommendation is `done` (`close` is accepted only as legacy
  validator vocabulary meaning local done, never queue close)
- latest Execute-owned Review verdicts pass or blocking/risk findings are
  fixed or user-waived
- latest Verify verdicts pass or blocking/risk findings are fixed or
  user-waived
- required gates pass, are user-waived, or exact failed assertions are
  recorded as `boundary_deferred` by `seedstack` manage, with all in-boundary
  assertions passing or user-waived
- skipped gates are user-waived
- gate inventory drift is reconciled: if totals, target lists, runner identity,
  generated binaries, or inventory changed since packet/baseline, rerun current
  required gates and record why current inventory is authoritative
- latest child reports or failure capsules are validated against status/end
  markers; missing, stale, malformed, or empty reports
  normally require retry/escalation and allow done only with explicit user
  waiver, recorded residual risk, and no uncertainty about implementation
  correctness
- `gate.md` exists and records artifacts, gates, waivers, unresolved risk, and
  final decision

Retry when Verify/Review findings are fixable and retry budget remains. This
includes in-scope cleanup and hardening opportunities, not only correctness
blockers. A nonblocking cleanup/hardening finding may be deferred only when the
gate records a specific rationale and residual risk. Cleanup means removing
redundant or dead code/tests touched by the slice; it must not become
opportunistic refactoring, style churn, module reshaping, broad rewrites, or
new abstractions.

Suggest follow-up work orders when scope changed or residual risk belongs
outside the current work item. Do not create them during dispatch, even when
the user asks in the current turn. Record the proposal and route graph
mutation through `seedstack` manage mode. Suggested follow-ups never make
incomplete work done; report done only if current acceptance criteria fully
pass, otherwise retry or escalate.

Boundary-deferred assertions differ from follow-up suggestions: they can make
current work locally done only when manage has proven the failed assertions
already belong to a later adopted owner work order and dispatch records the
exact carry-forward gates for that later owner. Do not use
`boundary_deferred` for safety/security/data-loss/destructive-mutation gates,
lock/corruption risks with possible data loss, or any uncertainty about
implementation correctness.

When `boundary_deferred` is used, write
`tmp/dispatch-work/<work-id>/boundary-deferred.json` before `gate.md`.

Fields: assertion id/signature, failed gate/case, expected/actual summary,
current boundary quote, manage classification artifact, later owner work order id,
carry-forward gate, prohibited-risk check, final proof path. Skip for normal
dispatches.

Findings from optional lenses (`deslop`, `thermo-nuclear`) and verify-this
verdicts follow the same waiver rules as standard Review/Verify findings.
They do not introduce separate gate categories. A `NOT VERIFIED` claim from
verify-this is treated as a `risk` finding; Dispatcher records it in
`gate.md` and applies standard risk waiver rules.

Spec/protocol version bumps are promotion work. Dispatch may recommend a bump
when behavior is normative, but may not apply the bump unless the current work
explicitly owns promotion or the user confirms it during dispatch. For
draft-only spec work, prefer recording the target as "next draft" and suggest a
separate promotion seed.

Protocol promotion requires hardening review to cover, when relevant:

- exact read-only/no-lock/no-rewrite behavior
- exact or intentionally-extensible response shape
- ordering/sort definitions with cross-language deterministic semantics
- parser and validation edge cases, including repeated flags
- negative cases for out-of-scope command aliases/options
- PBT, model replay, or mutation testing for critical helpers/test oracles

If Review or Verify finds hardening gaps in promotion/release work, treat them
as blocking unless the user explicitly accepts a draft-only close or waives the
risk.

Escalate when budget exhausted, nested subagents unavailable, timeout cannot be
retried, child report/capsule validation cannot establish a trustworthy
terminal state, user denies needed waiver, or correctness remains uncertain.
