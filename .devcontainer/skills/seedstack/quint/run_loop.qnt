// SPEC: seedstack-run-loop (role: canonical)
// SHADOWS: skills/seedstack/scripts/seedstack-loop.ts :: outer supervisor
// INVARIANTS: doneRequiresFreshScanAndNoOpen, exhaustedRequiresFreshScanAndAllOpenSkipped, manageBeforeNextDispatch, skippedSeedsNeverDone, followupCapsRespected
// REPLAY: none (process model only)
// NEG-CONTROL: skills/seedstack/quint/run_loop.neg.qnt
//
// Models only the deterministic outer supervisor:
// scan, choose one explicit adopted seed, run dispatch as a black box,
// reconcile dispatches, manage bounded follow-ups, retry recoverable non-close
// dispatch outcomes for the same seed within the attempt cap, skip only seeds
// that hit the attempt cap, and stop loud only after manage classifies a
// non-close dispatch result as retryable or user-blocking, blockers, cap hits, or finish
// exhausted with all remaining work skipped. It deliberately
// does not model LLM prompt quality or inner dispatch roles.

module run_loop {
  type Phase = | Idle | Dispatching | Reconciling | Managing | Done | Exhausted | Stopped
  type DispatchResult =
    | NoResult
    | ClosedResult
    | RetryResult
    | EscalatedResult
    | BlockedResult
    | CrashedResult
  type StopReason = | NoStop | BlockedStop | FollowupCapStop

  pure val IDS = Set(1, 2, 3, 4, 5, 6, 7)
  pure val INITIAL_IDS = Set(1, 2)
  pure val MAX_ATTEMPTS = 3
  pure val MAX_FOLLOWUPS_PER_MANAGE = 2
  pure val MAX_TOTAL_FOLLOWUPS = 5

  var phase: Phase
  var adopted: Set[int]
  var open: Set[int]
  var inFlight: Set[int]
  var closed: Set[int]
  var blocked: Set[int]
  var skipped: Set[int]
  var current: int
  var attempts: int -> int
  var freshScan: bool
  var lockHeld: bool
  var result: DispatchResult
  var totalFollowups: int
  var requestedFollowups: int
  var stopReason: StopReason
  var scanEpoch: int
  var manageEpoch: int

  def statusExclusive(issue) =
    any {
      open.contains(issue)
        and not(inFlight.contains(issue))
        and not(closed.contains(issue))
        and not(blocked.contains(issue)),
      not(open.contains(issue))
        and inFlight.contains(issue)
        and not(closed.contains(issue))
        and not(blocked.contains(issue)),
      not(open.contains(issue))
        and not(inFlight.contains(issue))
        and closed.contains(issue)
        and not(blocked.contains(issue)),
      not(open.contains(issue))
        and not(inFlight.contains(issue))
        and not(closed.contains(issue))
        and blocked.contains(issue),
    }

  action init = all {
    phase' = Idle,
    adopted' = INITIAL_IDS,
    open' = INITIAL_IDS,
    inFlight' = Set(),
    closed' = Set(),
    blocked' = Set(),
    skipped' = Set(),
    current' = 0,
    attempts' = Map(1 -> MAX_ATTEMPTS, 2 -> 0, 3 -> 0, 4 -> 0, 5 -> 0, 6 -> 0, 7 -> 0),
    freshScan' = false,
    lockHeld' = true,
    result' = NoResult,
    totalFollowups' = 0,
    requestedFollowups' = 0,
    stopReason' = NoStop,
    scanEpoch' = 0,
    manageEpoch' = 0,
  }

  action scan = all {
    phase == Idle,
    lockHeld,
    phase' = Idle,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = current,
    attempts' = attempts,
    freshScan' = true,
    lockHeld' = lockHeld,
    result' = result,
    totalFollowups' = totalFollowups,
    requestedFollowups' = requestedFollowups,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch + 1,
    manageEpoch' = manageEpoch,
  }

  action startDispatch(seed: int): bool = all {
    phase == Idle,
    lockHeld,
    freshScan,
    adopted.contains(seed),
    open.contains(seed),
    not(skipped.contains(seed)),
    attempts.get(seed) < MAX_ATTEMPTS,
    phase' = Dispatching,
    adopted' = adopted,
    open' = open.exclude(Set(seed)),
    inFlight' = Set(seed),
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = seed,
    attempts' = attempts.put(seed, attempts.get(seed) + 1),
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action dispatchResult(nextResult: DispatchResult): bool = all {
    phase == Dispatching,
    nextResult != NoResult,
    phase' = Reconciling,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = current,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = nextResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = requestedFollowups,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action startManage = all {
    phase == Reconciling,
    result != NoResult,
    phase' = Managing,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = current,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = result,
    totalFollowups' = totalFollowups,
    requestedFollowups' = requestedFollowups,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action manageRetrySameSeed = all {
    phase == Managing,
    any { result == RetryResult, result == EscalatedResult, result == BlockedResult, result == CrashedResult },
    attempts.get(current) < MAX_ATTEMPTS,
    phase' = Dispatching,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(current),
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = current,
    attempts' = attempts.put(current, attempts.get(current) + 1),
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageNonClosedBlockUser = all {
    phase == Managing,
    any { result == RetryResult, result == EscalatedResult, result == BlockedResult, result == CrashedResult },
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed,
    blocked' = blocked.union(Set(current)),
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = BlockedStop,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageClosedRequest0 = all {
    phase == Managing,
    result == ClosedResult,
    phase' = Idle,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageClosedRequest1Add = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups + 1 <= MAX_TOTAL_FOLLOWUPS,
    phase' = Idle,
    adopted' = adopted.union(Set(totalFollowups + 3)),
    open' = open.union(Set(totalFollowups + 3)),
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups + 1,
    requestedFollowups' = 1,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageClosedRequest1CapHit = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups + 1 > MAX_TOTAL_FOLLOWUPS,
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 1,
    stopReason' = FollowupCapStop,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageClosedRequest2Add = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups + 2 <= MAX_TOTAL_FOLLOWUPS,
    phase' = Idle,
    adopted' = adopted.union(Set(totalFollowups + 3, totalFollowups + 4)),
    open' = open.union(Set(totalFollowups + 3, totalFollowups + 4)),
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups + 2,
    requestedFollowups' = 2,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageClosedRequest2CapHit = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups + 2 > MAX_TOTAL_FOLLOWUPS,
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 2,
    stopReason' = FollowupCapStop,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action manageClosedRequest3PerManageCapHit = all {
    phase == Managing,
    result == ClosedResult,
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 3,
    stopReason' = FollowupCapStop,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch + 1,
  }

  action skipAttemptCapped(seed: int): bool = all {
    phase == Idle,
    lockHeld,
    freshScan,
    adopted.contains(seed),
    open.contains(seed),
    not(skipped.contains(seed)),
    attempts.get(seed) >= MAX_ATTEMPTS,
    phase' = Idle,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped.union(Set(seed)),
    current' = 0,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action markExhausted = all {
    phase == Idle,
    lockHeld,
    freshScan,
    scanEpoch > manageEpoch,
    not(open == Set()),
    open.forall(i => skipped.contains(i)),
    phase' = Exhausted,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = NoStop,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action skippedSeedResolved(seed: int): bool = all {
    phase == Idle,
    lockHeld,
    freshScan,
    skipped.contains(seed),
    open.contains(seed),
    phase' = Idle,
    adopted' = adopted,
    open' = open.exclude(Set(seed)),
    inFlight' = Set(),
    closed' = closed.union(Set(seed)),
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = 0,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action markDone = all {
    phase == Idle,
    freshScan,
    scanEpoch > manageEpoch,
    open == Set(),
    inFlight == Set(),
    blocked == Set(),
    phase' = Done,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = 0,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    requestedFollowups' = requestedFollowups,
    stopReason' = NoStop,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action terminalStutter = all {
    any { phase == Done, phase == Exhausted, phase == Stopped },
    phase' = phase,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    skipped' = skipped,
    current' = current,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = result,
    totalFollowups' = totalFollowups,
    requestedFollowups' = requestedFollowups,
    stopReason' = stopReason,
    scanEpoch' = scanEpoch,
    manageEpoch' = manageEpoch,
  }

  action step =
    nondet seed = IDS.oneOf()
    nondet nextResult = oneOf(Set(ClosedResult, RetryResult, EscalatedResult, BlockedResult, CrashedResult))
    any {
      scan,
      startDispatch(seed),
      dispatchResult(nextResult),
      startManage,
      manageRetrySameSeed,
      manageNonClosedBlockUser,
      manageClosedRequest0,
      manageClosedRequest1Add,
      manageClosedRequest1CapHit,
      manageClosedRequest2Add,
      manageClosedRequest2CapHit,
      manageClosedRequest3PerManageCapHit,
      skipAttemptCapped(seed),
      skippedSeedResolved(seed),
      markExhausted,
      markDone,
      terminalStutter,
    }

  val seedPartition =
    adopted.forall(i => statusExclusive(i))

  val adoptedWithinUniverse =
    adopted.forall(i => IDS.contains(i))

  val doneRequiresFreshScanAndNoOpen =
    phase == Done implies all {
      freshScan,
      scanEpoch > manageEpoch,
      open == Set(),
      inFlight == Set(),
      blocked == Set(),
      adopted == closed,
      stopReason == NoStop,
    }

  val oneDispatchAtATime =
    inFlight.size() <= 1

  val manageBeforeNextDispatch =
    all {
      phase == Dispatching implies all { current != 0, inFlight == Set(current), result == NoResult },
      phase == Reconciling implies all { current != 0, inFlight == Set(current), result != NoResult },
      phase == Managing implies all { current != 0, inFlight == Set(current), result != NoResult },
      any { phase == Idle, phase == Done, phase == Exhausted, phase == Stopped } implies all {
        current == 0,
        inFlight == Set(),
        result == NoResult,
      },
    }

  val followupCapsRespected =
    all {
      totalFollowups <= MAX_TOTAL_FOLLOWUPS,
      phase != Stopped implies requestedFollowups <= MAX_FOLLOWUPS_PER_MANAGE,
    }

  val retryCapRespected =
    IDS.forall(i => attempts.get(i) <= MAX_ATTEMPTS)

  val skippedSeedsNeverDone =
    phase == Done implies skipped.forall(i => not(open.contains(i)))

  val exhaustedRequiresFreshScanAndAllOpenSkipped =
    phase == Exhausted implies all {
      freshScan,
      scanEpoch > manageEpoch,
      not(open == Set()),
      open.forall(i => skipped.contains(i)),
      skipped.forall(i => attempts.get(i) >= MAX_ATTEMPTS),
      inFlight == Set(),
      stopReason == NoStop,
    }

  val skippedSeedsAreAttemptCapped =
    skipped.forall(i => attempts.get(i) >= MAX_ATTEMPTS)

  // Reachability probe: intentionally omitted from allInvariants.
  // `quint run --invariant=skipReachabilityProbe` must find a violation.
  val skipReachabilityProbe =
    skipped == Set()

  val stoppedIsLoud =
    phase == Stopped implies stopReason != NoStop

  val stopReasonMatchesPhase =
    any {
      all { phase == Stopped, stopReason != NoStop },
      all { phase != Stopped, stopReason == NoStop },
    }

  val followupCapStopMatchesRequest =
    (phase == Stopped and stopReason == FollowupCapStop) implies all {
      requestedFollowups > 0,
      any {
        requestedFollowups > MAX_FOLLOWUPS_PER_MANAGE,
        totalFollowups + requestedFollowups > MAX_TOTAL_FOLLOWUPS,
      },
    }

  val allInvariants =
    all {
      seedPartition,
      adoptedWithinUniverse,
      doneRequiresFreshScanAndNoOpen,
      oneDispatchAtATime,
      manageBeforeNextDispatch,
      followupCapsRespected,
      retryCapRespected,
      skippedSeedsNeverDone,
      exhaustedRequiresFreshScanAndAllOpenSkipped,
      skippedSeedsAreAttemptCapped,
      stoppedIsLoud,
      stopReasonMatchesPhase,
      followupCapStopMatchesRequest,
    }
}
