// ============================================================
// relevance — only FUNCTIONAL exercises for the trainee's sport and limitation (Stage 3.1)
//
// The owner's rule: no generic "filler" exercises. A rehab + amputee-football session is
// functional for that sport and that limitation — advanced balance, core, the upper-body work
// the crutches demand, the kick — never an isolated shoulder raise "pointing at the wall".
//
//   SPORT_PATTERNS   per sport: the movement patterns that are functional for it
//   relevantPatterns({ track, sport, lp }) → Set of pattern ids allowed for this trainee
//     sport tracks       → the sport's functional patterns
//     rehab + sport      → the sport's functional patterns (the rehab safety filter applies later)
//     rehab only         → every generic pattern, minus isolated arm work when the arms are
//                          healthy and the limitation is in the legs (and vice versa: arm rehab
//                          is kept when an arm is limited)
// ============================================================

const MOBILITY = ['armCircles', 'trunkRotation', 'kneeLiftMarch'];
const LOWER_STRENGTH = ['squat', 'miniSquat', 'lunge', 'wallSit', 'hipHinge', 'gluteBridge'];
const SPEED = ['runInPlace', 'highKnees', 'buttKicks', 'aSkip', 'accelMarch'];
const ARM_ISOLATION = ['lateralRaise', 'frontRaise', 'rehabFrontRaise', 'bicepCurl', 'rehabElbowFlex'];

export const SPORT_PATTERNS = Object.freeze({
  football: [...MOBILITY, ...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'pushUp', 'shadowKick'],
  // Crutch football (leg amputees): balance on the remaining leg, core, crutch upper body, the kick
  footballAmputee: [...MOBILITY, 'kneeUpBalance', 'plank', 'gluteBridge', 'miniSquat', 'hipHinge', 'lunge', 'pushUp', 'shoulderPress', 'shadowKick'],
  // Amputee goalkeeper (arm amputees): low stance, lateral power, reactions, core
  footballAmputeeGK: [...MOBILITY, ...LOWER_STRENGTH, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'shoulderPress', 'highKnees', 'accelMarch'],
  basketball: [...MOBILITY, ...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'pushUp', 'shoulderPress', 'shadowChestPass'],
  tennis: [...MOBILITY, ...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'lateralShuffle', 'kneeUpBalance', 'plank', 'lateralRaise', 'shadowStroke'],
  // Wheelchair sports: shoulders (protect them), pushing strength, trunk control, the sport motion
  basketballWheelchair: ['armCircles', 'trunkRotation', 'shoulderPress', 'lateralRaise', 'frontRaise', 'bicepCurl', 'shadowChestPass'],
  tennisWheelchair: ['armCircles', 'trunkRotation', 'shoulderPress', 'lateralRaise', 'frontRaise', 'bicepCurl', 'shadowStroke'],
  running: [...MOBILITY, ...LOWER_STRENGTH, ...SPEED, 'jumpSquat', 'kneeUpBalance', 'plank'],
  fitness: null,     // all generic patterns
});

const legAffected = (lp) => ['left_leg', 'right_leg'].some(k => ['prosthetic', 'absent'].includes(lp?.[k]?.state));
const armLimited = (lp) => ['left_arm', 'right_arm'].some(k => ['limited', 'absent', 'prosthetic', 'no_movement'].includes(lp?.[k]?.state) || typeof lp?.[k]?.romCapDeg === 'number');

/**
 * @param {{ track: string, sport: string|null, lp?: Object }} p
 * @returns {Set<string>|null} allowed pattern ids (null = no restriction)
 */
export function relevantPatterns({ track, sport, lp = {} }) {
  if (track !== 'rehab_only') {
    const list = SPORT_PATTERNS[sport];
    return list ? new Set(list) : null;
  }
  // rehab only: functional for the limitation — no isolated arm work for a leg limitation with healthy arms
  if (legAffected(lp) && !armLimited(lp)) return new Set(['squat', 'miniSquat', 'lunge', 'wallSit', 'hipHinge', 'gluteBridge', 'pushUp', 'plank', 'kneeUpBalance', ...MOBILITY]);
  return null;
}

export { ARM_ISOLATION };
