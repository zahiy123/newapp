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
});
