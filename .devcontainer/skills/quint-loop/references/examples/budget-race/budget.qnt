// SPEC: budget-race (role: canonical)
// SHADOWS: src/<your-module> :: <symbol>           // replace when adapting
// INVARIANTS: budgetInvariant, reservationInvariant
// REPLAY: tests/specs/budget-race.replay.test.<ts|py>
// NEG-CONTROL: specs/budget-race.neg.qnt
// LAST-SYNCED: <sha> <date>                         // bump when adapting
// REVIEW: invariant-completeness PASS
//
// TEACHING EXAMPLE — concurrent-reservation pattern for a per-operation
// counter with a fixed budget. Models the correct reserve-at-gate discipline:
// the gate check and the `inFlight` increment are in the same synchronous
// block, so no concurrent caller can pass the gate between them.
//
// Drift that reaches the neg:
//   - an await between the gate check and the inFlight increment
//   - a rollback path that forgets to decrement inFlight
//   - the gate checking only `fetched` instead of `fetched + inFlight`
//
// Adapt: replace SHADOWS with your symbol, prune the invariants you don't
// need, and update actors / budget to match the bug you're chasing.

module budgetRace {
  pure val BUDGET = 2
  pure val ACTORS = Set("a", "b", "c")

  var fetched: int
  var inFlight: Set[str]
  var completed: Set[str]

  action init = all {
    fetched' = 0,
    inFlight' = Set(),
    completed' = Set(),
  }

  // Reserve the slot at the gate: check + increment in one atomic step.
  // Every concurrent caller sees `fetched + inFlight` include our slot.
  action reserve(i: str): bool = all {
    not(inFlight.contains(i)),
    not(completed.contains(i)),
    fetched + inFlight.size() < BUDGET,
    inFlight' = inFlight.union(Set(i)),
    fetched' = fetched,
    completed' = completed,
  }

  // Fetch succeeds; promote reservation into a completed fetch.
  action succeed(i: str): bool = all {
    inFlight.contains(i),
    fetched' = fetched + 1,
    inFlight' = inFlight.exclude(Set(i)),
    completed' = completed.union(Set(i)),
  }

  // Fetch fails; release the reservation without incrementing `fetched`.
  // Without this, a failed fetch consumes budget permanently.
  action rollback(i: str): bool = all {
    inFlight.contains(i),
    fetched' = fetched,
    inFlight' = inFlight.exclude(Set(i)),
    completed' = completed,
  }

  action step = {
    nondet i = ACTORS.oneOf()
    any {
      reserve(i),
      succeed(i),
      rollback(i),
    }
  }

  // Observable bad state: completed fetches exceed budget.
  val budgetInvariant = fetched <= BUDGET

  // Stronger property: reservations in flight also count against budget,
  // so no gate-pass can be promised beyond the budget.
  val reservationInvariant = fetched + inFlight.size() <= BUDGET
}
