// ============================================================
// dailyCheckIn — TODAY's reality before every workout (owner, 2026-10-06)
//
// The profile says what the trainee usually has; today may differ: a prosthesis user may train
// on crutches today, the ball may be at the club, the session may be at home instead of the
// field. Before every workout the coach asks (prefilled with the last answers):
//   • where do you train today?            home / yard / field / gym
//   • is a ball available?                  (ball sports only)
//   • prosthesis today, or crutches only?   (leg amputees only)
// The day's workout is then built ONLY from these answers (applyCheckIn → the effective profile
// used by the plan, the warm-up, the Ghost, the safety rules and the equipment fit).
// ============================================================

import { getLimbProfile } from '../limbProfile.js';
import { trackOf, sportOf } from '../catalog/trackGoals.js';

const t = (he, en) => ({ he, en });

export const CHECKIN_LOCATIONS = Object.freeze([
  { id: 'home', icon: '🏠', label: t('בית', 'Home') },
  { id: 'yard', icon: '🌳', label: t('גינה / חצר', 'Yard / park') },
  { id: 'field', icon: '⚽', label: t('מגרש', 'Field') },
  { id: 'gym', icon: '🏋️', label: t('חדר כושר', 'Gym') },
]);

export const CHECKIN_MOBILITY = Object.freeze([
  { id: 'prosthesis', icon: '🦿', label: t('עם פרוטזה', 'With my prosthesis') },
  { id: 'crutches', icon: '🩼', label: t('על קביים בלבד (בלי פרוטזה)', 'Crutches only (no prosthesis)') },
]);

const BALL_SPORTS = new Set(['football', 'footballAmputee', 'footballAmputeeGK', 'basketball', 'basketballWheelchair', 'tennis', 'tennisWheelchair']);

/** Which questions apply to this trainee. */
export function checkInQuestions(profile) {
  const lp = getLimbProfile(profile);
  const legAmputee = ['left_leg', 'right_leg'].some(k => ['prosthetic', 'absent'].includes(lp[k]?.state));
  const sport = sportOf(profile);
  return {
    location: true,
    ball: BALL_SPORTS.has(sport) || trackOf(profile) === 'rehab_sport',
    // a leg amputee who is not a wheelchair user: prosthesis today or crutches only?
    mobility: legAmputee && !lp.wheelchair,
  };
}

/** Prefilled answers: the last check-in, else the profile. */
export function checkInDefaults(profile) {
  const p = profile || {};
  const last = p.lastCheckIn || {};
  const q = checkInQuestions(p);
  const location = last.location || p.trainingLocation || p.currentLocation || 'home';
  return {
    location: CHECKIN_LOCATIONS.some(l => l.id === location) ? location : 'home',
    hasBall: q.ball ? (typeof last.hasBall === 'boolean' ? last.hasBall : (typeof p.hasBall === 'boolean' ? p.hasBall : null)) : null,
    mobility: q.mobility ? (last.mobility || (p.mobilityAid === 'crutches' ? 'crutches' : 'prosthesis')) : null,
  };
}

/** True when every applicable question is answered. */
export function checkInComplete(profile, status) {
  if (!status) return false;
  const q = checkInQuestions(profile);
  return !!status.location && (!q.ball || typeof status.hasBall === 'boolean') && (!q.mobility || !!status.mobility);
}

/**
 * The EFFECTIVE profile for today's workout. todayMobility drives trainingLimbs: 'crutches' →
 * the prosthesis is not worn today; 'prosthesis' → an active prosthesis today (even if the scan saw
 * crutches once).
 */
export function applyCheckIn(profile, status) {
  if (!status) return profile;
  const p = { ...(profile || {}) };
  if (status.location) { p.currentLocation = status.location; p.trainingLocation = status.location; }
  if (typeof status.hasBall === 'boolean') p.hasBall = status.hasBall;
  if (status.mobility) {
    p.todayMobility = status.mobility;
    p.mobilityAid = status.mobility === 'crutches' ? 'crutches' : (p.mobilityAid === 'crutches' ? 'none' : p.mobilityAid);
  }
  return p;
}
