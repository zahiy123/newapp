// ============================================================
// anatomyDiagnosis — deterministic diagnosis from per-limb vision output
//
// PURE LOGIC — no I/O.
//
// The vision model reports each limb separately (status + the visual
// evidence it saw). Classification, side and the user-facing summary are
// DERIVED here, deterministically — never taken from the model's free text —
// so the summary can't contradict itself or invent limbs:
//   - a limb counts as affected ONLY with concrete visual evidence
//   - side comes from which limb is affected (no separate "side" guess)
//   - the Hebrew/English summary is generated from the per-limb data
// ============================================================

export const LIMB_KEYS = ['left_leg', 'right_leg', 'left_arm', 'right_arm'];

const STATUSES = new Set(['intact', 'prosthetic', 'absent', 'unclear']);
const LEG_LEVELS = new Set(['below_knee', 'above_knee']);
const ARM_LEVELS = new Set(['below_elbow', 'above_elbow']);
const AIDS = new Set(['crutches', 'cane', 'walker', 'wheelchair']);
// Evidence shorter than this is not a real description → the limb is "unclear"
const MIN_EVIDENCE_CHARS = 8;

const LIMB_HE = { left_leg: 'רגל שמאל', right_leg: 'רגל ימין', left_arm: 'יד שמאל', right_arm: 'יד ימין' };
const LIMB_EN = { left_leg: 'left leg', right_leg: 'right leg', left_arm: 'left arm', right_arm: 'right arm' };
const LEVEL_HE = { below_knee: 'מתחת לברך', above_knee: 'מעל הברך', below_elbow: 'מתחת למרפק', above_elbow: 'מעל המרפק' };
const LEVEL_EN = { below_knee: 'below the knee', above_knee: 'above the knee', below_elbow: 'below the elbow', above_elbow: 'above the elbow' };
const AID_HE = { crutches: 'קביים', cane: 'מקל הליכה', walker: 'הליכון', wheelchair: 'כיסא גלגלים' };

const isAffected = (limb) => limb.status === 'prosthetic' || limb.status === 'absent';

/** Normalize one limb from the model output. Affected without evidence → unclear. */
function normalizeLimb(key, raw) {
  const isLeg = key.endsWith('_leg');
  let status = typeof raw?.status === 'string' ? raw.status.toLowerCase() : 'unclear';
  if (!STATUSES.has(status)) status = 'unclear';
  const evidence = typeof raw?.evidence === 'string' ? raw.evidence.trim().slice(0, 300) : '';
  let level = typeof raw?.level === 'string' ? raw.level.toLowerCase() : null;
  if (level && !(isLeg ? LEG_LEVELS : ARM_LEVELS).has(level)) level = null;

  if ((status === 'prosthetic' || status === 'absent') && evidence.length < MIN_EVIDENCE_CHARS) {
    return { status: 'unclear', level: null, evidence: '', downgraded: true };
  }
  if (!(status === 'prosthetic' || status === 'absent')) level = null;
  return { status, level, evidence };
}

function describeLimbHe(key, limb) {
  const level = limb.level ? ` ${LEVEL_HE[limb.level]}` : '';
  if (limb.status === 'prosthetic') return `${LIMB_HE[key]}: קטיעה${level} עם פרוטזה`;
  return `${LIMB_HE[key]}: קטיעה${level} (ללא פרוטזה)`;
}

function describeLimbEn(key, limb) {
  const level = limb.level ? ` ${LEVEL_EN[limb.level]}` : '';
  if (limb.status === 'prosthetic') return `${LIMB_EN[key]}: amputation${level} with a prosthesis`;
  return `${LIMB_EN[key]}: amputation${level} (no prosthesis)`;
}

/**
 * Build the final diagnosis from the raw vision-model JSON.
 *
 * @param {Object} raw - model output: { limbs: { left_leg: {status, level, evidence}, ... },
 *   wheelchair, aids, medicalLimitation, confidence, notes }
 * @returns {Object} diagnosis in the shape the client expects
 *   { classification, adaptedTrack, prostheticSide, aids, mobilityAid, confidence,
 *     description, description_he, specialProtocol, limbs }
 */
export function normalizeAnatomyDiagnosis(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const limbs = {};
  for (const key of LIMB_KEYS) limbs[key] = normalizeLimb(key, src.limbs?.[key]);

  const aids = Array.isArray(src.aids)
    ? [...new Set(src.aids.map(a => String(a).toLowerCase()).filter(a => AIDS.has(a)))]
    : [];
  const wheelchair = src.wheelchair === true || aids.includes('wheelchair');
  const affectedLegs = ['left_leg', 'right_leg'].filter(k => isAffected(limbs[k]));
  const affectedArms = ['left_arm', 'right_arm'].filter(k => isAffected(limbs[k]));
  const medical = typeof src.medicalLimitation === 'string' && src.medicalLimitation.trim().length >= MIN_EVIDENCE_CHARS
    ? src.medicalLimitation.trim().slice(0, 300) : null;

  let classification = 'NATURAL';
  let prostheticSide = null;
  if (wheelchair) {
    classification = 'WHEELCHAIR';
  } else if (affectedLegs.length === 2) {
    classification = 'BILATERAL_AMPUTEE';
    prostheticSide = 'bilateral';
  } else if (affectedLegs.length === 1) {
    const leg = limbs[affectedLegs[0]];
    classification = leg.level === 'above_knee' ? 'TRANSFEMORAL_AMPUTEE' : 'TRANSTIBIAL_AMPUTEE';
    prostheticSide = affectedLegs[0].startsWith('left') ? 'left' : 'right';
  } else if (affectedArms.length > 0) {
    classification = 'ARM_AMPUTEE';
    prostheticSide = affectedArms.length === 2 ? 'bilateral' : (affectedArms[0].startsWith('left') ? 'left' : 'right');
  } else if (medical) {
    classification = 'MEDICAL';
  }

  // ---- Deterministic summary ----
  const affectedKeys = LIMB_KEYS.filter(k => isAffected(limbs[k]));
  const unclearKeys = LIMB_KEYS.filter(k => limbs[k].status === 'unclear');
  const he = [];
  const en = [];
  if (wheelchair) { he.push('זוהה שימוש בכיסא גלגלים.'); en.push('Wheelchair use detected.'); }
  if (affectedKeys.length > 0) {
    he.push(`${affectedKeys.map(k => describeLimbHe(k, limbs[k])).join('; ')}.`);
    en.push(`${affectedKeys.map(k => describeLimbEn(k, limbs[k])).join('; ')}.`);
    const intact = LIMB_KEYS.filter(k => limbs[k].status === 'intact');
    if (intact.length > 0) {
      he.push(`תקינות: ${intact.map(k => LIMB_HE[k]).join(', ')}.`);
      en.push(`Intact: ${intact.map(k => LIMB_EN[k]).join(', ')}.`);
    }
  } else if (!wheelchair) {
    he.push(unclearKeys.length === LIMB_KEYS.length
      ? 'לא ניתן היה לראות את הגפיים בבירור.'
      : 'לא זוהו קטיעות או פרוטזות.');
    en.push(unclearKeys.length === LIMB_KEYS.length
      ? 'The limbs could not be seen clearly.'
      : 'No amputation or prosthesis detected.');
  }
  if (medical) { he.push('זוהתה מגבלת תנועה.'); en.push(`Movement limitation: ${medical}.`); }
  if (unclearKeys.length > 0 && unclearKeys.length < LIMB_KEYS.length) {
    he.push(`לא נראו בבירור: ${unclearKeys.map(k => LIMB_HE[k]).join(', ')}.`);
    en.push(`Not clearly visible: ${unclearKeys.map(k => LIMB_EN[k]).join(', ')}.`);
  }
  const walkingAids = aids.filter(a => a !== 'wheelchair');
  if (walkingAids.length > 0) {
    he.push(`עזרי ניידות: ${walkingAids.map(a => AID_HE[a]).join(', ')}.`);
    en.push(`Mobility aids: ${walkingAids.join(', ')}.`);
  }

  let confidence = typeof src.confidence === 'number' ? Math.max(0, Math.min(1, src.confidence)) : 0.5;
  if (unclearKeys.length > 0) confidence = Math.min(confidence, 0.7);

  const specialProtocol = classification === 'WHEELCHAIR' ? 'wheelchair'
    : classification === 'BILATERAL_AMPUTEE' ? 'bilateral'
    : null;

  return {
    classification,
    adaptedTrack: classification === 'NATURAL' ? 'NORMAL' : classification,
    prostheticSide,
    aids,
    mobilityAid: walkingAids[0] || (wheelchair ? 'wheelchair' : 'none'),
    confidence,
    description: en.join(' '),
    description_he: he.join(' '),
    specialProtocol,
    limbs,
  };
}

/**
 * Apply a user side correction ("the amputation is on my LEFT leg"):
 * move the affected leg's findings to the corrected side and rebuild the summary.
 */
export function applySideCorrection(diagnosis, correctedSide) {
  const side = correctedSide === 'left' || correctedSide === 'right' ? correctedSide : null;
  if (!side || !diagnosis?.limbs) return null;
  const other = side === 'left' ? 'right' : 'left';
  const limbs = { ...diagnosis.limbs };
  const target = limbs[`${side}_leg`];
  const source = limbs[`${other}_leg`];
  if (source && isAffected(source) && !(target && isAffected(target))) {
    limbs[`${side}_leg`] = source;
    limbs[`${other}_leg`] = { status: 'intact', level: null, evidence: '' };
  } else if (!(target && isAffected(target))) {
    // Nothing was detected on either leg — trust the user's report
    limbs[`${side}_leg`] = { status: 'prosthetic', level: null, evidence: 'reported by the user' };
  }
  const rebuilt = normalizeAnatomyDiagnosis({
    limbs,
    aids: diagnosis.aids,
    wheelchair: diagnosis.classification === 'WHEELCHAIR',
    confidence: 1,
  });
  return { ...rebuilt, correctedByUser: true };
}
