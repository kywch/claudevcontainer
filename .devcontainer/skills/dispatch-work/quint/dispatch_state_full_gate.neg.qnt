// SPEC: dispatch-work-state (role: negative-control)
// SHADOWS: dispatch_state.qnt :: noDoneBeforeFullGate
// EXPECTED: `quint run ... --invariant=noDoneBeforeFullGate` violates.

module dispatch_state_full_gate_neg {
  var researchOk: bool
  var packet: bool
  var executeReport: bool
  var executePass: bool
  var implementDone: bool
  var reviewDone: bool
  var reviewPass: bool
  var verifyDone: bool
  var verifyPass: bool
  var gateMd: bool
  var done: bool

  val fullGateReady = all {
    researchOk,
    packet,
    executeReport,
    executePass,
    implementDone,
    reviewDone,
    reviewPass,
    verifyDone,
    verifyPass,
    gateMd,
  }

  action init = all {
    researchOk' = false,
    packet' = false,
    executeReport' = false,
    executePass' = false,
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    verifyDone' = false,
    verifyPass' = false,
    gateMd' = false,
    done' = false,
  }

  action shallowPass = all {
    not(done),
    researchOk' = false,
    packet' = true,
    executeReport' = true,
    executePass' = true,
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    verifyDone' = true,
    verifyPass' = true,
    gateMd' = false,
    done' = false,
  }

  action doneWithoutFullGate = all {
    packet,
    executeReport,
    executePass,
    verifyDone,
    verifyPass,
    not(done),
    researchOk' = researchOk,
    packet' = packet,
    executeReport' = executeReport,
    executePass' = executePass,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = true,
  }

  action step = any {
    shallowPass,
    doneWithoutFullGate,
  }

  val noDoneBeforeFullGate = done implies fullGateReady
}
