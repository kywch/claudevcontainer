// SPEC: crash-durability (role: negative-control)
// SHADOWS: src/<your-module> :: <saveSymbol>       // replace when adapting
// INVARIANTS: committedSurvives
// REPLAY: tests/specs/crash-durability.replay.test.<ts|py>
// LAST-SYNCED: <sha> <date>                         // bump when adapting
//
// TEACHING EXAMPLE — deliberately buggy. Models in-place truncate-then-write
// persistence: `beginSave` truncates the canonical file to empty, then
// `finishSave` writes the new payload. A crash between these two leaves
// disk empty even though a prior save had committed — observable data loss.
//
// Generic buggy pseudocode the neg paraphrases:
//   open(path, O_TRUNC)       // disk now empty
//   ... write(newData)         // can fail / crash before this completes
//   close(path)
//
// Do not delete; do not "fix". This proves `committedSurvives` has teeth.

module crashDurability {
  pure val VERSIONS = 1.to(3)

  var memVersion: int
  var diskVersion: int
  var writeInProgress: bool
  var committedOnce: bool

  action init = all {
    memVersion' = 0,
    diskVersion' = 0,
    writeInProgress' = false,
    committedOnce' = false,
  }

  action writeNew: bool = all {
    memVersion < 3,
    memVersion' = memVersion + 1,
    diskVersion' = diskVersion,
    writeInProgress' = writeInProgress,
    committedOnce' = committedOnce,
  }

  // Buggy: truncates disk in place. Any prior committed payload is gone.
  action beginSave: bool = all {
    memVersion > 0,
    not(writeInProgress),
    writeInProgress' = true,
    diskVersion' = 0,                // <-- the bug: in-place truncate
    memVersion' = memVersion,
    committedOnce' = committedOnce,
  }

  // Write completes; disk holds the new version.
  action finishSave: bool = all {
    writeInProgress,
    diskVersion' = memVersion,
    committedOnce' = true,
    writeInProgress' = false,
    memVersion' = memVersion,
  }

  // Crash before finishSave: disk is stuck at the truncated state.
  action crash: bool = all {
    writeInProgress,
    writeInProgress' = false,
    diskVersion' = diskVersion,      // disk remains whatever beginSave left it
    memVersion' = memVersion,
    committedOnce' = committedOnce,
  }

  action step = any {
    writeNew,
    beginSave,
    finishSave,
    crash,
  }

  val committedSurvives = committedOnce implies diskVersion > 0
}
