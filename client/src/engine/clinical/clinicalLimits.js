// ============================================================
// clinicalLimits — the clinician's limits for ONE patient, enforced (Stage 4B step 4, owner 2026-11-04)
//
// PURE. The clinician sets (server-written, the trainee reads only — users/{uid}/clinicalConstraints/current):
//   romLimits     { left_knee: 90, … }  the max range per joint-side (degrees — the same measure as rom.js:
//                 knee / hip / elbow = flexion, shoulder = elevation)
//   blockedJoints ['left_knee', …]      no exercise that moves this joint
//   blockedPatterns ['jumpSquat', …]    forbidden movements (catalog patterns)
//   expiresAt     ms | null
// Enforcement:
//   1. THE PLAN — a forbidden exercise is replaced by the nearest EASIER allowed version (complexity.js), else
//      removed; an exercise whose normal range passes a limit gets its PARTIAL-range version (the Ghost too).
//   2. LIVE — the joint angle 10×/s; a crossing = above the limit + 5° for 0.3 s (re-armed 3° under it);
//      every crossing → an immediate on-device alert; 3 crossings in a set → the workout ENDS and is LOCKED
//      until the clinician approves (clinicalLocks/current, written by the server).
// The strictest value always wins: a limit can only shrink what the exercise asks, never add to it.
// ============================================================

import { patternProfile, parseCatalogId, variationAxes, catalogItem, toExercise, canSplitLegs } from '../catalog/catalog.js';
import { easeExercise } from '../progress/complexity.js';
import { computeAngle } from '../KineticAnalyzer.js';
import { ROM_JOINTS } from '../progress/rom.js';

export const JOINT_KEYS = ['left_knee', 'right_knee', 'left_hip', 'right_hip', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'];
export const CROSS_TOLERANCE = 5;      // degrees above the limit
export const CROSS_HOLD_MS = 300;      // held this long (never one noisy frame)
export const REARM_BELOW = 3;          // back under the limit by this much → the next crossing can count
export const LOCK_AFTER = 3;           // crossings in one set → the workout ends + locks

/** The constraints in force now (null when none / expired). */
export function activeConstraints(doc, now = Date.now()) {
  if (!doc) return null;
  if (doc.expiresAt && Number(doc.expiresAt) < now) return null;
  const has = Object.keys(doc.romLimits || {}).length || (doc.blockedJoints || []).length || (doc.blockedPatterns || []).length;
  return has ? doc : null;
}

const flexOf = (joint, angle) => (joint === 'shoulder' ? angle : 180 - angle);

/** What a pattern asks of each joint (generic: 'knee' …): { knee: { least, most } } in the rom.js measure. */
export function patternDemand(patternId) {
  const prof = patternProfile(patternId);
  const out = {};
  for (const [j, def] of Object.entries(prof?.joints || {})) {
    if (!['knee', 'hip', 'elbow', 'shoulder'].includes(j)) continue;
    const band = def.peak || def.hold || null;
    if (!band) { out[j] = { least: null, most: null }; continue; }
    const a = flexOf(j, band[0]); const b = flexOf(j, band[1]);
    out[j] = { least: Math.min(a, b), most: Math.max(a, b) };
  }
  return out;
}

/** The strictest limit of a generic joint over both sides (a pattern moves both). */
function jointRule(c, joint) {
  const limits = ['left', 'right'].map(s => Number(c?.romLimits?.[`${s}_${joint}`])).filter(n => Number.isFinite(n) && n > 0);
  const blocked = (c?.blockedJoints || []).some(k => k.endsWith(`_${joint}`));
  return { limit: limits.length ? Math.min(...limits) : null, blocked };
}

/** One catalog exercise against the limits: 'ok' | 'partial' (needs the partial range) | 'blocked', and why. */
export function exerciseVerdict(catalogId, c) {
  const v = parseCatalogId(catalogId);
  if (!v || !c) return { verdict: 'ok' };
  if ((c.blockedPatterns || []).includes(v.pattern)) return { verdict: 'blocked', reason: 'pattern' };
  let partial = null;
  for (const [joint, d] of Object.entries(patternDemand(v.pattern))) {
    const r = jointRule(c, joint);
    if (r.blocked) return { verdict: 'blocked', reason: 'joint', joint };
    if (r.limit == null || d.least == null) continue;
    if (d.least > r.limit) return { verdict: 'blocked', reason: 'range', joint, limit: r.limit };
    if (d.most > r.limit) partial = { joint, limit: r.limit };
  }
  if (partial && v.range === 'full') return { verdict: 'partial', ...partial };
  return { verdict: 'ok' };
}

/**
 * Today's exercises under the clinician's limits. Returns { exercises, changes: [{ name, to, why }] }.
 * A non-catalog exercise (free AI) cannot be judged → kept, but the live monitor still guards it.
 */
export function applyClinicalLimits(exercises, c, lp = {}, isHe = true) {
  if (!c) return { exercises, changes: [] };
  const changes = [];
  const out = [];
  for (const ex of exercises || []) {
    if (!ex?.catalogId) { out.push(ex); continue; }
    let cur = ex;
    let verdict = exerciseVerdict(cur.catalogId, c);
    for (let i = 0; i < 6 && verdict.verdict === 'blocked'; i++) {
      const easier = easeExercise(cur, lp, isHe);
      if (!easier) break;
      cur = easier;
      verdict = exerciseVerdict(cur.catalogId, c);
    }
    if (verdict.verdict === 'blocked') { changes.push({ name: ex.name, to: null, why: verdict.reason }); continue; }
    if (verdict.verdict === 'partial') {
      const v = parseCatalogId(cur.catalogId);
      if (variationAxes(v.pattern).ranges.includes('partial')) {
        const id = [v.pattern, v.tempo, 'partial', v.side, v.dose].join('|');
        const built = toExercise(catalogItem(id), isHe, null, { canSplit: canSplitLegs(lp) });
        cur = { ...cur, ...built, name: cur.name, nameEn: cur.nameEn, sets: cur.sets, reps: cur.reps, restSeconds: cur.restSeconds };
      }
    }
    if (cur !== ex) changes.push({ name: ex.name, to: cur.name, why: verdict.verdict === 'partial' ? 'range' : 'easier' });
    out.push(cur === ex ? ex : { ...cur, clinical: { from: ex.name, why: verdict.verdict === 'partial' ? 'range' : 'easier' } });
  }
  return { exercises: out, changes };
}

/** The live monitor of the limited joints. update(landmarks, tMs) → a crossing { joint, value, limit } or null. */
export function createLimitMonitor(c) {
  const watched = Object.entries(c?.romLimits || {}).filter(([k, v]) => JOINT_KEYS.includes(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)]);
  const state = Object.fromEntries(watched.map(([k]) => [k, { over: null, armed: true }]));
  const seen = (p) => !!p && (p.visibility === undefined || p.visibility >= 0.6);
  return {
    active: watched.length > 0,
    update(lm, t) {
      if (!Array.isArray(lm)) return null;
      for (const [key, limit] of watched) {
        const [side, j] = key.split('_');
        const [a, b, cc] = ROM_JOINTS[j].sides[side].map(i => lm[i]);
        if (!seen(a) || !seen(b) || !seen(cc)) continue;
        const val = flexOf(j, computeAngle(a, b, cc));
        const s = state[key];
        if (val > limit + CROSS_TOLERANCE) {
          if (s.over == null) s.over = t;
          if (s.armed && t - s.over >= CROSS_HOLD_MS) { s.armed = false; return { joint: key, value: Math.round(val), limit }; }
        } else {
          s.over = null;
          if (val < limit - REARM_BELOW) s.armed = true;
        }
      }
      return null;
    },
  };
}
