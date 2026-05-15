// NEGATIVE CONTROL: removes the main review loop (ReviewLoop goes straight
// to PresentPlan, skipping review-fix-verify entirely). Tests that the main
// review loop is independently load-bearing for noCreationWithoutReview.
// Expected: noCreationWithoutReview should be violated.

module plan_flow {

  type Phase =
    | MiniAlignment
    | Research
    | DraftPlan
    | AssumptionCheck
    | ReviewLoop
    | FixFindings
    | Verify
    | PresentPlan
    | UserReacts
    | DiffReview
    | DiffFix
    | DiffVerify
    | PreCreationMechanical
    | PreCreationReviewLoop
    | PreCreationFix
    | PreCreationVerify
    | PreCreationUserGate
    | CreateSeeds
    | Done

  type PlanSize = | Project | Program

  var phase: Phase
  var planSize: PlanSize
  var dirtyBit: bool
  var reviewPassCount: int
  var fixAttemptCount: int
  var adjustmentCount: int
  var adjustmentCap: int
  var fullReviewSinceLastMutation: bool
  var creationRequested: bool
  var justGo: bool

  pure val REVIEW_PASS_CAP = 3
  pure val FIX_ATTEMPT_CAP = 2

  // Helper: immutable config (never changes after init)
  action keep_config = all {
    planSize' = planSize,
    adjustmentCap' = adjustmentCap,
    creationRequested' = creationRequested,
    justGo' = justGo,
  }

  action init =
    nondet sz = oneOf(Set(Project, Program))
    nondet cr = oneOf(Set(true, false))
    nondet jg = oneOf(Set(true, false))
    all {
      phase' = MiniAlignment,
      planSize' = sz,
      dirtyBit' = false,
      reviewPassCount' = 0,
      fixAttemptCount' = 0,
      adjustmentCount' = 0,
      adjustmentCap' = if (sz == Project) 1 else 2,
      fullReviewSinceLastMutation' = false,
      creationRequested' = cr,
      justGo' = jg,
    }

  // --- Simple transitions ---

  action stepMiniAlignment = all {
    phase == MiniAlignment,
    phase' = Research,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepResearch = all {
    phase == Research,
    phase' = DraftPlan,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDraftPlan = all {
    phase == DraftPlan,
    phase' = if (justGo) ReviewLoop else AssumptionCheck,
    dirtyBit' = true,
    fullReviewSinceLastMutation' = false,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = 0,  // reset on new draft
    keep_config,
  }

  // --- Assumption check ---

  action stepAssumptionCheckAccept = all {
    phase == AssumptionCheck,
    phase' = ReviewLoop,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepAssumptionCheckReject = all {
    phase == AssumptionCheck,
    // structural feedback or explicit rejection -> new research
    phase' = Research,
    dirtyBit' = true,
    fullReviewSinceLastMutation' = false,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // --- Review-Fix-Verify loop ---
  // NEG: all review loop actions skip straight to PresentPlan
  // without setting fullReviewSinceLastMutation or clearing dirtyBit

  action stepReviewLoopFindings = all {
    phase == ReviewLoop,
    phase' = PresentPlan,  // NEG: skip review entirely
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,  // NOT set
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // NEG: disabled — never fires (replaced by above)
  action stepReviewLoopClean = all {
    phase == ReviewLoop,
    false,  // NEG: disabled
    phase' = PresentPlan,
    dirtyBit' = false,
    fullReviewSinceLastMutation' = true,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // NEG: disabled
  action stepReviewLoopCapHit = all {
    phase == ReviewLoop,
    false,  // NEG: disabled
    phase' = PresentPlan,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = true,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepFixFindings = all {
    phase == FixFindings,
    phase' = Verify,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount + 1,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepVerifyClean = all {
    phase == Verify,
    phase' = PresentPlan,
    dirtyBit' = false,
    fullReviewSinceLastMutation' = true,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepVerifyBrokenSubCap = all {
    phase == Verify,
    fixAttemptCount >= FIX_ATTEMPT_CAP,
    phase' = ReviewLoop,  // next pass
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepVerifyBrokenRetry = all {
    phase == Verify,
    fixAttemptCount < FIX_ATTEMPT_CAP,
    phase' = FixFindings,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // --- Present plan ---

  action stepPresentPlanJustGoCreate = all {
    phase == PresentPlan,
    justGo,
    creationRequested,
    phase' = if (dirtyBit) PreCreationMechanical else CreateSeeds,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPresentPlanJustGoNoCreate = all {
    phase == PresentPlan,
    justGo,
    not(creationRequested),
    phase' = Done,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPresentPlanInteractive = all {
    phase == PresentPlan,
    not(justGo),
    phase' = UserReacts,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // --- User reacts ---

  action stepUserAcceptClean = all {
    phase == UserReacts,
    not(dirtyBit),
    fullReviewSinceLastMutation,
    phase' = if (creationRequested) CreateSeeds else Done,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepUserAcceptDirty = all {
    phase == UserReacts,
    dirtyBit or not(fullReviewSinceLastMutation),
    phase' = if (creationRequested) PreCreationMechanical else Done,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepUserAdjust = all {
    phase == UserReacts,
    adjustmentCount < adjustmentCap,
    phase' = DiffReview,
    dirtyBit' = true,
    fullReviewSinceLastMutation' = false,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount + 1,
    keep_config,
  }

  action stepUserReject = all {
    phase == UserReacts,
    phase' = Research,
    dirtyBit' = true,
    fullReviewSinceLastMutation' = false,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = 0,  // reset on rejection
    keep_config,
  }

  // --- Diff review ---

  action stepDiffReviewNarrowClean = all {
    phase == DiffReview,
    phase' = PresentPlan,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDiffReviewNarrowFindings = all {
    phase == DiffReview,
    phase' = DiffFix,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDiffReviewEscalate = all {
    phase == DiffReview,
    // broad damage -> full review loop
    phase' = ReviewLoop,
    dirtyBit' = true,
    fullReviewSinceLastMutation' = false,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDiffFix = all {
    phase == DiffFix,
    phase' = DiffVerify,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount + 1,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDiffVerifyClean = all {
    phase == DiffVerify,
    // diff does NOT clear dirty bit
    phase' = PresentPlan,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDiffVerifyBrokenSubCap = all {
    phase == DiffVerify,
    fixAttemptCount >= FIX_ATTEMPT_CAP,
    phase' = PresentPlan,  // residual risk, present anyway
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepDiffVerifyBrokenRetry = all {
    phase == DiffVerify,
    fixAttemptCount < FIX_ATTEMPT_CAP,
    phase' = DiffFix,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // --- Pre-creation gate ---

  action stepPreCreationMechanical = all {
    phase == PreCreationMechanical,
    phase' = PreCreationReviewLoop,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // Pre-creation review finds issues -> fix
  action stepPreCreationReviewLoopFindings = all {
    phase == PreCreationReviewLoop,
    reviewPassCount < REVIEW_PASS_CAP,
    phase' = PreCreationFix,
    reviewPassCount' = reviewPassCount + 1,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // Pre-creation review finds nothing -> clean exit
  action stepPreCreationReviewLoopClean = all {
    phase == PreCreationReviewLoop,
    reviewPassCount < REVIEW_PASS_CAP,
    phase' = PreCreationUserGate,
    dirtyBit' = false,
    fullReviewSinceLastMutation' = true,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // Pre-creation cap hit -> residual risk, dirty bit stays
  action stepPreCreationReviewLoopCapHit = all {
    phase == PreCreationReviewLoop,
    reviewPassCount >= REVIEW_PASS_CAP,
    phase' = PreCreationUserGate,
    dirtyBit' = dirtyBit,  // NOT cleared — findings unfixed
    fullReviewSinceLastMutation' = true,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPreCreationFix = all {
    phase == PreCreationFix,
    phase' = PreCreationVerify,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount + 1,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPreCreationVerifyClean = all {
    phase == PreCreationVerify,
    phase' = PreCreationUserGate,
    dirtyBit' = false,
    fullReviewSinceLastMutation' = true,
    reviewPassCount' = 0,
    fixAttemptCount' = 0,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPreCreationVerifyBrokenSubCap = all {
    phase == PreCreationVerify,
    fixAttemptCount >= FIX_ATTEMPT_CAP,
    phase' = PreCreationReviewLoop,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = 0,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPreCreationVerifyBrokenRetry = all {
    phase == PreCreationVerify,
    fixAttemptCount < FIX_ATTEMPT_CAP,
    phase' = PreCreationFix,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepPreCreationAccept = all {
    phase == PreCreationUserGate,
    phase' = CreateSeeds,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // Pre-creation reject available regardless of justGo
  action stepPreCreationReject = all {
    phase == PreCreationUserGate,
    phase' = UserReacts,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  action stepCreateSeeds = all {
    phase == CreateSeeds,
    phase' = Done,
    dirtyBit' = dirtyBit,
    fullReviewSinceLastMutation' = fullReviewSinceLastMutation,
    reviewPassCount' = reviewPassCount,
    fixAttemptCount' = fixAttemptCount,
    adjustmentCount' = adjustmentCount,
    keep_config,
  }

  // --- Step ---

  action step = any {
    stepMiniAlignment,
    stepResearch,
    stepDraftPlan,
    stepAssumptionCheckAccept,
    stepAssumptionCheckReject,
    stepReviewLoopFindings,
    stepReviewLoopClean,
    stepReviewLoopCapHit,
    stepFixFindings,
    stepVerifyClean,
    stepVerifyBrokenSubCap,
    stepVerifyBrokenRetry,
    stepPresentPlanJustGoCreate,
    stepPresentPlanJustGoNoCreate,
    stepPresentPlanInteractive,
    stepUserAcceptClean,
    stepUserAcceptDirty,
    stepUserAdjust,
    stepUserReject,
    stepDiffReviewNarrowClean,
    stepDiffReviewNarrowFindings,
    stepDiffReviewEscalate,
    stepDiffFix,
    stepDiffVerifyClean,
    stepDiffVerifyBrokenSubCap,
    stepDiffVerifyBrokenRetry,
    stepPreCreationMechanical,
    stepPreCreationReviewLoopFindings,
    stepPreCreationReviewLoopClean,
    stepPreCreationReviewLoopCapHit,
    stepPreCreationFix,
    stepPreCreationVerifyClean,
    stepPreCreationVerifyBrokenSubCap,
    stepPreCreationVerifyBrokenRetry,
    stepPreCreationAccept,
    stepPreCreationReject,
    stepCreateSeeds,
  }

  // --- Invariants ---

  // No creation without full review after last mutation
  val noCreationWithoutReview =
    phase == CreateSeeds implies fullReviewSinceLastMutation

  // Review pass cap never exceeded
  val reviewPassCapRespected =
    reviewPassCount <= REVIEW_PASS_CAP

  // Fix attempt cap never exceeded
  val fixAttemptCapRespected =
    fixAttemptCount <= FIX_ATTEMPT_CAP

  // Adjustment cap never exceeded
  val adjustmentCapRespected =
    adjustmentCount <= adjustmentCap

  // Creation with residual risk is allowed (cap hit, findings unfixed).
  // The real safety property is noCreationWithoutReview.
  // This weaker invariant: if dirty at creation, review must have run.
  val creationDirtyOnlyWithReview =
    (phase == CreateSeeds and dirtyBit) implies fullReviewSinceLastMutation

  // "just go" still reviewed before creation
  val justGoStillReviewed =
    (justGo and phase == CreateSeeds) implies fullReviewSinceLastMutation

  val allInvariants = and {
    noCreationWithoutReview,
    reviewPassCapRespected,
    fixAttemptCapRespected,
    adjustmentCapRespected,
    creationDirtyOnlyWithReview,
    justGoStillReviewed,
  }
}
