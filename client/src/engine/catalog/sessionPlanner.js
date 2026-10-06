// ============================================================
// sessionPlanner — COHERENT daily sessions from the catalog (Stage 3.1)
//
// The owner's principle: a session serves ONE goal. A football speed session is (almost)
// entirely speed — activation, accelerations, explosive footwork; a rehab + sport session
// serves the rehab need first (chain strengthening, protecting the injured area) and uses the
// sport's tools in a safe way. Every exercise prepares for or supports that goal — nothing
// "thrown in" from another track.
//
// A session = goal TEMPLATE of blocks:
//   prep      prepares the body for the goal (activation / mobility / coordination)
//   main      the goal itself — every exercise trains the goal's qualities
//   support   supports the goal (stability / strength / core that the goal relies on)
//   cooldown  brings the body down (mobility)
// Exercises come from the catalog (pattern × variation → always a Ghost), filtered by the
// trainee's body (limbProfile) and sport family, chosen with a seeded RNG (variety across days
// and weeks, stable for the same day), never the same movement pattern twice in a session.
// coherenceReport() measures it: share of main + support exercises on goal.
// ============================================================

import { buildCatalog } from './catalog.js';
import { PATTERNS } from './patterns.js';
import { SPORT_LIBRARY } from '../sports/sportLibrary.js';

const t = (he, en) => ({ he, en });

export const GOALS = Object.freeze({
  speed: { name: t('מהירות', 'Speed'), main: ['speed', 'acceleration'], support: ['power', 'plyometric', 'balance', 'stability', 'coordination'] },
  agility: { name: t('זריזות ושינויי כיוון', 'Agility'), main: ['agility', 'speed', 'coordination'], support: ['balance', 'power', 'stability', 'plyometric'] },
  power: { name: t('כוח מתפרץ', 'Power'), main: ['power', 'plyometric'], support: ['strength', 'balance', 'stability', 'acceleration'] },
  strength: { name: t('כוח', 'Strength'), main: ['strength'], support: ['core', 'stability', 'balance', 'posteriorChain'] },
  endurance: { name: t('סיבולת', 'Endurance'), main: ['endurance', 'conditioning'], support: ['core', 'strength', 'stability'] },
  technique: { name: t('טכניקה וענף', 'Sport technique'), main: ['technique', 'sportSkill'], support: ['balance', 'power', 'coordination', 'agility', 'core'] },
  mobility: { name: t('ניידות והתאוששות', 'Mobility & recovery'), main: ['mobility', 'stability'], support: ['core', 'balance', 'activation'] },
  // Adapted sport goals (amputee / wheelchair sports)
  // dose: the prescriptions that train the goal (when the goal's own qualities are not dose labels)
  balanceCore: { name: t('שיווי משקל וליבה', 'Balance & core'), main: ['balance', 'stability', 'core'], support: ['strength', 'technique', 'mobility'], dose: ['stability', 'balance', 'core', 'strength'] },
  upperBody: { name: t('כוח פלג גוף עליון', 'Upper-body strength'), main: ['upperBody'], support: ['core', 'stability', 'mobility'], dose: ['strength', 'power'] },
  // Rehab goals: every main exercise is rehab work (rehab pattern, controlled tempo or partial range)
  rehabStrength: { name: t('חיזוק שרירים ממוקד', 'Targeted strengthening'), main: ['strength'], mainAlso: ['rehab'], support: ['stability', 'core', 'balance', 'rehab'] },
  rehabStability: { name: t('יציבות ושיווי משקל', 'Stability & balance'), main: ['stability', 'balance'], mainAlso: ['rehab'], support: ['core', 'strength', 'rehab'] },
  rehabMobility: { name: t('טווח תנועה', 'Range of motion'), main: ['mobility'], support: ['stability', 'activation', 'rehab'] },
  rehab: { name: t('שיקום', 'Rehab'), main: ['rehab', 'stability'], support: ['core', 'balance', 'mobility', 'activation'] },
  rehabSport: { name: t('שילוב כלי הענף בשיקום', 'Sport tools in rehab'), main: ['rehab', 'stability'], support: ['technique', 'sportSkill', 'balance', 'core'] },
});

// Block sizes and the qualities each block looks for (in order of preference)
const TEMPLATE = (goal) => {
  const g = GOALS[goal];
  const prep = SAFE_GOALS.has(goal) ? ['mobility', 'activation'] : ['activation', 'coordination', 'mobility'];
  return [
    { role: 'prep', n: 2, want: prep },
    { role: 'main', n: goal === 'speed' || goal === 'power' ? 4 : 3, want: g.main, requireAll: g.mainAlso || [] },
    { role: 'support', n: 2, want: g.support },
    { role: 'cooldown', n: 1, want: ['mobility'] },
  ];
};

// Doses per block role (the main block uses the goal-fitting dose)
const PREP_DOSES = new Set(['s2r15', 'i20', 'i30', 'h20', 'k10']);
const COOL_DOSES = new Set(['i30', 'i45', 'h30', 's2r15']);
const SAFE_GOALS = new Set(['rehab', 'rehabSport', 'mobility', 'rehabStrength', 'rehabStability', 'rehabMobility']);
const RISKY = new Set(['plyometric']);

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = hashSeed(String(seed)) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sport family of a context id (rehab / fitness → their own families). */
export function familyOf(sportId) {
  return SPORT_LIBRARY[sportId]?.family || 'strength';
}

function allowedInGoal(item, goal) {
  if (SAFE_GOALS.has(goal)) {
    if (item.qualities.some(q => RISKY.has(q))) return false;            // no plyometrics in rehab / recovery
    if (item.variation.tempo === 'explosive') return false;
  }
  return true;
}

// A pattern is used once per session — except a unilateral skill in a technique session, where
// each side is its own exercise (right foot, left foot, alternating: the weak side matters most)
const useKey = (it, goal) => (goal === 'technique' && it.variation.side !== 'both' ? `${it.patternId}|${it.variation.side}` : it.patternId);

function pick(candidates, want, rand, usedPatterns, avoid, requireAll = [], goal = null) {
  // preference: earlier `want` quality first; then not used this week; then random
  const score = (it) => {
    const idx = want.findIndex(q => it.qualities.includes(q));
    return (idx < 0 ? 99 : idx) * 10 + (avoid.has(it.id) ? 5 : 0) + rand();
  };
  const matching = candidates.filter(it => !usedPatterns.has(useKey(it, goal)) && !usedPatterns.has(it.patternId) && want.some(q => it.qualities.includes(q))
    && requireAll.every(q => it.qualities.includes(q)));
  // never repeat an exercise of this week when there is any alternative
  const fresh = matching.filter(it => !avoid.has(it.id));
  const pool = fresh.length ? fresh : matching;
  if (!pool.length) return null;
  // sample among the best few (variety without losing the priority order)
  const ranked = pool.map(it => [score(it), it]).sort((a, b) => a[0] - b[0]);
  const top = ranked.filter(([s]) => s < ranked[0][0] + 10).slice(0, 40);
  return top[Math.floor(rand() * top.length)][1];
}

/**
 * Build one coherent session.
 * @param {{ goal: string, family: string, sportFamily?: string, lp?: Object, seed: string, avoid?: Set<string> }} p
 *   family: the catalog family for the main work (the sport); sportFamily: rehab + sport's sport family
 * @returns {{ goal, items: Array<{ item, role }>, coherence: Object }}
 */
export function buildSession({ goal, family, sportFamily = null, lp = {}, seed, avoid = new Set(), patterns = null }) {
  const g = GOALS[goal] ? goal : 'strength';
  const rand = rng(`${seed}|${g}`);
  const fam = g === 'rehabSport' ? (sportFamily || family) : family;
  // only functional patterns for this trainee's sport / limitation (relevance.js), never filler
  const catalog = buildCatalog(fam, lp).filter(it => allowedInGoal(it, g) && (!patterns || patterns.has(it.patternId)));
  const usedPatterns = new Set();
  const items = [];
  // Fill the goal's MAIN block first (it gets the best-fitting patterns), then support, prep and
  // cooldown; the session is then ordered prep → main → support → cooldown
  const ORDER = ['main', 'support', 'prep', 'cooldown'];
  const blocks = TEMPLATE(g).slice().sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
  for (const block of blocks) {
    const doseOk = (it) => (block.role === 'prep' ? PREP_DOSES.has(it.variation.dose)
      : block.role === 'cooldown' ? COOL_DOSES.has(it.variation.dose)
        : it.doseFit.some(q => block.want.includes(q) || GOALS[g].main.includes(q) || (GOALS[g].dose || []).includes(q)));
    let cands = catalog.filter(doseOk);
    // rehab + sport: the support block uses the SPORT's technique patterns, gently (no explosive)
    if (g === 'rehabSport' && block.role === 'support') cands = cands.filter(it => it.variation.tempo !== 'explosive');
    for (let k = 0; k < block.n; k++) {
      const it = pick(cands, block.want, rand, usedPatterns, avoid, block.requireAll, g);
      if (!it) break;
      usedPatterns.add(useKey(it, g));
      items.push({ item: it, role: block.role });
    }
  }
  const SESSION_ORDER = ['prep', 'main', 'support', 'cooldown'];
  items.sort((a, b) => SESSION_ORDER.indexOf(a.role) - SESSION_ORDER.indexOf(b.role));
  return { goal: g, items, coherence: coherenceReport(items, g) };
}

/** Share of main + support exercises that serve the goal (100 = fully coherent). */
export function coherenceReport(items, goal) {
  const g = GOALS[goal];
  const core = items.filter(x => x.role === 'main' || x.role === 'support');
  const mainOk = (x) => x.item.qualities.some(q => g.main.includes(q)) && (g.mainAlso || []).every(q => x.item.qualities.includes(q));
  const onGoal = core.filter(x => (x.role === 'main' ? mainOk(x) : x.item.qualities.some(q => [...g.main, ...g.support].includes(q))));
  const offGoal = core.filter(x => !onGoal.includes(x)).map(x => x.item.id);
  const mainOnGoal = items.filter(x => x.role === 'main').every(mainOk);
  return { pct: core.length ? Math.round((100 * onGoal.length) / core.length) : 100, mainOnGoal, offGoal };
}

// ---- Day goal: ALWAYS one of the trainee's selected goals (the AI focus only picks among them) ----
const GOAL_WORDS = [
  ['rehabSport', ['שיקום משולב', 'שילוב כלי הענף', 'rehab + sport', 'rehab and sport', 'sport tools']],
  ['rehabStability', ['יציבות', 'שיווי משקל', 'stability', 'balance']],
  ['rehabMobility', ['טווח תנועה', 'range of motion']],
  ['rehabStrength', ['חיזוק', 'strengthening']],
  ['speed', ['מהירות', 'ספרינט', 'האצה', 'speed', 'sprint', 'acceleration']],
  ['agility', ['זריזות', 'שינויי כיוון', 'agility', 'change of direction', 'קואורדינציה', 'coordination']],
  ['power', ['כוח מתפרץ', 'פליאומטר', 'קפיצ', 'power', 'plyo', 'explosive', 'נפיצות']],
  ['endurance', ['סיבולת', 'אירובי', 'endurance', 'aerobic', 'conditioning', 'כושר גופני', 'אינטרוול']],
  ['mobility', ['גמישות', 'מוביליטי', 'ניידות', 'mobility', 'flexibility', 'התאוששות', 'recovery']],
  ['technique', ['טכניקה', 'מיומנות', 'technique', 'skill', 'בעיט', 'מסיר', 'כדור', 'דריבל', 'זריקה', 'מכות']],
  ['strength', ['כוח', 'חיזוק', 'strength', 'שריר']],
];

// Words → a goal family member (rehab words resolve to the rehab goals, generic ones to the sport goals)
const ALIASES = { mobility: ['rehabMobility'], strength: ['rehabStrength'], rehabMobility: ['mobility'], rehabStrength: ['strength'] };

/**
 * The day's goal — guaranteed to be one of `allowed` (the trainee's selected goals of their track).
 * The AI day focus picks among them when it names one; otherwise the allowed goals rotate by day.
 * @param {Object} day - plan day ({ focus, name, theme, ... })
 * @param {{ allowed: string[], dayIndex: number }} ctx
 */
export function inferGoal(day, { allowed, dayIndex = 0 } = {}) {
  const goals = allowed?.length ? allowed : ['strength'];
  const text = [day?.focus, day?.name, day?.title, day?.theme].filter(Boolean).join(' ').toLowerCase();
  const said = GOAL_WORDS.filter(([, words]) => words.some(w => text.includes(w))).map(([g]) => g);
  for (const g of said) {
    if (goals.includes(g)) return g;
    const alias = (ALIASES[g] || []).find(a => goals.includes(a));
    if (alias) return alias;
  }
  return goals[dayIndex % goals.length];
}

/** Pattern name for reports. */
export const patternName = (id, lang = 'he') => PATTERNS[id]?.name[lang] || id;
