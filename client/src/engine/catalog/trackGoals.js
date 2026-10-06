// ============================================================
// trackGoals — ONE source of truth for "which goals exist for this trainee" (Stage 3.1)
//
// The chain is locked end-to-end:
//   track (profile)  →  the goals the Goals page OFFERS  →  the goals the trainee SELECTED
//   →  each training day's goal (one of the selected)  →  the catalog exercises of that goal
//   →  each exercise's Ghost.
// Nothing outside the chosen track can appear at any link:
//   rehab only     → rehab goals: targeted strengthening, stability & balance, range of motion
//   sport          → sport goals: speed, explosive power, technique, agility (what the sport
//                    family can really train), fitness → strength / endurance / power / mobility
//   rehab + sport  → the rehab goals + "integrating the sport's tools into rehab"
// ============================================================

import { familyOf } from './sessionPlanner.js';
import { SPORT_LIBRARY } from '../sports/sportLibrary.js';

const t = (he, en) => ({ he, en });

/** Selectable profile goals (id = the session goal it drives). */
export const PROFILE_GOALS = Object.freeze({
  // rehab
  rehabStrength: { name: t('חיזוק שרירים ממוקד', 'Targeted strengthening'), icon: '💪', group: 'rehab',
    desc: t('חיזוק השרשרת סביב האזור הפגוע בקצב מבוקר', 'Strengthen the chain around the injured area at a controlled pace') },
  rehabStability: { name: t('יציבות ושיווי משקל', 'Stability & balance'), icon: '⚖️', group: 'rehab',
    desc: t('שליטה, יציבות אגן ושיווי משקל', 'Control, pelvic stability and balance') },
  rehabMobility: { name: t('טווח תנועה', 'Range of motion'), icon: '🔄', group: 'rehab',
    desc: t('החזרת טווח תנועה מלא ובטוח', 'Restore a full, safe range of motion') },
  rehabSport: { name: t('שילוב כלי הענף בשיקום', 'Sport tools in rehab'), icon: '🎯', group: 'rehabSport',
    desc: t('השיקום קודם — תנועות הענף בצורה בטוחה', 'Rehab first — the sport movements, safely') },
  // sport
  speed: { name: t('מהירות', 'Speed'), icon: '⚡', group: 'sport', desc: t('האצות ותנועות רגליים מתפרצות', 'Accelerations and explosive footwork') },
  power: { name: t('כוח מתפרץ', 'Explosive power'), icon: '🚀', group: 'sport', desc: t('קפיצות ודחיפות מתפרצות', 'Jumps and explosive drives') },
  technique: { name: t('טכניקה', 'Technique'), icon: '🎯', group: 'sport', desc: t('תנועות הענף בביצוע מדויק', 'The sport movements, precisely') },
  agility: { name: t('זריזות', 'Agility'), icon: '🔀', group: 'sport', desc: t('שינויי כיוון ותגובה מהירה', 'Changes of direction and quick reactions') },
  // fitness
  strength: { name: t('כוח', 'Strength'), icon: '🏋️', group: 'fitness', desc: t('חיזוק כל הגוף', 'Whole-body strength') },
  endurance: { name: t('סיבולת', 'Endurance'), icon: '❤️', group: 'fitness', desc: t('כושר אירובי וסיבולת שריר', 'Aerobic fitness and muscular endurance') },
  mobility: { name: t('ניידות וגמישות', 'Mobility & flexibility'), icon: '🧘', group: 'fitness', desc: t('גמישות ותנועה חופשית', 'Flexibility and free movement') },
});

// Sport goals each sport family can really train with today's catalog (honest: a family gets a
// goal only when there are enough patterns for a coherent session)
const SPORT_GOALS_BY_FAMILY = {
  field: ['speed', 'power', 'technique', 'agility'],
  court: ['speed', 'power', 'technique', 'agility'],
  racket: ['speed', 'power', 'technique', 'agility'],
  endurance: ['speed', 'endurance', 'power', 'agility'],     // running
  seated: ['technique', 'power'],
  strength: ['strength', 'endurance', 'power', 'mobility'],
};
const REHAB_GOALS = ['rehabStrength', 'rehabStability', 'rehabMobility'];

/** The trainee's track. */
export function trackOf(profile) {
  const p = profile || {};
  if (p.trainingTrack === 'rehab_only' || p.trainingTrack === 'rehab_sport') return p.trainingTrack;
  if (p.sport === 'rehab') return 'rehab_only';
  return 'sport_only';
}

/** The sport family the trainee's sport belongs to (rehab + sport → the chosen sport). */
export function sportFamilyOf(profile) {
  const p = profile || {};
  const sport = trackOf(p) === 'rehab_sport' ? p.rehabSport : p.sport;
  if (!sport || !SPORT_LIBRARY[sport]) return 'strength';
  return familyOf(sport);
}

/** Goals the Goals page offers for this profile (ids, in display order). */
export function goalOptions(profile) {
  const track = trackOf(profile);
  if (track === 'rehab_only') return [...REHAB_GOALS];
  if (track === 'rehab_sport') return [...REHAB_GOALS, 'rehabSport'];
  return [...(SPORT_GOALS_BY_FAMILY[sportFamilyOf(profile)] || SPORT_GOALS_BY_FAMILY.strength)];
}

// Goal ids of the previous Goals page → today's ids (per track), so existing profiles keep working
const LEGACY = {
  rehab: { strength: 'rehabStrength', flexibility: 'rehabMobility', technique: 'rehabSport', speed: null, aerobic: null, weightLoss: null },
  sport: { technique: 'technique', speed: 'speed', strength: 'power', aerobic: null, weightLoss: null, flexibility: null },
  fitness: { strength: 'strength', aerobic: 'endurance', weightLoss: 'endurance', flexibility: 'mobility', speed: 'power', technique: null },
};

/**
 * The trainee's session goals: their selected goals that belong to the track (legacy ids
 * mapped), or — when none is selected / valid — every goal of the track.
 */
export function selectedSessionGoals(profile) {
  const picked = validProfileGoals(profile);
  return picked.length ? picked : goalOptions(profile);
}

/** The profile's selected goals that are valid for its track (legacy ids mapped); may be empty. */
export function validProfileGoals(profile) {
  const options = goalOptions(profile);
  const track = trackOf(profile);
  const legacy = track !== 'sport_only' ? LEGACY.rehab : sportFamilyOf(profile) === 'strength' ? LEGACY.fitness : LEGACY.sport;
  const picked = [];
  for (const g of profile?.goals || []) {
    const id = options.includes(g) ? g : legacy[g];
    if (id && options.includes(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}
