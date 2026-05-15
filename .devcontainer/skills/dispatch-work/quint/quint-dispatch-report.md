# Dispatch Work Quint Report

## Quint Model Artifacts

Inventory and run commands live in
`skills/dispatch-work/references/model-artifacts.md`.

## Invariants

- `noDoneBeforeVerifiedPass`: local `done` implies packet, Execute pass report,
  Execute pass, Verify done, and Verify pass.
- `noDoneBeforeFullGate`: local `done` implies Research, Packet, Execute pass,
  Implement done, Review pass, Verify pass, and gate.md.
- `packetRequiresResearchCoverage`: packet implies Research coverage.
- `researchRequiresWorkOrder`: Research completion requires work-order
  normalization.
- `packetRequiresScopeBudget`: packet implies a refined scope budget.
- `executeRequiresScopeBudget`: Execute cannot start or report without packet
  and refined scope budget.
- `executePassRequiresReview`: Execute cannot report pass unless an Implement
  attempt completed and Review passed inside the Execute round.
- `boundedRoundsAndAttempts`: Dispatch rounds and Implement attempts stay within
  configured bounds.
- `executeReportInactive`: Execute report implies Execute is no longer active.
- `terminalExclusive`: cannot be both local `done` and escalated.
- `terminalInactive`: terminal states imply no active Execute round.
- `nestedFailureStops`: nested subagent failure escalates, records partial
  artifacts, and cannot report local `done`.
- `noQueueMutation`: dispatch-work never mutates queue state.

## Results

- `quint typecheck skills/dispatch-work/quint/dispatch_state.neg.qnt`: pass
- `quint run skills/dispatch-work/quint/dispatch_state.neg.qnt --backend=typescript --invariant=noDoneBeforeVerifiedPass --out-itf=skills/dispatch-work/quint/dispatch_state.neg.itf.json --max-samples=500 --max-steps=8`: expected violation
- `quint typecheck skills/dispatch-work/quint/dispatch_state_full_gate.neg.qnt`: pass
- `quint run skills/dispatch-work/quint/dispatch_state_full_gate.neg.qnt --backend=typescript --invariant=noDoneBeforeFullGate --out-itf=skills/dispatch-work/quint/dispatch_state_full_gate.neg.itf.json --max-samples=500 --max-steps=4`: expected violation
- `quint typecheck skills/dispatch-work/quint/dispatch_state_execute_review.neg.qnt`: pass
- `quint run skills/dispatch-work/quint/dispatch_state_execute_review.neg.qnt --backend=typescript --invariant=executePassRequiresReview --out-itf=skills/dispatch-work/quint/dispatch_state_execute_review.neg.itf.json --max-samples=100 --max-steps=2`: expected violation
- `quint typecheck skills/dispatch-work/quint/dispatch_state_queue_mutation.neg.qnt`: pass
- `quint run skills/dispatch-work/quint/dispatch_state_queue_mutation.neg.qnt --backend=typescript --invariant=noQueueMutation --out-itf=skills/dispatch-work/quint/dispatch_state_queue_mutation.neg.itf.json --max-samples=100 --max-steps=2`: expected violation
- `quint typecheck skills/dispatch-work/quint/dispatch_state.qnt`: pass
- `quint run skills/dispatch-work/quint/dispatch_state.qnt --backend=typescript --invariants noDoneBeforeVerifiedPass noDoneBeforeFullGate packetRequiresResearchCoverage researchRequiresWorkOrder packetRequiresScopeBudget executeRequiresScopeBudget executePassRequiresReview boundedRoundsAndAttempts executeReportInactive terminalExclusive terminalInactive nestedFailureStops noQueueMutation --max-samples=5000 --max-steps=30`: pass

## Finding

Negative control proved the intended bug shape has teeth: Dispatcher can report
local `done` after Execute pass without independent Verify. Canonical requires
Verify resolution before `done` and holds under sampled execution.

Full-gate negative control proved a second bug shape: Dispatcher can report
local `done` after Execute+Verify pass while skipping Research, Implement,
Review, or gate.md. Canonical now requires the core gate before `done`.

Execute-review negative control proved Execute pass must be earned by the inner
Implement -> Review loop. Canonical models bounded Implement attempts inside
each Execute round.

Queue mutation negative control proves the boundary invariant has teeth:
`queueMutated` must remain false. Claim, close, follow-up creation, dependency
changes, labels, priority, split, and reorder work are routed to `seedstack`.

Residual: sampled Quint execution is not exhaustive model checking. Use
negative controls plus sampled canonical run unless Apalache/Java is available.
Detailed validator schema checks and `boundary_deferred` evidence are outside
this core-loop model.
