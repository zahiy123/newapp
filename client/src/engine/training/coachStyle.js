// ============================================================
// coachStyle — Adaptive Coach Styles (Stage 3 #12, owner decision 2026-09-28; built 2026-11-01)
//
// PURE. Three styles; the trainee picks one in the daily check-in (default by the training track).
//   energetic — the field-proven coach of restore point #74 (the owner: "perfect, nothing to add"): unchanged
//   balanced  — supportive but demanding, a little slower
//   calm      — calm, patient, slower (the default of the rehab-only track)
// Automatic softening: in ANY style the coach turns calm after a pain report of 4+ in this workout or a
// readiness of 1–2 (the trainee is tired / hurting) — for the rest of the workout.
// The style sets the AI's tone line (server styleLine) and the speech rate.
// ============================================================

export const COACH_STYLES = [
  { id: 'energetic', he: 'אנרגטי', en: 'Energetic', hintHe: 'דוחף וחד', hintEn: 'Driving and sharp' },
  { id: 'balanced', he: 'מאוזן', en: 'Balanced', hintHe: 'תומך ודורש', hintEn: 'Supportive, demanding' },
  { id: 'calm', he: 'רגוע', en: 'Calm', hintHe: 'סבלני ושקט', hintEn: 'Patient and quiet' },
];
const IDS = COACH_STYLES.map(s => s.id);

export const isStyle = (s) => IDS.includes(s);

/** The default by the training track: rehab-only → calm; everything else → the #74 coach (energetic). */
export function defaultStyle(profile) {
  return profile?.trainingTrack === 'rehab_only' || (profile?.sport === 'rehab' && !profile?.trainingTrack) ? 'calm' : 'energetic';
}

/** Should the coach soften now? (a pain report of 4+ this workout, or a readiness of 1–2) */
export function shouldSoften({ painReports = [], readiness = 0 } = {}) {
  return (painReports || []).some(p => Number(p?.level) >= 4) || (readiness >= 1 && readiness <= 2);
}

/** The style the coach uses right now. */
export function effectiveStyle(style, { softened = false } = {}) {
  if (softened) return 'calm';
  return isStyle(style) ? style : 'energetic';
}

/** The speech-rate factor of a style (energetic = 1: the #74 rates unchanged). */
export function rateFactor(style) {
  return style === 'calm' ? 0.88 : style === 'balanced' ? 0.95 : 1;
}
