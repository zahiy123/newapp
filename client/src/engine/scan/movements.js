// ============================================================
// Scan Movements — Pure Data Definitions
//
// Defines the guided movements for each Phase B track.
// No logic, no imports — just data.
//
// Each movement specifies:
//   - id: unique key for retry tracking
//   - instruction_he/en: what to tell the user
//   - duration_ms: how long to collect data
//   - target_limbs: which limbs this movement analyzes
//   - analysis_type: what the PhaseBAnalyzer should compute
//   - landmarks_of_interest: which MediaPipe landmarks to focus on
// ============================================================

// --- MediaPipe Landmark Indices ---
// Reference for landmarks_of_interest
const LM = Object.freeze({
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT: 31,
  RIGHT_FOOT: 32,
});

export { LM };


// ============================================================
// Track α — Missing Limb Detected
// Goal: map compensation patterns of remaining limbs
// ============================================================

export const TRACK_ALPHA = Object.freeze([
  // ── Upper body ──
  {
    id: 'alpha_arms_raise',
    instruction_he: 'הרם את הידיים לצדדים לאט, והורד אותן בחזרה. חזור על התנועה.',
    instruction_en: 'Slowly raise your arms to the sides and lower them back. Repeat.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
      LM.LEFT_HIP, LM.RIGHT_HIP,
    ],
  },
  {
    id: 'alpha_shoulder_circles',
    instruction_he: 'סובב את שתי הכתפיים בתנועה מעגלית, קדימה ואז אחורה.',
    instruction_en: 'Rotate both shoulders in circles, forward then backward.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
    ],
  },
  {
    id: 'alpha_elbow_flex',
    instruction_he: 'כופף ופשוט את שני המרפקים במלואם, כמו כפיפות מרפק.',
    instruction_en: 'Bend and extend both elbows fully, like bicep curls.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  // ── Lower body ──
  {
    id: 'alpha_weight_shift',
    instruction_he: 'העבר את המשקל מצד לצד, בקצב שנוח לך.',
    instruction_en: 'Shift your weight from side to side at a comfortable pace.',
    duration_ms: 15000,
    target_limbs: ['left_leg', 'right_leg'],
    analysis_type: 'compensation',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    ],
  },
  {
    id: 'alpha_natural_motion',
    instruction_he: 'נע קדימה ואחורה בקצב הנוח לך, כמו הליכה במקום.',
    instruction_en: 'Move forward and back at your own pace, like walking in place.',
    duration_ms: 15000,
    target_limbs: ['left_leg', 'right_leg', 'left_arm', 'right_arm'],
    analysis_type: 'rhythm_baseline',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
]);


// ============================================================
// Track β — Deep Analysis Required
// Goal: differentiate healthy/weak/prosthetic with damping
// ============================================================

export const TRACK_BETA = Object.freeze([
  // ── Lower body ──
  {
    id: 'beta_step_right_left',
    instruction_he: 'צעד צעד אחד קדימה עם הרגל הימנית, ואז צעד קדימה עם השמאלית. חזור.',
    instruction_en: 'Step forward with your right leg, then step forward with your left. Repeat.',
    duration_ms: 12000,
    target_limbs: ['left_leg', 'right_leg'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_HEEL, LM.RIGHT_HEEL,
    ],
  },
  {
    id: 'beta_single_leg_right',
    instruction_he: 'עמוד על הרגל הימנית בלבד. נסה להחזיק 10 שניות.',
    instruction_en: 'Stand on your right leg only. Try to hold for 10 seconds.',
    duration_ms: 10000,
    target_limbs: ['right_leg'],
    analysis_type: 'stability',
    landmarks_of_interest: [
      LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE,
      LM.LEFT_HIP, // track compensation
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, // trunk sway
    ],
  },
  {
    id: 'beta_single_leg_left',
    instruction_he: 'עכשיו עמוד על הרגל השמאלית בלבד. נסה להחזיק 10 שניות.',
    instruction_en: 'Now stand on your left leg only. Try to hold for 10 seconds.',
    duration_ms: 10000,
    target_limbs: ['left_leg'],
    analysis_type: 'stability',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE,
      LM.RIGHT_HIP,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    ],
  },
  {
    id: 'beta_mini_squat',
    instruction_he: 'כופף ברכיים לאט, כמו סקוואט קטן, ותעלה בחזרה. חזור 3 פעמים.',
    instruction_en: 'Slowly bend your knees in a small squat and rise back up. Repeat 3 times.',
    duration_ms: 15000,
    target_limbs: ['left_leg', 'right_leg'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    ],
  },
  // ── Upper body ──
  {
    id: 'beta_shoulder_press',
    instruction_he: 'הרם ידיים מעל הראש ותוריד לאט. חזור 5 פעמים.',
    instruction_en: 'Press arms overhead and lower slowly. Repeat 5 times.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  {
    id: 'beta_elbow_flex',
    instruction_he: 'כופף ופשוט את המרפקים לאט. חזור 5 פעמים.',
    instruction_en: 'Bend and extend your elbows slowly. Repeat 5 times.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  {
    id: 'beta_arm_reach',
    instruction_he: 'הושט יד ימין קדימה ואז יד שמאל. חזור 3 פעמים.',
    instruction_en: 'Reach your right arm forward then your left arm. Repeat 3 times.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'compensation',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
      LM.LEFT_HIP, LM.RIGHT_HIP,
    ],
  },
]);


// ============================================================
// Track γ — Full Body Assessment
// Goal: establish baseline for healthy athlete
// ============================================================

export const TRACK_GAMMA = Object.freeze([
  // ── Lower body ──
  {
    id: 'gamma_walk',
    instruction_he: 'לך קדימה ואחורה בקצב טבעי.',
    instruction_en: 'Walk forward and back at a natural pace.',
    duration_ms: 15000,
    target_limbs: ['left_leg', 'right_leg', 'left_arm', 'right_arm'],
    analysis_type: 'rhythm_baseline',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  {
    id: 'gamma_squat_arms',
    instruction_he: 'בצע סקוואט קל תוך שאתה מרים ידיים מעל הראש. חזור 3 פעמים.',
    instruction_en: 'Do a light squat while raising arms overhead. Repeat 3 times.',
    duration_ms: 15000,
    target_limbs: ['left_leg', 'right_leg', 'left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
    ],
  },
  {
    id: 'gamma_hip_rotation',
    instruction_he: 'סובב את האגן בתנועה מעגלית. 3 סיבובים לכל כיוון.',
    instruction_en: 'Rotate your hips in a circle. 3 rotations each direction.',
    duration_ms: 12000,
    target_limbs: ['left_leg', 'right_leg'],
    analysis_type: 'compensation',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    ],
  },
  {
    id: 'gamma_lateral_shift',
    instruction_he: 'העבר את המשקל מצד לצד, ימינה ושמאלה.',
    instruction_en: 'Shift your weight side to side, right and left.',
    duration_ms: 15000,
    target_limbs: ['left_leg', 'right_leg'],
    analysis_type: 'compensation',
    landmarks_of_interest: [
      LM.LEFT_HIP, LM.RIGHT_HIP,
      LM.LEFT_KNEE, LM.RIGHT_KNEE,
      LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
    ],
  },
  // ── Upper body ──
  {
    id: 'gamma_shoulder_circles',
    instruction_he: 'סובב את שתי הכתפיים בתנועה מעגלית. 5 סיבובים קדימה, 5 אחורה.',
    instruction_en: 'Rotate both shoulders in circles. 5 forward, 5 backward.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
    ],
  },
  {
    id: 'gamma_elbow_flex',
    instruction_he: 'כופף ופשוט את שני המרפקים במלואם. חזור 5 פעמים.',
    instruction_en: 'Fully bend and extend both elbows. Repeat 5 times.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  {
    id: 'gamma_wrist_circles',
    instruction_he: 'פשוט ידיים קדימה וסובב את פרקי כפות הידיים בתנועה מעגלית.',
    instruction_en: 'Extend arms forward and rotate your wrists in circles.',
    duration_ms: 10000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
    ],
  },
]);


// ============================================================
// Wheelchair adaptations
// When Phase A detects wheelchair, we swap leg movements
// for upper-body equivalents
// ============================================================

export const WHEELCHAIR_OVERRIDES = Object.freeze({
  // Replace any movement that requires standing/walking
  alpha_weight_shift: {
    id: 'alpha_weight_shift_wheelchair',
    instruction_he: 'סובב את הגלגלים ימינה ושמאלה לסירוגין.',
    instruction_en: 'Turn your wheels right and left alternately.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  alpha_natural_motion: {
    id: 'alpha_natural_motion_wheelchair',
    instruction_he: 'דחוף את הכיסא קדימה ואחורה בקצב נוח.',
    instruction_en: 'Push your chair forward and back at a comfortable pace.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'rhythm_baseline',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  beta_step_right_left: null,       // skip — no leg stepping
  beta_single_leg_right: null,      // skip
  beta_single_leg_left: null,       // skip
  beta_mini_squat: {
    id: 'beta_upper_body_push',
    instruction_he: 'דחוף ידיים קדימה ומשוך אחורה, כמו דחיפת קיר. חזור 3 פעמים.',
    instruction_en: 'Push hands forward and pull back, like pushing a wall. Repeat 3 times.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  gamma_walk: {
    id: 'gamma_push_forward_back',
    instruction_he: 'דחוף את הכיסא קדימה ואחורה בקצב טבעי.',
    instruction_en: 'Push your chair forward and back at a natural pace.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'rhythm_baseline',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  gamma_squat_arms: {
    id: 'gamma_overhead_press',
    instruction_he: 'הרם ידיים מעל הראש ותוריד לאט. חזור 3 פעמים.',
    instruction_en: 'Raise arms overhead and lower slowly. Repeat 3 times.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
  gamma_hip_rotation: {
    id: 'gamma_trunk_rotation',
    instruction_he: 'סובב את הגוף העליון ימינה ושמאלה.',
    instruction_en: 'Rotate your upper body right and left.',
    duration_ms: 12000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'compensation',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_HIP, LM.RIGHT_HIP,
    ],
  },
  gamma_lateral_shift: {
    id: 'gamma_lateral_reach',
    instruction_he: 'הושט יד ימין הצידה, ואז יד שמאל. חזור.',
    instruction_en: 'Reach your right hand to the side, then your left. Repeat.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'compensation',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
      LM.LEFT_HIP, LM.RIGHT_HIP,
    ],
  },
  // New upper body movements — NOT overridden: undefined = keep original
  // gamma_shoulder_circles, gamma_elbow_flex, gamma_wrist_circles: kept as-is
  // alpha_shoulder_circles, alpha_elbow_flex: kept as-is
  // beta_shoulder_press, beta_elbow_flex, beta_arm_reach: kept as-is
  beta_step_right_left: null,    // skip — no leg stepping
  beta_mini_squat: {
    id: 'beta_upper_body_push',
    instruction_he: 'דחוף ידיים קדימה ומשוך אחורה, כמו דחיפת קיר. חזור 3 פעמים.',
    instruction_en: 'Push hands forward and pull back, like pushing a wall. Repeat 3 times.',
    duration_ms: 15000,
    target_limbs: ['left_arm', 'right_arm'],
    analysis_type: 'damping',
    landmarks_of_interest: [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
      LM.LEFT_WRIST, LM.RIGHT_WRIST,
    ],
  },
});


// ============================================================
// Utility: get movement queue for a given track
// ============================================================

export function getMovementQueue(track, isWheelchair = false) {
  let movements;

  switch (track) {
    case 'missing_limb':   movements = [...TRACK_ALPHA]; break;
    case 'deep_analysis':  movements = [...TRACK_BETA]; break;
    case 'full_body':      movements = [...TRACK_GAMMA]; break;
    default:
      throw new Error(`Unknown track: ${track}`);
  }

  if (!isWheelchair) return movements;

  // Apply wheelchair overrides
  return movements
    .map(m => {
      const override = WHEELCHAIR_OVERRIDES[m.id];
      if (override === null) return null;   // skip this movement
      if (override) return override;        // replace with adapted version
      return m;                             // keep original
    })
    .filter(Boolean);
}
