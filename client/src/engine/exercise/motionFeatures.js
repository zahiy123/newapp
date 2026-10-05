// ============================================================
// motionFeatures — the TEMPORAL side of the Expert Execution Profile (Stage 3.1)
//
// PURE LOGIC on a stream of raw landmarks (~20 Hz). A single frame / angle cannot tell
// how a movement FLOWS; this module follows the movement over time and emits events
// that profiles and the sport library judge:
//
//   rep      — a full rest → peak → rest cycle of the primary joint:
//              toPeakMs / peakHoldMs / returnMs (tempo), pelvisDropMax (hip stability),
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

const HISTORY_MS = 3000;
const CADENCE_WINDOW_MS = 6000;
// Rep tempo thresholds on rep progress (0 = rest, 1 = peak)
const LEAVE = 0.1;
const ARRIVE = 0.9;
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
export function updateMotion(ms, landmarks, metrics, t) {
  const events = [];
  if (!landmarks) return { events, live: { cadence: cadenceOf(ms, t), com: null, pelvisDrop: null } };

  const sc = torsoLength(landmarks);
  if (sc) ms.scale = ms.scale ? ms.scale * 0.9 + sc * 0.1 : sc;
  const scale = ms.scale || 0.25;
  const com = centerOfMass(landmarks);
  const pd = pelvisDrop(landmarks);

  const frame = { t, com, pelvis: pd, lean: trunkLean(landmarks), ankles: {}, knee: {}, chain: {} };
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
  while (ms.hist.length && t - ms.hist[0].t > HISTORY_MS) ms.hist.shift();

  // ---- 1. Rep tempo + per-rep control ----
  const prog = progressOf(ms.profile, metrics?.[ms.profile?.primary]);
  if (prog !== null) {
    const r = ms.rep;
    if (r.stage === 'rest' && prog > LEAVE) { r.stage = 'going'; r.leaveAt = t; }
    else if (r.stage === 'going' && prog >= ARRIVE) { r.stage = 'peak'; r.arriveAt = t; }
    else if (r.stage === 'going' && prog <= LEAVE * 0.5) { r.stage = 'rest'; }            // aborted rep
    else if (r.stage === 'peak' && prog < ARRIVE) { r.stage = 'returning'; r.departAt = t; }
    else if (r.stage === 'returning' && prog <= LEAVE) {
      const during = ms.hist.filter(f => f.t >= r.leaveAt);
      const drops = during.map(f => f.pelvis).filter(v => typeof v === 'number');
      const leans = during.map(f => f.lean).filter(v => typeof v === 'number');
      events.push({
        type: 'rep',
        toPeakMs: r.arriveAt - r.leaveAt,
        peakHoldMs: r.departAt - r.arriveAt,
        returnMs: t - r.departAt,
        pelvisDropMax: drops.length ? Math.max(...drops) : null,
        swayRatio: std(during.map(f => f.com?.x).filter(v => typeof v === 'number')) / scale,
        trunkRange: leans.length ? Math.max(...leans) - Math.min(...leans) : null,
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
        balance: plant && c ? Math.abs(c.x - plant.x) / scale : null,
        trunkLean: ms.hist[n - 2].lean,
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
      swayRatio: std(ms.hist.map(f => f.com?.x).filter(v => typeof v === 'number')) / scale,
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
