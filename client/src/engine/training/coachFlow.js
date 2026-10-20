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
export const MIN_TO_PEAK_MS = 180;     // a rep's way to the peak cannot be faster (jitter guard)
export const MIN_RETURN_MS = 80;       // …nor the first part of its way back (counted mid-return)
const CYCLIC_WORK_WINDOW_MS = 1500;    // running / skipping: a stride or landing this recently = working

// The READY STANCE of a kick / pass (owner field video, 2026-10-19: a laptop close up and looking down read
// the standing knees as 85–160° and the kicking leg's ankle was often unseen — "knee ≥ 145°" never held,
// the exercise never started, the coach only talked about the camera). A coach sees readiness as: standing,
// the feet STILL for a moment next to the ball — measured from the feet's positions, not from knee angles
// the camera's perspective distorts.
export const READY_STILL_MS = 600;
// the FIRST pass may open the exercise only if the trainee stood still at the ball just before it — walking
// back to the spot never opens it with a phantom "1"; counting during the set is untouched
export const OPENING_STILL_WINDOW_MS = 2500;
// after a counted kick the NEXT one may count only once the kicking foot SETTLED again (still for SETTLE_MS) —
// its back-swing / its return is never a second count; after RELEASE_MS the lock opens anyway (a lost foot)
export const SETTLE_MS = 220, RELEASE_MS = 1800, SETTLE_TORSO = 0.08;
export function footSettled(hist, side, sinceT, now) {
  const key = side === 'left' ? 'l' : side === 'right' ? 'r' : null;
  if (!key) return false;
  const w = (hist || []).filter(h => h.t > sinceT && now - h.t <= SETTLE_MS);
  if (w.length < 3 || now - w[0].t < SETTLE_MS * 0.7) return false;
  const pts = w.map(h => h[key]);
  if (pts.some(p => !p)) return false;
  const torso = w.map(h => h.torso).filter(v => v > 0)[0];
  if (!torso) return false;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) <= SETTLE_TORSO * torso;
}
export const kickLockOpen = ({ now, lastCountAt, settledSinceCount, lockMs = 1000 }) =>
  now - lastCountAt >= lockMs && (settledSinceCount || now - lastCountAt >= RELEASE_MS);
export const openingKickAllowed = (lastStillAt, now) => typeof lastStillAt === 'number' && now - lastStillAt <= OPENING_STILL_WINDOW_MS;
export const READY_STILL_TORSO = 0.12;     // the feet move less than this share of the torso length

/**
 * Feet still for READY_STILL_MS? hist: [{ t, l: {x,y}|null, r: {x,y}|null, torso }] (newest last).
 * Every foot seen through the window must stay within READY_STILL_TORSO of its mean; at least one seen.
 */
export function feetStill(hist, now) {
  const w = (hist || []).filter(h => now - h.t <= READY_STILL_MS);
  if (w.length < 5 || now - w[0].t < READY_STILL_MS * 0.75) return false;
  const torsos = w.map(h => h.torso).filter(v => v > 0).sort((a, b) => a - b);
  if (!torsos.length) return false;
  const lim = READY_STILL_TORSO * torsos[Math.floor(torsos.length / 2)];
  let seen = false;
  for (const side of ['l', 'r']) {
    const pts = w.map(h => h[side]).filter(Boolean);
    if (pts.length < 0.6 * w.length) continue;
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    if (pts.some(p => Math.hypot(p.x - mx, p.y - my) > lim)) return false;
    seen = true;
  }
  return seen;
}

/**
 * Is the trainee in the exercise's start position? (metrics = profile metrics of the frame)
 * @param {{ still?: boolean, standing?: boolean }} [ctx] - for kicks / passes: the feet still + standing
 */
export function isStartPosition(profile, metrics, ctx = null) {
  if (!profile || profile.precision !== 'expert') return true;            // family profiles: positioning is the gate
  const j = profile.joints?.[profile.primary];
  const v = metrics?.[profile.primary];
  if (profile.kind === 'strike' && ctx && typeof ctx.still === 'boolean') return ctx.still && ctx.standing !== false;
  if (!j || typeof v !== 'number') return false;
  if (profile.kind === 'hold') return v >= j.rest[0] - 8 && v <= j.rest[1] + 8;
  if (profile.kind === 'strike') {
    if (ctx && typeof ctx.still === 'boolean') return ctx.still && ctx.standing !== false;   // the ready stance
    return v >= 145;                                                        // (no stance data: standing tall)
  }
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

/** A fast-count event (motionFeatures 'repCount') that is a real repetition. */
export function isValidRep(ev) {
  return ev?.type === 'repCount'
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
// a kick / pass: the ready stance at the ball — or simply start passing (the first real pass starts it)
const START_POSITION_STRIKE = {
  he: 'עמוד ליד הכדור, רגל התמיכה במקום — ותתחיל למסור.',
  en: 'Stand by the ball, support foot planted — and start passing.',
};
const START_POSITION = {
  he: 'קח עמדת פתיחה — בדיוק כמו הצללית.',
  en: 'Get into the start position — exactly like the Ghost.',
};
// Positioning acknowledgements are FACTUAL, never praise (owner: praise only for a verified correct
// execution) — "I can see you", not "great"
export const READY_DRIVE = {
  first: { he: 'עכשיו אני רואה אותך — מתחילים.', en: "Now I can see you — let's start!" },
  again: { he: 'רואה אותך שוב — ממשיכים.', en: 'I can see you again — back at it.' },
  start: { he: 'אתה בעמדה — מתחילים!', en: "You're in position — let's start!" },
};

/** The k-th drive line (rotates; never the same twice in a row). */
export function driveLine(k, name, isHe) {
  const list = isHe ? DRIVE.he : DRIVE.en;
  return list[((k % list.length) + list.length) % list.length].replace('{name}', name || (isHe ? 'אלוף' : 'champ')).trim();
}

/** A positioning instruction with drive in front of it. */
export function withDrive(instruction, k, name, isHe) {
  // PROFESSIONAL ONLY (owner, 2026-10-14): the precise, measured instruction — no generic energy
  // line ("קום ותן בראש", "כל שנייה חשובה") in front of it
  return instruction;
}

/** "Get into the start position" with drive. */
export function startPositionPrompt(k, name, isHe, kind = null) {
  const t = kind === 'strike' ? START_POSITION_STRIKE : START_POSITION;
  return withDrive(isHe ? t.he : t.en, k, name, isHe);
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

/** What the current half of a split set does: 'stand' = stand / work on that leg; 'kick' = kick with it. */
/** A kick or a pass set (the kicking / passing leg alternates); otherwise a stance set. */
export const isStrikeMode = (mode) => mode === 'kick' || mode === 'pass';
const action = (mode, isHe) => (mode === 'pass'
  ? (isHe ? 'מסירות ב' : 'passes with your ')
  : mode === 'kick'
    ? (isHe ? 'בעיטות ב' : 'kicks with your ')
    : (isHe ? 'עמידה על ' : 'stand on your '));

export function splitStartText(lp, isHe, mode = 'stand') {
  const { first } = splitLegOrder(lp);
  return isHe
    ? `מתחילים: ${action(mode, true)}${legLabel(first, lp, true)}. באמצע הסט נחליף רגל.`
    : `Start: ${action(mode, false)}${legLabel(first, lp, false)}. We switch legs halfway through the set.`;
}

export function splitSwitchText(lp, isHe, mode = 'stand') {
  const { second } = splitLegOrder(lp);
  return isHe
    ? `החלף רגל! עכשיו ${action(mode, true)}${legLabel(second, lp, true)}.`
    : `Switch legs! Now ${action(mode, false)}${legLabel(second, lp, false)}. Let's go!`;
}

/** The Ghost's working leg for this half: kicks → the kicking leg; stand → the other (lifted / free) leg. */
export function splitWorkingSide(lp, half, mode = 'stand') {
  const { first, second } = splitLegOrder(lp);
  const current = half === 1 ? first : second;
  return isStrikeMode(mode) ? current : liftedLeg(current);
}

// ---- Kicks / passes: a FULL set per leg (owner) — set 1 base leg, set 2 the other leg / prosthesis, … ----

/** Which leg (half 1 = base leg, 2 = the other) a set works in "a set per leg" mode. */
export const setLegHalf = (set) => (Number(set) % 2 === 1 ? 1 : 2);

/** Said at the start of a per-leg set. */
export function legSetStartText(lp, isHe, mode, set) {
  const half = setLegHalf(set);
  const { first, second } = splitLegOrder(lp);
  const leg = legLabel(half === 1 ? first : second, lp, isHe);
  if (isHe) {
    return half === 1
      ? `סט מלא: ${action(mode, true)}${leg}. בסט הבא מחליפים רגל.`
      : `החלפנו רגל! סט מלא: ${action(mode, true)}${leg}.`;
  }
  return half === 1
    ? `A full set: ${action(mode, false)}${leg}. Next set we switch legs.`
    : `Legs switched! A full set: ${action(mode, false)}${leg}. Let's go!`;
}

/** Said in the rest before the next per-leg set: the leg changes. */
export function legSetNextText(lp, isHe, mode, nextSet) {
  const half = setLegHalf(nextSet);
  const { first, second } = splitLegOrder(lp);
  const leg = legLabel(half === 1 ? first : second, lp, isHe);
  return isHe
    ? `בסט הבא מחליפים רגל: ${action(mode, true)}${leg}.`
    : `Next set we switch legs: ${action(mode, false)}${leg}.`;
}
