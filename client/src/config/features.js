// ============================================================
// Feature flags — switch a feature OFF completely with one line
// (a safe rollback without reverting code). Owner rule: new risky
// features ship behind a flag, on a feature branch, and fall back
// automatically to the last stable behaviour on any runtime error.
// ============================================================

export const FEATURES = Object.freeze({
  // Full-size transparent Ghost overlay aligned to the trainee's body + progressive range
  // challenge in the warm-up. Off → only the stable Ghost demo panel (checkpoint-stage2-stable).
  GHOST_OVERLAY: true,
  // Stage 3.1 — Expert Execution Profile per exercise: required limbs in the frame before anything
  // counts, kinematic error / danger rules, execution accuracy and a Ghost generated from the same
  // profile. Off → the exercise phase runs exactly as at checkpoint-stage2-final.
  EXPERT_PROFILE: true,
  // Stage 3.1 — exercise catalog (movement pattern × variation, every exercise with a Ghost) and
  // coherent goal-based sessions: the AI decides the week's structure / day focus, each day is
  // filled from the catalog. Off → the AI exercises as before (equipment-fitted).
  CATALOG_PLANS: true,
});
