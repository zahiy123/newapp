// ============================================================
// intent — Layer 2 of the coach brain: MOVEMENT INTENT RECOGNITION (owner, 2026-10-14)
//
// PURE. The coach understands what the trainee is TRYING to do from a SEQUENCE of frames, not one:
//   strikeIntent   a kick's whole arc — backswing (how far the knee folds back), the strike speed
//                  and the follow-through (how high the foot travels after contact) → a POWER kick
//                  or a PRECISE pass (or mixed). A pass drill done as a power kick (or the other way
//                  round) is told — that is a different skill.
//   errorForecast  an error that is BUILDING over the recent attempts (in 2 of the last 4, and more
//                  often lately) is predicted and cued BEFORE the next attempt — the coach speaks
//                  ahead of the mistake, not after it.
// The angles use the camera's real proportions (motionEngine).
// ============================================================

import { angleCosine } from '../../utils/motionEngine.js';

const WINDOW_MS = 1500;              // the frames kept (a whole kick fits)
const BACKSWING_MS = 650;            // before the strike
const FOLLOW_MS = 450;               // after the strike
const LEG = { left: [23, 25, 27], right: [24, 26, 28] };
const vis = (p) => p && (p.visibility ?? 1) >= 0.5;

/** A rolling window of the legs, for one exercise. */
export function createIntentWindow() {
  return { frames: [], pending: [] };
}

/** Keep this frame (normalized landmarks). */
export function intentFrame(w, lm, t) {
  if (!w || !lm) return w;
  const f = { t };
  for (const [s, [h, k, a]] of Object.entries(LEG)) {
    if (vis(lm[h]) && vis(lm[k]) && vis(lm[a])) {
      f[s] = { knee: angleCosine(lm[h], lm[k], lm[a]), footAboveHip: lm[h].y - lm[a].y, hipY: lm[h].y, ankleY: lm[a].y };
    }
  }
  const sh = [lm[11], lm[12]].filter(vis), an = [lm[27], lm[28]].filter(vis);
  if (sh.length && an.length) f.bodyH = Math.max(0.05, Math.max(...an.map(p => p.y)) - Math.min(...sh.map(p => p.y)));
  w.frames.push(f);
  while (w.frames.length && t - w.frames[0].t > WINDOW_MS) w.frames.shift();
  return w;
}

/** A strike happened: judge it once its follow-through is in (FOLLOW_MS later). */
export function intentStrike(w, ev, t) {
  if (w && ev?.type === 'strike' && (ev.side === 'left' || ev.side === 'right')) w.pending.push({ side: ev.side, t, speed: ev.distalSpeed ?? null });
  return w;
}

/**
 * The kicks whose arc is now complete → their intent.
 * @returns {Array<{ side, intent: 'power'|'precision'|'mixed', power: number, backswingDeg, followThrough, speed }>}
 */
export function intentResolve(w, now) {
  if (!w) return [];
  const out = [];
  w.pending = w.pending.filter((p) => {
    if (now - p.t < FOLLOW_MS) return true;
    const r = strikeIntent(w.frames, p);
    if (r) out.push(r);
    return false;
  });
  return out;
}

/**
 * The intent of one kick from its frames.
 *   backswing: 180° − the most folded knee before the strike (a big fold = a big wind-up)
 *   follow-through: the highest the foot gets after the strike, in body heights above its rest
 *   speed: the strike's distal knee speed, deg/s (the evaluator's event; a strike starts at 250)
 * power = 0.4 · backswing + 0.35 · follow-through + 0.25 · speed (each normalized 0..1)
 */
export function strikeIntent(frames, p) {
  const side = p.side;
  const before = frames.filter(f => f[side] && f.t <= p.t && p.t - f.t <= BACKSWING_MS);
  const after = frames.filter(f => f[side] && f.t >= p.t && f.t - p.t <= FOLLOW_MS);
  if (before.length < 3 || after.length < 2) return null;
  const backswingDeg = 180 - Math.min(...before.map(f => f[side].knee));
  const bodyH = frames.find(f => f.bodyH)?.bodyH || 0.5;
  const restAnkle = Math.max(...before.map(f => f[side].ankleY));
  const followThrough = Math.max(0, (restAnkle - Math.min(...after.map(f => f[side].ankleY))) / bodyH);
  const n = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const power = 0.4 * n(backswingDeg, 40, 110) + 0.35 * n(followThrough, 0.05, 0.35)
    + 0.25 * (typeof p.speed === 'number' ? n(p.speed, 250, 900) : 0.5);
  const intent = power >= 0.58 ? 'power' : power <= 0.42 ? 'precision' : 'mixed';
  return { side, intent, power: Math.round(power * 100) / 100, backswingDeg: Math.round(backswingDeg), followThrough: Math.round(followThrough * 100) / 100, speed: p.speed };
}

/** What the drill asks for, from the drill kind / name: 'power' | 'precision' | null. */
export function drillIntent(kind, name = '') {
  const s = `${kind || ''} ${name || ''}`.toLowerCase();
  if (/מסיר|מסור|pass|דיוק|precision|שליטה/.test(s)) return 'precision';
  if (/עוצמ|חזק|power|shot|בעיטה לשער|שער/.test(s)) return 'power';
  return null;
}

/** The coach's line when the kick's intent does not match the drill (or null). */
export function intentFeedback(wanted, got) {
  if (!wanted || !got || got.intent === 'mixed' || got.intent === wanted) return null;
  return wanted === 'precision'
    ? { id: 'intentPowerInPass', he: 'זו הייתה בעיטת עוצמה — במסירה: תנופה קצרה, פנים כף הרגל, ומלווים את הכדור למטרה', en: 'That was a power kick — for a pass: a short swing, the inside of the foot, and follow the ball to the target' }
    : { id: 'intentSoftInShot', he: 'זו הייתה מסירה רכה — לבעיטה חזקה: תנופה מלאה מהירך, ונועלים את הקרסול', en: 'That was a soft pass — for a power kick: a full swing from the hip, and lock the ankle' };
}

// ---------------- error forecasting ----------------

/** A rolling record of which error showed in each recent attempt. */
export function createForecast() { return { attempts: [] }; }

/** One attempt: the error ids seen in it (empty = clean). */
export function forecastAttempt(fc, errorIds) {
  if (!fc) return fc;
  fc.attempts.push(new Set(errorIds || []));
  if (fc.attempts.length > 8) fc.attempts.shift();
  return fc;
}

/**
 * The error that is BUILDING (likely in the next attempt): seen in ≥ 2 of the last 4 attempts AND at
 * least as often in the last 2 as in the 2 before. Returns its id, or null.
 */
export function forecastNext(fc) {
  const at = fc?.attempts || [];
  if (at.length < 3) return null;
  const last4 = at.slice(-4), last2 = at.slice(-2), prev2 = at.slice(-4, -2);
  const ids = new Set(last4.flatMap(s => [...s]));
  let best = null, bestN = 0;
  for (const id of ids) {
    const n4 = last4.filter(s => s.has(id)).length;
    const n2 = last2.filter(s => s.has(id)).length, p2 = prev2.filter(s => s.has(id)).length;
    if (n4 >= 2 && n2 >= 1 && n2 >= p2 && n4 > bestN) { best = id; bestN = n4; }
  }
  return best;
}
