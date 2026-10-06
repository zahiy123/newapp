// ============================================================
// limbProfile — one unified view of each limb, built from the scan
//
// PURE LOGIC — no React, no DOM.
//
// The scan saves limb information in several places depending on the
// path taken and the app version. This module merges them, in order of
// precision:
//   1. visionDiagnosis.limbs      — per-limb vision result (status + level)
//   2. scanData.limbStatus        — CertaintyGate verdicts (full scan path)
//   3. classification + side      — scanData / visionDiagnosis
//   4. legacy profile fields      — disability / amputationSide / amputationLevel
// Arms are refined with the per-arm measurement (scanData.armAssessment).
//
// Output per limb:
//   { state: 'ok'|'limited'|'prosthetic'|'absent'|'no_movement'|'unknown',
//     level: 'below_knee'|'above_knee'|'below_elbow'|'above_elbow'|null,
//     trainable: boolean,          // may be instructed to move (Iron Rule)
//     romCapDeg: number|null }     // arms: measured max shoulder angle
// ============================================================

export const LIMBS = ['left_leg', 'right_leg', 'left_arm', 'right_arm'];

/**
 * The limbs AS THEY TRAIN (owner safety rule, 2026-10-06): a trainee who moves on CRUTCHES trains
 * without a prosthesis — the prosthetic leg is treated as absent (no standing on it, no balance
 * split onto it, no prosthesis drawn in the Ghost). Only a trainee with an ACTIVE prosthesis (no
 * crutches) works on it. Everything that plans or demonstrates training uses this view.
 */
export function trainingLimbs(lp) {
  if (!lp || !lp.crutches) return lp;
  const out = { ...lp, trainsOnCrutches: true };
  for (const k of ['left_leg', 'right_leg']) {
    if (lp[k]?.state === 'prosthetic') out[k] = { ...lp[k], state: 'absent', trainable: false, prosthesisOffForTraining: true };
  }
  return out;
}

// A healthy shoulder reaches ~150-180° in the frontal 2D estimate
const LIMITED_SHOULDER_DEG = 140;

const blank = () => ({ state: 'ok', level: null, trainable: true, romCapDeg: null });

function setAffected(limb, kind, level) {
  limb.state = kind;                       // 'prosthetic' | 'absent'
  limb.level = level || limb.level || null;
  // A below-knee prosthesis still has a working knee/hip; above-knee or absent → not trainable
  limb.trainable = kind === 'prosthetic' && (limb.level === 'below_knee' || limb.level === 'below_elbow');
}

function fromLimbStatus(limb, status) {
  switch (status) {
    case 'prosthetic_below_knee': setAffected(limb, 'prosthetic', 'below_knee'); break;
    case 'prosthetic_above_knee': setAffected(limb, 'prosthetic', 'above_knee'); break;
    case 'prosthetic_below_elbow': setAffected(limb, 'prosthetic', 'below_elbow'); break;
    case 'prosthetic_above_elbow': setAffected(limb, 'prosthetic', 'above_elbow'); break;
    case 'absent': setAffected(limb, 'absent', null); break;
    case 'anatomical_weak': limb.state = 'limited'; break;
    default: break; // healthy / unresolved → keep
  }
}

/**
 * @param {Object} profile - Firestore user profile
 * @returns {{ left_leg, right_leg, left_arm, right_arm, wheelchair: boolean, crutches: boolean,
 *            affectedLegs: string[], trainableArms: string[] }}
 */
export function getLimbProfile(profile) {
  const p = profile || {};
  const scan = p.scanData || {};
  const vision = p.visionDiagnosis || {};
  const limbs = Object.fromEntries(LIMBS.map(k => [k, blank()]));
  let resolved = false;

  // 1. Per-limb vision result
  if (vision.limbs && typeof vision.limbs === 'object') {
    for (const k of LIMBS) {
      const v = vision.limbs[k];
      if (!v) continue;
      if (v.status === 'prosthetic' || v.status === 'absent') { setAffected(limbs[k], v.status, v.level); resolved = true; }
      else if (v.status === 'intact') resolved = true;
    }
  }

  // 2. CertaintyGate limb status
  if (!resolved && scan.limbStatus && Object.keys(scan.limbStatus).length > 0) {
    for (const k of LIMBS) fromLimbStatus(limbs[k], scan.limbStatus[k]?.status);
    resolved = true;
  }

  // 3. Classification + side
  const classification = vision.classification || scan.classification;
  const side = (vision.prostheticSide || scan.prostheticSide || '').toLowerCase();
  if (!resolved && classification) {
    const legLevel = classification === 'TRANSFEMORAL_AMPUTEE' ? 'above_knee' : 'below_knee';
    if ((classification === 'TRANSTIBIAL_AMPUTEE' || classification === 'TRANSFEMORAL_AMPUTEE') && (side === 'left' || side === 'right')) {
      setAffected(limbs[`${side}_leg`], 'prosthetic', legLevel);
      resolved = true;
    } else if (classification === 'BILATERAL_AMPUTEE') {
      setAffected(limbs.left_leg, 'prosthetic', 'below_knee');
      setAffected(limbs.right_leg, 'prosthetic', 'below_knee');
      resolved = true;
    } else if (classification === 'ARM_AMPUTEE' && (side === 'left' || side === 'right')) {
      setAffected(limbs[`${side}_arm`], 'absent', null);
      resolved = true;
    } else if (classification === 'NATURAL') {
      resolved = true;
    }
  }

  // 4. Legacy profile fields
  if (!resolved) {
    const s = p.amputationSide === 'left' || p.amputationSide === 'right' ? p.amputationSide : null;
    if (p.disability === 'one_leg' && s) {
      setAffected(limbs[`${s}_leg`], 'prosthetic', p.amputationLevel || 'below_knee');
    } else if (p.disability === 'one_arm' && s) {
      setAffected(limbs[`${s}_arm`], 'absent', null);
    } else if (p.disability === 'two_legs') {
      setAffected(limbs.left_leg, 'absent', null);
      setAffected(limbs.right_leg, 'absent', null);
    }
  }

  // Arms: refine with the per-arm measurement (only arms not already known to be absent/prosthetic)
  const arms = scan.armAssessment || {};
  for (const side of ['left', 'right']) {
    const limb = limbs[`${side}_arm`];
    const a = arms[`${side}_arm`];
    if (!a || limb.state === 'absent' || limb.state === 'prosthetic') continue;
    if (a.status === 'no_movement') {
      limb.state = 'no_movement';
      limb.trainable = false;
    } else if (a.status === 'assessed') {
      const peaks = [a.shoulderFlexionDeg, a.shoulderAbductionDeg].filter(v => typeof v === 'number');
      if (peaks.length > 0) {
        const cap = Math.min(...peaks);
        if (cap < LIMITED_SHOULDER_DEG) {
          limb.state = 'limited';
          limb.romCapDeg = Math.round(cap);
        }
      }
    }
  }

  const aids = [...(vision.aids || []), ...(scan.aids || [])].map(a => String(a).toLowerCase());
  const wheelchair = p.mobilityAid === 'wheelchair' || classification === 'WHEELCHAIR' || aids.includes('wheelchair');
  const crutches = p.mobilityAid === 'crutches' || aids.includes('crutches');

  return {
    ...limbs,
    wheelchair,
    crutches,
    affectedLegs: ['left_leg', 'right_leg'].filter(k => limbs[k].state === 'prosthetic' || limbs[k].state === 'absent'),
    trainableArms: ['left_arm', 'right_arm'].filter(k => limbs[k].trainable),
  };
}
