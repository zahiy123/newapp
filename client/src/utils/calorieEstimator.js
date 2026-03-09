// MET (Metabolic Equivalent of Task) values for exercise types
const MET_VALUES = {
  squat: 5.0,
  dips: 4.0,
  plank: 3.5,
  dribbling: 6.0,
  high_knees: 8.0,
  arm_circles: 2.5,
  side_steps: 4.0,
  arm_punches: 3.5,
  core_twists: 3.0,
  single_leg_high_knee: 5.0,
  forward_kicks: 5.5,
  balance_hops: 6.0,
  single_arm_rotation: 2.5,
  push: 8.0,
  lunge: 6.0,
  shoulder: 5.5,
  goblet: 5.5,
  bicep: 3.5,
  tricep: 3.5,
  row: 5.0,
  lateral: 3.0,
  bridge: 3.5,
  wallsit: 2.5,
  mountain: 8.0,
  crunch: 3.5,
  sideplank: 3.0,
  pullApart: 2.5,
  // Hebrew keyword matches
  'כפיפות מרפק': 3.5,
  'הרחבת מרפק': 3.5,
  'משיכת': 5.0,
  'הרמה צידית': 3.0,
  'גשר': 3.5,
  'ישיבה על הקיר': 2.5,
  'מטפס הרים': 8.0,
  'כפיפות בטן': 3.5,
  'פלאנק צידי': 3.0,
  'מתיחת גומייה': 2.5,
  default: 4.0
};

export function estimateCalories(exerciseName, durationSeconds, weightKg) {
  const name = (exerciseName || '').toLowerCase();
  const weight = weightKg || 70; // fallback
  let met = MET_VALUES.default;
  for (const [key, val] of Object.entries(MET_VALUES)) {
    if (key !== 'default' && name.includes(key)) { met = val; break; }
  }
  // Calories = MET × weight(kg) × duration(hours)
  return Math.round(met * weight * (durationSeconds / 3600));
}

export function estimateSessionCalories(exercises, weightKg) {
  return exercises.reduce((total, ex) => total + estimateCalories(ex.name, ex.duration || 0, weightKg), 0);
}
