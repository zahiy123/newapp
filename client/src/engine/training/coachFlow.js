// ============================================================
// coachFlow — when the coach may START, what COUNTS, and how it DRIVES the trainee
//
// PURE. Owner rules:
//   1. Never announce / start before the trainee is really in the exercise's start position:
//      a hard gate — positioned right (setupCoach) + a trustworthy measurement + the profile's
//      START POSITION, continuously for START_HOLD_MS. Background noise or standing around
//      does not open it; losing it closes it.
//   2. Rep counting must be exact: a rep counts only for a full rest → peak → rest cycle of the
//      profile's primary joint with a real duration in both directions (no jitter / twitches).
//      Sitting and doing nothing never counts. Timed exercises count only seconds of real work.
//   3. Positioning prompts carry DRIVE — energy words like a real sports coach, varied (never
//      the same sentence twice in a row), with the trainee's name.
// ============================================================

import { repProgress } from '../exercise/profileEvaluator.js';

export const START_HOLD_MS = 600;      // in the start position this long → the gate opens
const START_DROP_MS = 400;             // out of it this long → the gate closes again
export const MIN_TO_PEAK_MS = 250;     // a rep's way to the peak cannot be faster (jitter guard)
export const MIN_RETURN_MS = 200;      // …nor its way back
const CYCLIC_WORK_WINDOW_MS = 1500;    // running / skipping: a stride or landing this recently = working

/** Is the trainee in the exercise's start position? (metrics = profile metrics of the frame) */
export function isStartPosition(profile, metrics) {
  if (!profile || profile.precision !== 'expert') return true;            // family profiles: positioning is the gate
  const j = profile.joints?.[profile.primary];
  const v = metrics?.[profile.primary];
  if (!j || typeof v !== 'number') return false;
  if (profile.kind === 'hold') return v >= j.rest[0] - 8 && v <= j.rest[1] + 8;
  if (profile.kind === 'strike') return v >= 145;                           // standing tall before the kick
  const p = repProgress(profile, v);
  return p !== null && p <= 0.3;                                            // at (or near) the rest position
}

export function createStartGate() {
  return { open: false, okSince: null, badSince: null };
}

/**
 * @param {Object} g - gate state
 * @param {{ positioned: boolean, confident: boolean, inStart: boolean }} s
 * @returns {boolean} open
 */
export function updateStartGate(g, { positioned, confident, inStart }, now) {
  const ok = positioned && confident !== false && inStart;
  if (ok) {
    g.badSince = null;
    if (g.okSince === null) g.okSince = now;
    if (!g.open && now - g.okSince >= START_HOLD_MS) g.open = true;
  } else {
    g.okSince = null;
    if (g.badSince === null) g.badSince = now;
    if (g.open && now - g.badSince >= START_DROP_MS) g.open = false;
  }
  return g.open;
}

/** A rep event (motionFeatures) that is a real repetition. */
export function isValidRep(ev) {
  return ev?.type === 'rep'
    && typeof ev.toPeakMs === 'number' && ev.toPeakMs >= MIN_TO_PEAK_MS
    && typeof ev.returnMs === 'number' && ev.returnMs >= MIN_RETURN_MS;
}

/**
 * Is the trainee WORKING right now (timed exercises count only these seconds)?
 *   cyclic (running / skipping): a stride / landing in the last 1.5 s
 *   hold: in the hold position (primary inside the hold range)
 *   others: positioned and measured
 */
export function updateWork(state, profile, result, now) {
  const st = state;
  for (const ev of result?.events || []) if (ev.type === 'rep' || ev.type === 'landing' || ev.type === 'strike') st.lastEventAt = now;
  if (!result?.inView || result?.quality?.confident === false) return false;
  if (!profile || profile.precision !== 'expert') return true;
  if (profile.kind === 'cyclic') return typeof st.lastEventAt === 'number' && now - st.lastEventAt <= CYCLIC_WORK_WINDOW_MS;
  if (profile.kind === 'hold') return isStartPosition(profile, result.metrics);
  return true;
}

// ---- Drive: energy words of a real coach, rotated ----
const DRIVE = {
  he: [
    'יאללה {name}, קום ותן בראש!',
    '{name}, אני מחכה לך — בוא נעלה הילוך!',
    'קדימה אלוף, האימון לא מחכה!',
    'יאללה, אנרגיה! בוא נתחיל לעבוד!',
    '{name}, תראה לי שאתה רעב!',
    'בוא בוא בוא, כל שנייה חשובה!',
  ],
  en: [
    "Come on {name}, get up and let's go!",
    "{name}, I'm waiting for you — let's step it up!",
    "Let's go champ, the workout won't wait!",
    "Energy! Let's get to work!",
    '{name}, show me you want it!',
    'Come on, come on — every second counts!',
  ],
};
const START_POSITION = {
  he: 'קח עמדת פתיחה — בדיוק כמו הצללית.',
  en: 'Get into the start position — exactly like the Ghost.',
};
export const READY_DRIVE = {
  first: { he: 'מעולה! עכשיו אני רואה אותך — יאללה, תן בראש!', en: "Great! Now I can see you — let's go all out!" },
  again: { he: 'מצוין, ממשיכים בכל הכוח!', en: 'Perfect, back at it — full power!' },
  start: { he: 'זהו, אתה בעמדה — מתחילים!', en: "That's it, you're in position — let's start!" },
};

/** The k-th drive line (rotates; never the same twice in a row). */
export function driveLine(k, name, isHe) {
  const list = isHe ? DRIVE.he : DRIVE.en;
  return list[((k % list.length) + list.length) % list.length].replace('{name}', name || (isHe ? 'אלוף' : 'champ')).trim();
}

/** A positioning instruction with drive in front of it. */
export function withDrive(instruction, k, name, isHe) {
  return `${driveLine(k, name, isHe)} ${instruction}`;
}

/** "Get into the start position" with drive. */
export function startPositionPrompt(k, name, isHe) {
  return withDrive(isHe ? START_POSITION.he : START_POSITION.en, k, name, isHe);
}

// ---- Split balance sets: half a set on each leg, the coach calls the switch ----

/**
 * Leg order for a split set: start on the base (sound) leg, then the prosthetic side (a
 * below-knee prosthesis bears weight — strength and stability work on it too). No limitation →
 * right, then left.
 * @returns {{ first: 'left'|'right', second: 'left'|'right' }}
 */
export function splitLegOrder(lp = {}) {
  const pros = ['left', 'right'].find(s => lp[`${s}_leg`]?.state === 'prosthetic');
  if (pros) return { first: pros === 'left' ? 'right' : 'left', second: pros };
  return { first: 'right', second: 'left' };
}

/** "right leg" / "left leg — the prosthesis". */
export function legLabel(side, lp = {}, isHe = true) {
  const pros = lp[`${side}_leg`]?.state === 'prosthetic';
  if (isHe) return `רגל ${side === 'left' ? 'שמאל' : 'ימין'}${pros ? ' — הפרוטזה' : ''}`;
  return `${side === 'left' ? 'left' : 'right'} leg${pros ? ' — the prosthesis' : ''}`;
}

/** The working (lifted) leg of the Ghost when standing on `support`. */
export const liftedLeg = (support) => (support === 'left' ? 'right' : 'left');

export function splitStartText(lp, isHe) {
  const { first } = splitLegOrder(lp);
  return isHe
    ? `מתחילים: עמידה על ${legLabel(first, lp, true)}. באמצע הסט נחליף רגל.`
    : `Start standing on your ${legLabel(first, lp, false)}. We switch legs halfway through the set.`;
}

export function splitSwitchText(lp, isHe) {
  const { second } = splitLegOrder(lp);
  return isHe
    ? `החלף רגל! עכשיו עמידה על ${legLabel(second, lp, true)}. יאללה, יציב!`
    : `Switch legs! Now stand on your ${legLabel(second, lp, false)}. Steady — let's go!`;
}
