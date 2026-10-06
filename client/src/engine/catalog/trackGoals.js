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

import { familyOf, buildSession } from './sessionPlanner.js';
import { relevantPatterns } from './relevance.js';
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
  // adapted sport goals
  balanceCore: { name: t('שיווי משקל וליבה', 'Balance & core'), icon: '⚖️', group: 'sport', desc: t('יציבות על רגל אחת וליבה חזקה', 'Single-leg stability and a strong core') },
  upperBody: { name: t('כוח פלג גוף עליון', 'Upper-body strength'), icon: '💪', group: 'sport', desc: t('הכוח שהקביים / הכיסא דורשים', 'The strength the crutches / chair demand') },
  // fitness
  strength: { name: t('כוח', 'Strength'), icon: '🏋️', group: 'fitness', desc: t('חיזוק כל הגוף', 'Whole-body strength') },
  endurance: { name: t('סיבולת', 'Endurance'), icon: '❤️', group: 'fitness', desc: t('כושר אירובי וסיבולת שריר', 'Aerobic fitness and muscular endurance') },
  mobility: { name: t('ניידות וגמישות', 'Mobility & flexibility'), icon: '🧘', group: 'fitness', desc: t('גמישות ותנועה חופשית', 'Flexibility and free movement') },
});

// Sport goals each sport family can really train with today's catalog (honest: a family gets a
// goal only when there are enough patterns for a coherent session)
// Sports whose goals differ from their family's (adapted sports)
const SPORT_GOALS_BY_SPORT = {
  footballAmputee: ['technique', 'balanceCore', 'upperBody', 'power'],
  basketballWheelchair: ['technique', 'upperBody', 'power'],
  tennisWheelchair: ['technique', 'upperBody', 'power'],
};
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

/** The trainee's sport id (rehab + sport → the chosen sport). */
export function sportOf(profile) {
  const p = profile || {};
  return trackOf(p) === 'rehab_sport' ? (p.rehabSport || null) : (p.sport || null);
}

/** Functional pattern ids for this trainee (null = unrestricted). */
export function patternsFor(profile, lp = {}) {
  return relevantPatterns({ track: trackOf(profile), sport: sportOf(profile), lp });
}

/**
 * Goals the Goals page offers for this profile (ids, in display order). A goal is offered only
 * when a real, fully coherent session can be built for THIS trainee (sport + body) — never a
 * goal the catalog cannot honestly deliver.
 */
export function goalOptions(profile, lp = null) {
  const track = trackOf(profile);
  let list;
  if (track === 'rehab_only') list = [...REHAB_GOALS];
  else if (track === 'rehab_sport') list = [...REHAB_GOALS, 'rehabSport'];
  else list = [...(SPORT_GOALS_BY_SPORT[sportOf(profile)] || SPORT_GOALS_BY_FAMILY[sportFamilyOf(profile)] || SPORT_GOALS_BY_FAMILY.strength)];
  if (!lp) return list;
  const fam = sportFamilyOf(profile);
  const family = track === 'sport_only' ? fam : familyOf('rehab');
  const patterns = patternsFor(profile, lp);
  const feasible = list.filter((g) => {
    const s = buildSession({ goal: g, family, sportFamily: fam, lp, seed: 'feasibility', patterns });
    return s.items.filter(x => x.role === 'main').length >= 2 && s.coherence.mainOnGoal;
  });
  return feasible.length ? feasible : list;
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
export function selectedSessionGoals(profile, lp = null) {
  const picked = validProfileGoals(profile, lp);
  return picked.length ? picked : goalOptions(profile, lp);
}

/** The profile's selected goals that are valid for its track (legacy ids mapped); may be empty. */
export function validProfileGoals(profile, lp = null) {
  const options = goalOptions(profile, lp);
  const track = trackOf(profile);
  const legacy = track !== 'sport_only' ? LEGACY.rehab : sportFamilyOf(profile) === 'strength' ? LEGACY.fitness : LEGACY.sport;
  const picked = [];
  for (const g of profile?.goals || []) {
    const id = options.includes(g) ? g : legacy[g];
    if (id && options.includes(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}
