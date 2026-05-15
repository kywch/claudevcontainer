// SPEC: dispatch-work-state (role: negative-control)
// SHADOWS: skills/dispatch-work/SKILL.md :: Dispatcher done gate
// INVARIANTS: noDoneBeforeVerifiedPass
// REPLAY: none (skill/process model only)
// LAST-SYNCED: dispatch-work skill 2026-05-15
//
// Negative control: Dispatcher reports local done after Execute says pass,
// without running independent Verify.

module dispatch_state_neg {
  var researchDone: bool
  var packet: bool
  var executeReport: bool
  var executePass: bool
  var verifyDone: bool
  var verifyPass: bool
  var done: bool

  action init = all {
    researchDone' = false,
    packet' = false,
    executeReport' = false,
    executePass' = false,
    verifyDone' = false,
    verifyPass' = false,
    done' = false,
  }

  action finishResearch: bool = all {
    not(researchDone),
    researchDone' = true,
    packet' = packet,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    done' = done,
  }

  action writePacket: bool = all {
    researchDone,
    not(packet),
    researchDone' = researchDone,
    packet' = true,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    done' = done,
  }

  action executePasses: bool = all {
    packet,
    researchDone' = researchDone,
    packet' = packet,
    executeReport' = true,
    executePass' = true,
    verifyDone' = false,
    verifyPass' = false,
    done' = done,
  }

  action doneWithoutVerify: bool = all {
    executeReport,
    executePass,
    not(done),
    researchDone' = researchDone,
    packet' = packet,
    executeReport' = executeReport,
    executePass' = executePass,
    verifyDone' = verifyDone,
    verifyPass' = verifyPass,
    done' = true,
  }

  action step = any {
    finishResearch,
    writePacket,
    executePasses,
    doneWithoutVerify,
  }

  val noDoneBeforeVerifiedPass =
    done implies all {
      packet,
      executeReport,
      executePass,
      verifyDone,
      verifyPass,
    }
}
