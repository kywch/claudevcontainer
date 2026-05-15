// SPEC: seedstack-run-loop (role: negative-control)
// SHADOWS: skills/seedstack/scripts/seedstack-loop.ts :: outer supervisor
// INVARIANTS: doneRequiresFreshScanAndNoOpen
// REPLAY: none (process model only)
// NEG-CONTROL: none
//
// Negative control: markDone ignores scan freshness, remaining open seeds,
// and post-manage follow-ups. Expected: doneRequiresFreshScanAndNoOpen is
// violated.

module run_loop {
  type Phase = | Idle | Dispatching | Reconciling | Managing | Done | Stopped
  type DispatchResult = | NoResult | ClosedResult | BlockedResult | CrashedResult

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
  var current: int
  var attempts: int -> int
  var freshScan: bool
  var lockHeld: bool
  var result: DispatchResult
  var totalFollowups: int
  var lastManageAdds: int
  var stopLoud: bool

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
    current' = 0,
    attempts' = Map(1 -> 0, 2 -> 0, 3 -> 0, 4 -> 0, 5 -> 0, 6 -> 0, 7 -> 0),
    freshScan' = false,
    lockHeld' = true,
    result' = NoResult,
    totalFollowups' = 0,
    lastManageAdds' = 0,
    stopLoud' = false,
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
    current' = current,
    attempts' = attempts,
    freshScan' = true,
    lockHeld' = lockHeld,
    result' = result,
    totalFollowups' = totalFollowups,
    lastManageAdds' = lastManageAdds,
    stopLoud' = stopLoud,
  }

  action startDispatch(seed: int): bool = all {
    phase == Idle,
    lockHeld,
    freshScan,
    adopted.contains(seed),
    open.contains(seed),
    attempts.get(seed) < MAX_ATTEMPTS,
    phase' = Dispatching,
    adopted' = adopted,
    open' = open.exclude(Set(seed)),
    inFlight' = Set(seed),
    closed' = closed,
    blocked' = blocked,
    current' = seed,
    attempts' = attempts.put(seed, attempts.get(seed) + 1),
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = 0,
    stopLoud' = stopLoud,
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
    current' = current,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = nextResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = lastManageAdds,
    stopLoud' = stopLoud,
  }

  action startManage = all {
    phase == Reconciling,
    result == ClosedResult,
    phase' = Managing,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    current' = current,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = result,
    totalFollowups' = totalFollowups,
    lastManageAdds' = lastManageAdds,
    stopLoud' = stopLoud,
  }

  action dispatchNonClosedStop = all {
    phase == Reconciling,
    any { result == BlockedResult, result == CrashedResult },
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed,
    blocked' = blocked.union(Set(current)),
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = 0,
    stopLoud' = true,
  }

  action manageClosedAdd0 = all {
    phase == Managing,
    result == ClosedResult,
    phase' = Idle,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = 0,
    stopLoud' = stopLoud,
  }

  action manageClosedAdd1 = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups + 1 <= MAX_TOTAL_FOLLOWUPS,
    phase' = Idle,
    adopted' = adopted.union(Set(totalFollowups + 3)),
    open' = open.union(Set(totalFollowups + 3)),
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups + 1,
    lastManageAdds' = 1,
    stopLoud' = stopLoud,
  }

  action manageClosedAdd2 = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups + 2 <= MAX_TOTAL_FOLLOWUPS,
    phase' = Idle,
    adopted' = adopted.union(Set(totalFollowups + 3, totalFollowups + 4)),
    open' = open.union(Set(totalFollowups + 3, totalFollowups + 4)),
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups + 2,
    lastManageAdds' = 2,
    stopLoud' = stopLoud,
  }

  action manageFollowupCapHit = all {
    phase == Managing,
    result == ClosedResult,
    totalFollowups == MAX_TOTAL_FOLLOWUPS,
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = 0,
    stopLoud' = true,
  }

  action managePerManageCapHit = all {
    phase == Managing,
    result == ClosedResult,
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed.union(Set(current)),
    blocked' = blocked,
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = 3,
    stopLoud' = true,
  }

  action manageStop = all {
    phase == Managing,
    result == BlockedResult,
    phase' = Stopped,
    adopted' = adopted,
    open' = open,
    inFlight' = Set(),
    closed' = closed,
    blocked' = blocked.union(Set(current)),
    current' = 0,
    attempts' = attempts,
    freshScan' = false,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = 0,
    stopLoud' = true,
  }

  // BUG: allows final done without fresh scan and while adopted seeds remain open.
  action markDone = all {
    phase == Idle,
    phase' = Done,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    current' = 0,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = NoResult,
    totalFollowups' = totalFollowups,
    lastManageAdds' = lastManageAdds,
    stopLoud' = stopLoud,
  }

  action terminalStutter = all {
    any { phase == Done, phase == Stopped },
    phase' = phase,
    adopted' = adopted,
    open' = open,
    inFlight' = inFlight,
    closed' = closed,
    blocked' = blocked,
    current' = current,
    attempts' = attempts,
    freshScan' = freshScan,
    lockHeld' = lockHeld,
    result' = result,
    totalFollowups' = totalFollowups,
    lastManageAdds' = lastManageAdds,
    stopLoud' = stopLoud,
  }

  action step =
    nondet seed = IDS.oneOf()
    nondet nextResult = oneOf(Set(ClosedResult, BlockedResult, CrashedResult))
    any {
      scan,
      startDispatch(seed),
      dispatchResult(nextResult),
      startManage,
      dispatchNonClosedStop,
      manageClosedAdd0,
      manageClosedAdd1,
      manageClosedAdd2,
      manageFollowupCapHit,
      managePerManageCapHit,
      manageStop,
      markDone,
      terminalStutter,
    }

  val seedPartition =
    adopted.forall(i => statusExclusive(i))

  val doneRequiresFreshScanAndNoOpen =
    phase == Done implies all {
      freshScan,
      open == Set(),
      inFlight == Set(),
      blocked == Set(),
      adopted == closed,
    }

  val followupCapsRespected =
    all {
      totalFollowups <= MAX_TOTAL_FOLLOWUPS,
      lastManageAdds <= MAX_FOLLOWUPS_PER_MANAGE,
    }

  val allInvariants =
    all {
      seedPartition,
      doneRequiresFreshScanAndNoOpen,
      followupCapsRespected,
    }
}
