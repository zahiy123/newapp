// ============================================================
// motionFeatures — the TEMPORAL side of the Expert Execution Profile (Stage 3.1)
//
// PURE LOGIC on a stream of raw landmarks (~20 Hz). A single frame / angle cannot tell
// how a movement FLOWS; this module follows the movement over time and emits events
// that profiles and the sport library judge:
//
//   repCount — the FAST rep count: fires mid-return of a real rep (reached ≥ 80% of the way to the
//              peak), so the count is heard immediately; re-arms only after returning to rest
//   rep      — a full rest → peak → rest cycle of the primary joint:
//              toPeakMs / peakHoldMs / returnMs (tempo), primaryPeak (depth reached), pelvisDropMax (hip stability),
//              swayRatio (center-of-mass wobble), trunkRange (trunk control)
//   landing  — a foot contact (running, jumps): absorptionDeg = knee flexion right after
//              contact (shock absorption), side, cadence (steps/min so far)
//   strike   — a kick / throw / punch: the distal joint of the profile's kinetic chain
//              reaches its peak speed; chainLeadMs = how long the proximal segment peaked
//              BEFORE it (proximal-to-distal sequencing), balance = center of mass vs. the
//              support foot (weight transfer), trunkLean at the strike
//   window   — once a second: swayRatio + pelvisDrop over the last seconds (holds, balance)
//
// Live values: cadence (steps/min), center of mass, pelvisDrop.
// Every distance is divided by the trainee's torso length → independent of the camera distance.
// ============================================================

import {
  P, jointAngleSide, sideUsable, centerOfMass, torsoLength, pelvisDrop, trunkLean,
} from './kinematics.js';
import { frameAspect } from '../../utils/motionEngine.js';

const HISTORY_MS = 3000;
const CADENCE_WINDOW_MS = 6000;
// Rep tempo thresholds on rep progress (0 = rest, 1 = peak)
const LEAVE = 0.1;
const ARRIVE = 0.9;
const PARTIAL_PROG = 0.3;         // a rep attempt that went this far toward the peak and turned back = a partial rep
const PARTIAL_MIN_MS = 300;
// Fast counting (the count is heard while the rep is still finishing, not after it):
// a rep counts the moment the return passes COUNT_AT after the movement reached COUNT_PEAK
const COUNT_ARM = 0.15;
const COUNT_PEAK = 0.8;
const COUNT_AT = 0.4;
// Foot contact (relative to torso length)
const FOOT_UP = 0.08;       // ankle this much above the floor line → foot in the air
const FOOT_DOWN = 0.03;     // back within this of the floor line → contact
const ABSORB_MS = 250;      // knee flexion measured in this window after contact
const CONTACT_LOOKBACK_MS = 100;   // touchdown knee = the straightest knee just before the contact sample
// Strike
const STRIKE_MIN_SPEED = 250;   // deg/s of the distal joint
const STRIKE_LOOKBACK_MS = 600;
const STRIKE_DEBOUNCE_MS = 600;
const PROX_MIN_SPEED = 120;      // deg/s: below this the proximal segment did not drive the strike

const SIDES = ['left', 'right'];
const ANKLE = { left: P.LEFT_ANKLE, right: P.RIGHT_ANKLE };

function std(vals) {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
}

/**
 * @param {Object} profile - execution profile (uses primary/joints, tags, chain)
 * @param {Object} [lp] - limbProfile
 */
export function createMotionState(profile, lp = {}) {
  const tags = new Set(profile?.tags || []);
  return {
    profile, lp,
    wantsContacts: tags.has('gait') || tags.has('landing'),
    chain: profile?.chain || null,
    hist: [],                               // { t, com, scale, ankles:{l,r}, knee:{l,r}, chain:{side:{metric:val}}, pelvis, lean }
    scale: null,
    rep: { stage: 'rest', leaveAt: null, arriveAt: null, departAt: null, startIdxT: null },
    feet: { left: { up: 0 }, right: { up: 0 } },
    pendingLandings: [],
    contacts: [],
    lastStrikeAt: -Infinity,
    footBase: { left: [], right: [] },      // the standing foot's toe drop (its own reference, per side)
    lastAnkle: { left: null, right: null },
    lastWindowAt: 0,
  };
}

function progressOf(profile, v) {
  const j = profile?.joints?.[profile.primary];
  if (!j?.peak || typeof v !== 'number') return null;
  const a = (j.rest[0] + j.rest[1]) / 2;
  const b = (j.peak[0] + j.peak[1]) / 2;
  if (Math.abs(b - a) < 1e-6) return null;
  return (v - a) / (b - a);
}

/** Speed (deg/s, signed by `dir`) of a per-side chain metric at history index i. */
function speedAt(hist, i, side, metric, dir) {
  const a = hist[i - 1], b = hist[i];
  const va = a?.chain?.[side]?.[metric], vb = b?.chain?.[side]?.[metric];
  if (typeof va !== 'number' || typeof vb !== 'number' || b.t <= a.t) return null;
  return dir * (vb - va) / ((b.t - a.t) / 1000);
}

/**
 * Feed one frame.
 * @param {Object} ms - motion state (createMotionState)
 * @param {Object[]|null} landmarks
 * @param {Object} metrics - the profile metrics of this frame (profileEvaluator.measureProfile)
 * @param {number} t - ms
 * @returns {{ events: Object[], live: { cadence: number|null, com: Object|null, pelvisDrop: number|null } }}
 */
/**
 * The CONTACT SURFACE of a kick / pass at the strike (owner, 2026-10-18: "an inside-foot pass hit with
 * the full instep, or a wrongly locked ankle — told with surgical precision"). Seen from the front:
 *   - the foot turned OUT (footOpen ≥ OPEN_FOOT): the inside of the foot faces the ball; its ankle angle
 *     (knee → ankle → toe, in the picture's plane) tells a LOCKED ankle (toes up, ≈ 90–120°) from a
 *     dropped / pointed one (> 140°)
 *   - the foot pointing at the camera (footOpen < CLOSED_FOOT): toes dropped well below the ankle
 *     (toeDrop ≥ LACES_DROP) = the laces / instep; toes level = a toe-poke
 *   - in between: not judged (honest — the picture cannot tell)
 * @returns {{ footOpen, ankleDeg, toeDrop, contactToe, contactLaces }} (null fields when not seen)
 */
export const OPEN_FOOT = 0.45, CLOSED_FOOT = 0.35, LACES_DROP = 0.18, TOE_DROP = 0.1;
export const LACES_DELTA = 0.12, TOE_DELTA = 0.04;   // toes pointed down vs. level, relative to the standing foot
export function strikeContact(landmarks, side, base = null) {
  const out = { footOpen: null, ankleDeg: null, toeDrop: null, contactToe: null, contactLaces: null };
  const [hip, knee, ankle, toe] = side === 'left' ? [23, 25, 27, 31] : [24, 26, 28, 32];
  const ok = (p) => p && (p.visibility ?? 1) >= 0.75;      // a contact verdict only on a clearly seen foot
  const H = landmarks?.[hip], K = landmarks?.[knee], A = landmarks?.[ankle], T = landmarks?.[toe];
  const open = footOpenness(landmarks, side);
  if (open === null || !ok(H) || !ok(A) || !ok(T)) return out;
  out.footOpen = open;
  const k = frameAspect();
  const leg = Math.hypot((A.x - H.x) * k, A.y - H.y);
  if (open >= OPEN_FOOT && ok(K)) {
    const v1 = { x: (K.x - A.x) * k, y: K.y - A.y }, v2 = { x: (T.x - A.x) * k, y: T.y - A.y };
    const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
    if (n1 > 1e-6 && n2 > 1e-6) out.ankleDeg = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)))) * 180 / Math.PI;
  }
  if (open < CLOSED_FOOT && leg > 1e-4) {
    out.toeDrop = (T.y - A.y) / leg;
    // judged RELATIVE to this trainee's own foot standing still (a camera above, looking down, shows a
    // flat foot's toes "lower" — field video 2026-10-19); with no standing reference: not judged
    if (typeof base === 'number') {
      const d = out.toeDrop - base;
      out.contactLaces = d >= LACES_DELTA ? 1 : 0;
      out.contactToe = d < TOE_DELTA ? 1 : 0;
    }
  }
  return out;
}

/** The standing foot's toe-drop reference (median of its still frames), or null before enough of them. */
export function footBaseOf(ms, side) {
  const b = ms?.footBase?.[side] || [];
  if (b.length < 8) return null;
  const v = [...b].sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)];
}

/**
 * How OPEN the kicking foot is at the strike (owner, 2026-10-18: "you kicked with the toes — open the
 * inside of the foot"): seen from the FRONT, an inside-foot pass turns the foot out, so the heel → toe
 * line lies across the picture; a toe-poke points the foot at the camera (a short line). The heel → toe
 * width in real proportions over the expected foot length (≈ 0.3 of the hip → ankle leg). null when
 * the foot points are not confidently seen.
 */
export function footOpenness(landmarks, side) {
  const [hip, ankle, heel, toe] = side === 'left' ? [23, 27, 29, 31] : [24, 28, 30, 32];
  const ok = (p) => p && (p.visibility ?? 1) >= 0.6;
  const H = landmarks?.[hip], A = landmarks?.[ankle], E = landmarks?.[heel], T = landmarks?.[toe];
  if (!ok(H) || !ok(A) || !ok(E) || !ok(T)) return null;
  const k = frameAspect();
  const leg = Math.hypot((A.x - H.x) * k, A.y - H.y);
  if (!(leg > 1e-4)) return null;
  return Math.abs(T.x - E.x) * k / (0.3 * leg);
}

export function updateMotion(ms, landmarks, metrics, t) {
  const events = [];
  if (!landmarks) return { events, live: { cadence: cadenceOf(ms, t), com: null, pelvisDrop: null } };

  const sc = torsoLength(landmarks);
  if (sc) ms.scale = ms.scale ? ms.scale * 0.9 + sc * 0.1 : sc;
  const scale = ms.scale || 0.25;
  const com = centerOfMass(landmarks);
  const pd = pelvisDrop(landmarks);

  // the trunk lean calibrated to this camera (profileEvaluator) when available
  const frame = { t, com, pelvis: pd, lean: typeof metrics?.__lean === 'number' ? metrics.__lean : trunkLean(landmarks), primary: metrics?.[ms.profile?.primary], ankles: {}, knee: {}, chain: {} };
  for (const s of SIDES) {
    const a = landmarks[ANKLE[s]];
    frame.ankles[s] = a && (a.visibility ?? 1) >= 0.5 && sideUsable('leg', s, ms.lp) ? a : null;
    frame.knee[s] = sideUsable('leg', s, ms.lp) ? jointAngleSide(landmarks, 'knee', s) : null;
    if (ms.chain) {
      frame.chain[s] = {};
      for (const c of ms.chain) {
        const limb = c.metric === 'elbow' || c.metric === 'shoulder' ? 'arm' : 'leg';
        frame.chain[s][c.metric] = sideUsable(limb, s, ms.lp) ? jointAngleSide(landmarks, c.metric, s) : null;
      }
    }
  }
  ms.hist.push(frame);
  // the standing foot's reference: while a foot is STILL, its toe drop (median of the recent still frames)
  for (const s of SIDES) {
    const a = frame.ankles[s], prev = ms.lastAnkle?.[s];
    if (a && prev && Math.hypot(a.x - prev.x, a.y - prev.y) < 0.004) {
      const c = strikeContact(landmarks, s);
      if (typeof c.toeDrop === 'number') { const b = ms.footBase[s]; b.push(c.toeDrop); if (b.length > 60) b.shift(); }
    }
    if (ms.lastAnkle) ms.lastAnkle[s] = a ? { x: a.x, y: a.y } : null;
  }
  while (ms.hist.length && t - ms.hist[0].t > HISTORY_MS) ms.hist.shift();

  // ---- 1. Rep tempo + per-rep control ----
  const prog = progressOf(ms.profile, metrics?.[ms.profile?.primary]);
  if (prog !== null) {
    // 1a. Fast count: 'repCount' fires mid-return (the full-cycle 'rep' below keeps the tempo)
    const c = ms.count || (ms.count = { stage: 'ready', leaveAt: null, peakAt: null, departAt: null });
    if (c.stage === 'ready' && prog > COUNT_ARM) { c.stage = 'going'; c.leaveAt = t; }
    else if (c.stage === 'going' && prog >= COUNT_PEAK) { c.stage = 'peak'; c.peakAt = t; }
    else if (c.stage === 'going' && prog <= COUNT_ARM * 0.5) { c.stage = 'ready'; }          // aborted
    else if (c.stage === 'peak' && prog < COUNT_PEAK) { c.stage = 'returning'; c.departAt = t; }
    else if (c.stage === 'returning' && prog >= COUNT_PEAK) { c.stage = 'peak'; }            // still at the bottom
    else if (c.stage === 'returning' && prog <= COUNT_AT) {
      events.push({ type: 'repCount', toPeakMs: c.peakAt - c.leaveAt, returnMs: t - c.departAt });
      c.stage = 'counted';
    } else if (c.stage === 'counted' && prog <= COUNT_ARM) { c.stage = 'ready'; }
    const r = ms.rep;
    if (r.stage === 'going') r.maxProg = Math.max(r.maxProg || 0, prog);
    if (r.stage === 'rest' && prog > LEAVE) { r.stage = 'going'; r.leaveAt = t; r.maxProg = prog; }
    else if (r.stage === 'going' && prog >= ARRIVE) { r.stage = 'peak'; r.arriveAt = t; }
    else if (r.stage === 'going' && prog <= LEAVE * 0.5) {
      // a rep that turned back BEFORE the target (a shallow squat / a half push-up): never counted —
      // reported, so the coach tells WHY it did not count ("go deeper") instead of staying silent
      if ((r.maxProg || 0) >= PARTIAL_PROG && t - r.leaveAt >= PARTIAL_MIN_MS) {
        const prims = ms.hist.filter(f => f.t >= r.leaveAt).map(f => f.primary).filter(v => typeof v === 'number');
        const j = ms.profile.joints[ms.profile.primary];
        const down = (j.peak[0] + j.peak[1]) < (j.rest[0] + j.rest[1]);
        events.push({ type: 'partialRep', reached: r.maxProg, primaryPeak: prims.length ? (down ? Math.min(...prims) : Math.max(...prims)) : null });
      }
      r.stage = 'rest';
    }
    else if (r.stage === 'peak' && prog < ARRIVE) { r.stage = 'returning'; r.departAt = t; }
    else if (r.stage === 'returning' && prog <= LEAVE) {
      const during = ms.hist.filter(f => f.t >= r.leaveAt);
      const drops = during.map(f => f.pelvis).filter(v => typeof v === 'number');
      const leans = during.map(f => f.lean).filter(v => typeof v === 'number');
      const prims = during.map(f => f.primary).filter(v => typeof v === 'number');
      const j = ms.profile.joints[ms.profile.primary];
      const towardPeakIsDown = (j.peak[0] + j.peak[1]) < (j.rest[0] + j.rest[1]);
      events.push({
        type: 'rep',
        toPeakMs: r.arriveAt - r.leaveAt,
        peakHoldMs: r.departAt - r.arriveAt,
        returnMs: t - r.departAt,
        pelvisDropMax: drops.length ? Math.max(...drops) : null,
        swayRatio: std(during.map(f => f.com?.x).filter(v => typeof v === 'number')) * frameAspect() / scale,
        trunkRange: leans.length ? Math.max(...leans) - Math.min(...leans) : null,
        // the deepest point of the rep toward the peak (e.g. the highest knee drive)
        primaryPeak: prims.length ? (towardPeakIsDown ? Math.min(...prims) : Math.max(...prims)) : null,
      });
      r.stage = 'rest';
    }
  }

  // ---- 2. Foot contacts → landing / shock absorption + cadence ----
  if (ms.wantsContacts) {
    const ys = ms.hist.flatMap(f => SIDES.map(s => f.ankles[s]?.y)).filter(v => typeof v === 'number');
    const floor = ys.length ? Math.max(...ys) : null;
    for (const s of SIDES) {
      const a = frame.ankles[s];
      if (!a || floor === null) continue;
      const foot = ms.feet[s];
      if (a.y < floor - FOOT_UP * scale) foot.up += 1;
      else if (a.y >= floor - FOOT_DOWN * scale) {
        if (foot.up >= 2) {
          ms.contacts.push(t);
          // The knee is (nearly) straight at touchdown: take the straightest knee of the last
          // ~100 ms, so a contact sampled a little late (20 Hz) does not hide the absorption
          const before = ms.hist.filter(f => t - f.t <= CONTACT_LOOKBACK_MS).map(f => f.knee[s]).filter(v => typeof v === 'number');
          if (before.length) ms.pendingLandings.push({ side: s, t, kneeAtContact: Math.max(...before) });
        }
        foot.up = 0;
      }
    }
    while (ms.contacts.length && t - ms.contacts[0] > CADENCE_WINDOW_MS) ms.contacts.shift();
    ms.pendingLandings = ms.pendingLandings.filter((pl) => {
      if (t - pl.t < ABSORB_MS) return true;
      const knees = ms.hist.filter(f => f.t >= pl.t && f.t <= pl.t + ABSORB_MS).map(f => f.knee[pl.side]).filter(v => typeof v === 'number');
      events.push({ type: 'landing', side: pl.side, absorptionDeg: knees.length ? pl.kneeAtContact - Math.min(...knees) : 0, cadence: cadenceOf(ms, t) });
      return false;
    });
  }

  // ---- 3. Strike: proximal-to-distal sequencing + weight transfer ----
  if (ms.chain && ms.chain.length >= 2 && ms.hist.length >= 3 && t - ms.lastStrikeAt > STRIKE_DEBOUNCE_MS) {
    const distal = ms.chain[ms.chain.length - 1];
    const proximal = ms.chain[0];
    const n = ms.hist.length;
    for (const s of SIDES) {
      // Peak of the distal speed = it was rising and now falls, above the strike threshold
      const v0 = speedAt(ms.hist, n - 2, s, distal.metric, distal.dir);
      const v1 = speedAt(ms.hist, n - 1, s, distal.metric, distal.dir);
      if (v0 === null || v1 === null || v0 < STRIKE_MIN_SPEED || v1 >= v0) continue;
      const tDistal = ms.hist[n - 2].t;
      let best = -Infinity, tProx = null;
      for (let i = 1; i < n - 1; i++) {
        if (tDistal - ms.hist[i].t > STRIKE_LOOKBACK_MS) continue;
        const v = speedAt(ms.hist, i, s, proximal.metric, proximal.dir);
        if (v !== null && v > best) { best = v; tProx = ms.hist[i].t; }
      }
      const other = s === 'left' ? 'right' : 'left';
      const plant = ms.hist[n - 2].ankles[other];
      const c = ms.hist[n - 2].com;
      events.push({
        type: 'strike',
        side: s,
        // No real proximal drive before the distal peak (e.g. a knee-only kick) → lead 0
        chainLeadMs: tProx === null || best < PROX_MIN_SPEED ? 0 : tDistal - tProx,
        distalSpeed: v0,
        balance: plant && c ? Math.abs(c.x - plant.x) * frameAspect() / scale : null,
        trunkLean: ms.hist[n - 2].lean,
        ...strikeContact(landmarks, s, footBaseOf(ms, s)),   // footOpen, ankleDeg, toeDrop, contactToe, contactLaces
      });
      ms.lastStrikeAt = t;
      break;
    }
  }

  // ---- 4. Window (holds, balance) ----
  if (t - ms.lastWindowAt >= 1000 && ms.hist.length >= 10) {
    ms.lastWindowAt = t;
    const drops = ms.hist.map(f => f.pelvis).filter(v => typeof v === 'number');
    events.push({
      type: 'window',
      swayRatio: std(ms.hist.map(f => f.com?.x).filter(v => typeof v === 'number')) * frameAspect() / scale,
      pelvisDrop: drops.length ? Math.max(...drops) : null,
    });
  }

  return { events, live: { cadence: cadenceOf(ms, t), com, pelvisDrop: pd } };
}

/** Steps per minute over the cadence window (null until 4 contacts were seen). */
export function cadenceOf(ms, t) {
  const recent = ms.contacts.filter(c => t - c <= CADENCE_WINDOW_MS);
  if (recent.length < 4) return null;
  const span = recent[recent.length - 1] - recent[0];
  return span > 0 ? Math.round(((recent.length - 1) / span) * 60000) : null;
}
