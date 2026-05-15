# Quint Model Artifacts

These Quint artifacts model the core `dispatch-work` loop: local execution only,
with `done`/`escalate` terminal states and internal retry rounds. Detailed
prompt/status/launcher schemas, knowledge capture, and boundary-deferred
seedstack evidence are out of scope. Detailed queue mechanics are out of scope,
but the abstract `noQueueMutation` boundary is modeled.

- Quint model: `../quint/dispatch_state.qnt`
- Negative controls:
  - `../quint/dispatch_state.neg.qnt`
  - `../quint/dispatch_state_full_gate.neg.qnt`
  - `../quint/dispatch_state_execute_review.neg.qnt`
  - `../quint/dispatch_state_queue_mutation.neg.qnt`
- Counterexample traces:
  - `../quint/dispatch_state.neg.itf.json`
  - `../quint/dispatch_state_full_gate.neg.itf.json`
  - `../quint/dispatch_state_execute_review.neg.itf.json`
  - `../quint/dispatch_state_queue_mutation.neg.itf.json`
- Report: `../quint/quint-dispatch-report.md`

Useful commands from `/workspace/.devcontainer`:

```bash
quint typecheck skills/dispatch-work/quint/dispatch_state.qnt
quint run skills/dispatch-work/quint/dispatch_state.qnt --backend=typescript --invariants noDoneBeforeVerifiedPass noDoneBeforeFullGate packetRequiresResearchCoverage researchRequiresWorkOrder packetRequiresScopeBudget executeRequiresScopeBudget executePassRequiresReview boundedRoundsAndAttempts executeReportInactive terminalExclusive terminalInactive nestedFailureStops noQueueMutation --max-samples=5000 --max-steps=30
```

Negative controls should violate:

```bash
quint run skills/dispatch-work/quint/dispatch_state.neg.qnt --backend=typescript --invariant=noDoneBeforeVerifiedPass --out-itf=skills/dispatch-work/quint/dispatch_state.neg.itf.json --max-samples=500 --max-steps=8
quint run skills/dispatch-work/quint/dispatch_state_full_gate.neg.qnt --backend=typescript --invariant=noDoneBeforeFullGate --out-itf=skills/dispatch-work/quint/dispatch_state_full_gate.neg.itf.json --max-samples=500 --max-steps=4
quint run skills/dispatch-work/quint/dispatch_state_execute_review.neg.qnt --backend=typescript --invariant=executePassRequiresReview --out-itf=skills/dispatch-work/quint/dispatch_state_execute_review.neg.itf.json --max-samples=100 --max-steps=2
quint run skills/dispatch-work/quint/dispatch_state_queue_mutation.neg.qnt --backend=typescript --invariant=noQueueMutation --out-itf=skills/dispatch-work/quint/dispatch_state_queue_mutation.neg.itf.json --max-samples=100 --max-steps=2
```

Exhaustive verify needs Java/Apalache. If unavailable, record `java: not found`
and rely on sampled run plus negative controls.
