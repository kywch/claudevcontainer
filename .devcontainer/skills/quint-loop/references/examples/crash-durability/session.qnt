// SPEC: crash-durability (role: canonical)
// SHADOWS: src/<your-module> :: <saveSymbol>       // replace when adapting
// INVARIANTS: committedSurvives
// REPLAY: tests/specs/crash-durability.replay.test.<ts|py>
// NEG-CONTROL: specs/crash-durability.neg.qnt
// LAST-SYNCED: <sha> <date>                         // bump when adapting
// REVIEW: invariant-completeness PASS
//
// TEACHING EXAMPLE — atomic tmp+rename persistence. Models a writer that
// stages data in a sibling tmp file, then renames the tmp onto the
// canonical path. On POSIX, rename is atomic: a crash at any point leaves
// disk in exactly one of two valid states — the prior committed payload
// (if rename never landed) or the new committed payload (if it did).
//
// `beginSave` stages to tmp WITHOUT mutating disk; `finishSave` is the
// rename and is modeled as atomic. A `crash` can fire between them and the
// prior disk state is preserved.
//
// Drift that reaches the neg:
//   - `beginSave` mutates disk in place (truncate-then-write)
//   - `finishSave` modeled as two steps (write-then-fsync) when the real
//     primitive is a single rename
//   - `crash` action allowed to split an action the canonical treats as atomic

module crashDurability {
  pure val VERSIONS = 1.to(3)

  var memVersion: int         // highest version the writer has produced
  var diskVersion: int        // what `load()` would return (0 = empty)
  var tmpInProgress: bool     // a tmp file is being written but not yet renamed
  var committedOnce: bool     // ghost: a fully-valid save has completed at least once

  action init = all {
    memVersion' = 0,
    diskVersion' = 0,
    tmpInProgress' = false,
    committedOnce' = false,
  }

  // Writer produces a new version in memory. No I/O.
  action writeNew: bool = all {
    memVersion < 3,
    memVersion' = memVersion + 1,
    diskVersion' = diskVersion,
    tmpInProgress' = tmpInProgress,
    committedOnce' = committedOnce,
  }

  // Stage new payload to a tmp file. Does NOT touch the canonical path, so
  // a crash here leaves disk at its prior state.
  action beginSave: bool = all {
    memVersion > 0,
    not(tmpInProgress),
    tmpInProgress' = true,
    memVersion' = memVersion,
    diskVersion' = diskVersion,
    committedOnce' = committedOnce,
  }

  // Atomic rename. Disk transitions directly from prior to new version;
  // no intermediate torn state is observable.
  action finishSave: bool = all {
    tmpInProgress,
    diskVersion' = memVersion,
    committedOnce' = true,
    tmpInProgress' = false,
    memVersion' = memVersion,
  }

  // Crash during an in-progress write. The tmp file is abandoned; the
  // canonical path is untouched. After crash, `load()` still returns the
  // prior committed version.
  action crash: bool = all {
    tmpInProgress,
    tmpInProgress' = false,
    diskVersion' = diskVersion,
    memVersion' = memVersion,
    committedOnce' = committedOnce,
  }

  action step = any {
    writeNew,
    beginSave,
    finishSave,
    crash,
  }

  // Observable bad state: we committed at least once, but load returns empty.
  val committedSurvives = committedOnce implies diskVersion > 0
}
