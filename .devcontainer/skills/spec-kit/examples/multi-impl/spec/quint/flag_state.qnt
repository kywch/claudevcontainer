// SPEC: flag-store-0.1 (role: example)
// SHADOWS: spec/behavior.md :: B1 Flag Record
// INVARIANTS: knownFlagsHaveValues
// TRACE: create(beta, false); setFlag(beta, true)
// LAST-SYNCED: flag-store-0.1-draft 2026-05-14
//
// Abstract model for flag existence and enabled/disabled state. It excludes
// JSON field preservation, schemas, API envelopes, file IO, and implementation
// layout.

module flag_state {
  pure val KEYS = Set("beta", "search")

  var known: Set[str]
  var enabledKeys: Set[str]

  action init = all {
    known' = Set(),
    enabledKeys' = Set(),
  }

  action create(key: str, value: bool): bool = all {
    KEYS.contains(key),
    not(known.contains(key)),
    known' = known.union(Set(key)),
    enabledKeys' = if (value) enabledKeys.union(Set(key)) else enabledKeys,
  }

  action setFlag(key: str, value: bool): bool = all {
    known.contains(key),
    known' = known,
    enabledKeys' = if (value) enabledKeys.union(Set(key)) else enabledKeys.exclude(Set(key)),
  }

  val knownFlagsHaveValues =
    enabledKeys.forall(key => known.contains(key))
}
