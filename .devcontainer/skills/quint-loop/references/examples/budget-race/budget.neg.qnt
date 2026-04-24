// SPEC: budget-race (role: negative-control)
// SHADOWS: src/<your-module> :: <symbol>           // replace when adapting
// INVARIANTS: budgetInvariant
// REPLAY: tests/specs/budget-race.replay.test.<ts|py>
// LAST-SYNCED: <sha> <date>                         // bump when adapting
//
// TEACHING EXAMPLE — deliberately buggy. Models the pre-fix shape where the
// gate check and the mutation are separated by an await, with no
// reservation. Proves `budgetInvariant` has teeth by producing a short
// counter-example: every actor passes the gate while `fetched` is still 0,
// then each one increments in turn — final `fetched > BUDGET`.
//
// Do not delete; do not "fix". Extend in place if a new class of race
// appears (e.g., a second shared counter) rather than creating a .v2 file.
//
// Generic buggy pseudocode the neg paraphrases:
//   if (state.fetched >= state.budget) return error
//   ... await doWork()       // gate + mutation split by await
//   state.fetched++

module budgetRace {
  pure val BUDGET = 1
  pure val ACTORS = Set("a", "b", "c")

  var fetched: int
  var checked: Set[str]    // actors that passed the gate, work in flight
  var completed: Set[str]  // actors that incremented after work returned

  action init = all {
    fetched' = 0,
    checked' = Set(),
    completed' = Set(),
  }

  // The buggy semantics: check reads `fetched`, passes, but does NOT
  // reserve the slot. The reservation only happens at `complete`.
  action checkGate(i: str): bool = all {
    not(checked.contains(i)),
    fetched < BUDGET,
    checked' = checked.union(Set(i)),
    fetched' = fetched,
    completed' = completed,
  }

  action completeFetch(i: str): bool = all {
    checked.contains(i),
    not(completed.contains(i)),
    fetched' = fetched + 1,
    checked' = checked,
    completed' = completed.union(Set(i)),
  }

  action step = {
    nondet i = ACTORS.oneOf()
    any {
      checkGate(i),
      completeFetch(i),
    }
  }

  // The safety property we want: fetches never exceed budget.
  val budgetInvariant = fetched <= BUDGET
}
