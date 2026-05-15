// SPEC: dispatch-work-state (role: negative-control)
// SHADOWS: dispatch_state.qnt :: executePassRequiresReview
// EXPECTED: `quint run ... --invariant=executePassRequiresReview` violates.

module dispatch_state_execute_review_neg {
  var implementDone: bool
  var reviewDone: bool
  var reviewPass: bool
  var executePass: bool

  action init = all {
    implementDone' = false,
    reviewDone' = false,
    reviewPass' = false,
    executePass' = false,
  }

  action executePassWithoutReview = all {
    not(executePass),
    implementDone' = true,
    reviewDone' = false,
    reviewPass' = false,
    executePass' = true,
  }

  action step = executePassWithoutReview

  val executePassRequiresReview = executePass implies all {
    implementDone,
    reviewDone,
    reviewPass,
  }
}
