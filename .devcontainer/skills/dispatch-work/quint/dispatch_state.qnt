// SPEC: dispatch-work-state (role: canonical)
// SHADOWS: skills/dispatch-work/SKILL.md :: core dispatch loop
// INVARIANTS: noDoneBeforeVerifiedPass, noDoneBeforeFullGate,
//   packetRequiresResearchCoverage, executePassRequiresReview,
//   researchRequiresWorkOrder, executeRequiresScopeBudget,
//   boundedRoundsAndAttempts, executeReportInactive, terminalExclusive,
//   terminalInactive, nestedFailureStops, noQueueMutation
// REPLAY: none (skill/process model only)
// NEG-CONTROL: skills/dispatch-work/quint/dispatch_state.neg.qnt
// LAST-SYNCED: dispatch-work skill 2026-05-15
// REVIEW: Core-loop model only: WorkOrder -> Research -> Packet -> Execute
//   (Implement -> Review attempts) -> Verify -> Gate -> done/retry/escalate.
//   Detailed prompt/status/launcher schemas, knowledge capture, artifact
//   content validation, and seedstack queue evidence are out of scope. Detailed
//   queue mechanics are out of scope; abstract no-mutation is modeled.

module dispatch_state {
  pure val MAX_ROUNDS = 3
  pure val MAX_ATTEMPTS = 3

  var researchOk: bool
  var workOrderReady: bool
  var scopeBudgetOk: bool
  var packet: bool
  var executeActive: bool
  var implementDone: bool
  var reviewDone: bool
  var reviewPass: bool
  var executeReport: bool
  var executePass: bool
  var verifyDone: bool
  var verifyPass: bool
  var gateMd: bool
  var done: bool
  var escalated: bool
  var nestedFailed: bool
  var partialArtifactsCollected: bool
  var queueMutated: bool
  var round: int
  var attempt: int

  val fullGateReady = all {
    workOrderReady,
    scopeBudgetOk,
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
    workOrderReady' = false,
    scopeBudgetOk' = false,
    packet' = false,
    executeActive' = false,
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    executeReport' = false,
    executePass' = false,
    verifyDone' = false,
    verifyPass' = false,
    gateMd' = false,
    done' = false,
    escalated' = false,
    nestedFailed' = false,
    partialArtifactsCollected' = false,
    queueMutated' = false,
    round' = 0,
    attempt' = 0,
  }

  action writeWorkOrder = all {
    not(done),
    not(escalated),
    not(workOrderReady),
    researchOk' = researchOk,
    workOrderReady' = true,
    scopeBudgetOk' = false,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action finishResearch = all {
    workOrderReady,
    not(done),
    not(escalated),
    not(researchOk),
    researchOk' = true,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action writePacket = all {
    workOrderReady,
    researchOk,
    not(packet),
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = true,
    packet' = true,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action startExecute = all {
    packet,
    scopeBudgetOk,
    not(executeActive),
    not(executeReport),
    not(done),
    not(escalated),
    round < MAX_ROUNDS,
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = true,
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    executeReport' = false,
    executePass' = false,
    verifyDone' = false,
    verifyPass' = false,
    gateMd' = false,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round + 1,
    attempt' = 0,
  }

  action implementAttempt = all {
    executeActive,
    not(implementDone),
    attempt < MAX_ATTEMPTS,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = true,
    reviewDone' = false,
    reviewPass' = false,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt + 1,
  }

  action reviewPasses = all {
    executeActive,
    implementDone,
    not(reviewDone),
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = true,
    reviewPass' = true,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action reviewBlocks = all {
    executeActive,
    implementDone,
    not(reviewDone),
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = true,
    reviewPass' = false,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action retryImplement = all {
    executeActive,
    reviewDone,
    not(reviewPass),
    attempt < MAX_ATTEMPTS,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action executeReportsPass = all {
    executeActive,
    implementDone,
    reviewDone,
    reviewPass,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = false,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = true,
    executePass' = true,
    verifyDone' = false,
    verifyPass' = false,
    gateMd' = false,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action executeReportsBlock = all {
    executeActive,
    reviewDone,
    not(reviewPass),
    attempt >= MAX_ATTEMPTS,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = false,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = true,
    executePass' = false,
    verifyDone' = false,
    verifyPass' = false,
    gateMd' = false,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action verifyPasses = all {
    executeReport,
    executePass,
    not(verifyDone),
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = true,
    verifyPass' = true,
    gateMd' = false,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action verifyBlocks = all {
    executeReport,
    not(verifyDone),
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = true,
    verifyPass' = false,
    gateMd' = false,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action writeGate = all {
    executeReport,
    verifyDone,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = executeActive,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = true,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action reportDone = all {
    fullGateReady,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = false,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = true,
    escalated' = false,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action retryDispatch = all {
    executeReport,
    verifyDone,
    gateMd,
    not(fullGateReady),
    round < MAX_ROUNDS,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = false,
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    executeReport' = false,
    executePass' = false,
    verifyDone' = false,
    verifyPass' = false,
    gateMd' = false,
    done' = done,
    escalated' = escalated,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = partialArtifactsCollected,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = 0,
  }

  action escalate = all {
    not(done),
    not(escalated),
    any {
      nestedFailed,
      all { executeReport, verifyDone, gateMd, not(fullGateReady), round >= MAX_ROUNDS },
    },
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = false,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = false,
    escalated' = true,
    nestedFailed' = nestedFailed,
    partialArtifactsCollected' = true,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action nestedSubagentFails = all {
    executeActive,
    not(done),
    not(escalated),
    researchOk' = researchOk,
    workOrderReady' = workOrderReady,
    scopeBudgetOk' = scopeBudgetOk,
    packet' = packet,
    executeActive' = false,
    implementDone' = implementDone,
    reviewDone' = reviewDone,
    reviewPass' = reviewPass,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    gateMd' = gateMd,
    done' = false,
    escalated' = true,
    nestedFailed' = true,
    partialArtifactsCollected' = true,
    queueMutated' = queueMutated,
    round' = round,
    attempt' = attempt,
  }

  action step = any {
    writeWorkOrder,
    finishResearch,
    writePacket,
    startExecute,
    implementAttempt,
    reviewPasses,
    reviewBlocks,
    retryImplement,
    executeReportsPass,
    executeReportsBlock,
    verifyPasses,
    verifyBlocks,
    writeGate,
    reportDone,
    retryDispatch,
    nestedSubagentFails,
    escalate,
  }

  val noDoneBeforeVerifiedPass = done implies all {
    packet,
    executeReport,
    executePass,
    verifyDone,
    verifyPass,
  }

  val noDoneBeforeFullGate = done implies fullGateReady

  val packetRequiresResearchCoverage = packet implies researchOk

  val researchRequiresWorkOrder = researchOk implies workOrderReady

  val packetRequiresScopeBudget = packet implies scopeBudgetOk

  val executeRequiresScopeBudget = (executeActive or executeReport or done) implies all {
    packet,
    scopeBudgetOk,
  }

  val executePassRequiresReview = executePass implies all {
    implementDone,
    reviewDone,
    reviewPass,
  }

  val boundedRoundsAndAttempts = all {
    0 <= round,
    round <= MAX_ROUNDS,
    0 <= attempt,
    attempt <= MAX_ATTEMPTS,
  }

  val executeReportInactive = executeReport implies not(executeActive)

  val terminalExclusive = not(done and escalated)

  val terminalInactive = (done or escalated) implies not(executeActive)

  val nestedFailureStops = nestedFailed implies all {
    escalated,
    partialArtifactsCollected,
    not(done),
  }

  val noQueueMutation = not(queueMutated)
}
