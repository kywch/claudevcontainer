// SPEC: dispatch-work-state (role: negative-control)
// SHADOWS: dispatch_state.qnt :: noQueueMutation
// EXPECTED: `quint run ... --invariant=noQueueMutation` violates.

module dispatch_state_queue_mutation_neg {
  var queueMutated: bool

  action init = all {
    queueMutated' = false,
  }

  action mutateQueue = all {
    not(queueMutated),
    queueMutated' = true,
  }

  action step = mutateQueue

  val noQueueMutation = not(queueMutated)
}
