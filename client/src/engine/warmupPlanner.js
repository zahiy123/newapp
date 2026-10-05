// ============================================================
// warmupPlanner — the ~2.5-minute warm-up, built from the scan (Stage 2.3)
//
// PURE LOGIC — no React, no DOM.
//
// 3 exercises × 45 s, chosen from:
//   - the per-limb profile from the scan (limbProfile.js): which limbs may move,
//     prosthesis level, arms with limited range / no movement
//   - the mobility aid (crutches / wheelchair / prosthesis)
//   - the training track (rehab_only / rehab_sport / sport_only) and sport
//   - whether a ball is available (rehab + sport track asks)
//
// Iron Rule: no exercise or instruction for a non-trainable limb; for an arm with
// a limited measured range, corrections that push for "bigger" movement are
// suppressed and the instructions say to stay within the comfortable range.
//
// Every exercise carries its OWN instructions (screen + voice), so a prosthesis
// user is never told to "hold the crutches".
// ============================================================

import {
  WARM_UP_EXERCISES,
  WARM_UP_ARM_PUNCHES,
  WARM_UP_CORE_TWISTS,
  WARM_UP_SINGLE_LEG_HIGH_KNEE,
  WARM_UP_FORWARD_KICKS,
  WARM_UP_SINGLE_ARM_ROTATION,
} from '../utils/exerciseAnalysis.js';
import { getLimbProfile } from './limbProfile.js';

const [ARM_CIRCLES, HIGH_KNEES, SIDE_STEPS] = WARM_UP_EXERCISES;

export const WARM_UP_EXERCISE_SEC = 45;
export const WARM_UP_EXERCISE_COUNT = 3;

const SIDE_HE = { left: 'שמאל', right: 'ימין' };
const RANGE_NOTE_HE = 'בטווח שנוח לך — בלי לדחוף מעבר';
const RANGE_NOTE_EN = 'within your comfortable range — do not push past it';

/** Sport family for the activation drill. */
export function sportFamily(sport) {
  if (!sport) return null;
  if (sport.startsWith('football')) return 'football';
  if (sport.startsWith('basketball')) return 'basketball';
  if (sport.startsWith('tennis')) return 'tennis';
  return null;
}

/** Build a planned exercise from a base definition (keeps its movement analyzer). */
function make(base, { id, nameHe, nameEn, stepsHe, stepsEn, ghost, suppressCorrections = [], ball = false }) {
  return {
    ...base,
    id: id || base.id,
    baseId: base.id,
    name: { he: nameHe || base.name.he, en: nameEn || base.name.en },
    duration: WARM_UP_EXERCISE_SEC,
    instructions: { he: stepsHe, en: stepsEn },
    spokenSteps: { he: stepsHe, en: stepsEn },
    ghost,
    suppressCorrections,
    usesBall: ball,
  };
}

function capOf(lp, armKeys) {
  const caps = armKeys.map(k => lp[k].romCapDeg).filter(v => typeof v === 'number');
  return caps.length ? Math.min(...caps) : null;
}

// ---- Upper body mobility ----
function armMobility(lp) {
  const arms = lp.trainableArms;
  if (arms.length === 2) {
    const limited = arms.some(k => lp[k].state === 'limited');
    return make(ARM_CIRCLES, {
      stepsHe: ['עמוד יציב, רגליים ברוחב הכתפיים', 'פרוש את שתי הידיים לצדדים', limited ? `סובב במעגלים קדימה ${RANGE_NOTE_HE}; באמצע נחליף כיוון` : 'סובב במעגלים קדימה, ואחרי חצי זמן אחורה'],
      stepsEn: ['Stand stable, feet shoulder-width apart', 'Spread both arms to the sides', limited ? `Circle forward ${RANGE_NOTE_EN}; we switch direction halfway` : 'Circle forward, then backward halfway through'],
      ghost: { move: 'arm_circles', romCapDeg: capOf(lp, arms), directional: true },
      suppressCorrections: limited ? ['armCirclesSmall'] : [],
    });
  }
  if (arms.length === 1) {
    const side = arms[0].startsWith('left') ? 'left' : 'right';
    const limited = lp[arms[0]].state === 'limited';
    return make(WARM_UP_SINGLE_ARM_ROTATION, {
      nameHe: `סיבובי יד ${SIDE_HE[side]}`, nameEn: `${side === 'left' ? 'Left' : 'Right'} Arm Circles`,
      stepsHe: ['עמוד או שב יציב', `הרם את יד ${SIDE_HE[side]} לצד`, limited ? `סובב במעגלים ${RANGE_NOTE_HE}; באמצע נחליף כיוון` : 'סובב במעגלים רחבים, ואחרי חצי זמן החלף כיוון'],
      stepsEn: ['Stand or sit stable', `Raise your ${side} arm to the side`, limited ? `Make circles ${RANGE_NOTE_EN}; we switch direction halfway` : 'Make wide circles, switch direction halfway through'],
      ghost: { move: 'single_arm_circle', side, romCapDeg: capOf(lp, arms), directional: true },
      suppressCorrections: limited ? ['singleArmSmall'] : [],
    });
  }
  return null;
}

function coreTwists(lp) {
  const seated = lp.wheelchair;
  return make(WARM_UP_CORE_TWISTS, {
    stepsHe: [seated ? 'שב זקוף בכיסא' : 'עמוד יציב, רגליים ברוחב הכתפיים', 'ידיים לפני החזה', 'סובב את פלג הגוף העליון ימינה ושמאלה, בשליטה'],
    stepsEn: [seated ? 'Sit tall in your chair' : 'Stand stable, feet shoulder-width apart', 'Hands in front of your chest', 'Rotate your upper body left and right, with control'],
    ghost: { move: 'twist' },
  });
}

function armPunches(lp) {
  if (lp.trainableArms.length < 2) return null;
  const limited = lp.trainableArms.some(k => lp[k].state === 'limited');
  return make(WARM_UP_ARM_PUNCHES, {
    stepsHe: ['עמידה או ישיבה יציבה', 'אגרף קדימה ביד אחת והחזר', limited ? `החלף ידיים, ${RANGE_NOTE_HE}` : 'החלף ידיים בקצב הולך וגובר'],
    stepsEn: ['Stable stance or seat', 'Punch forward with one arm and pull back', limited ? `Alternate arms, ${RANGE_NOTE_EN}` : 'Alternate arms, building up the pace'],
    ghost: { move: 'punches', romCapDeg: capOf(lp, lp.trainableArms) },
    suppressCorrections: limited ? ['armPunchesSmall'] : [],
  });
}

// ---- Lower body mobility ----
function legMobility(lp, rehab) {
  if (lp.wheelchair || lp.affectedLegs.length === 2) return null;
  if (lp.affectedLegs.length === 0) {
    return rehab
      ? make(SIDE_STEPS, {
        stepsHe: ['עמוד עם ברכיים כפופות קלות', 'צעד לצד ימין והצמד את רגל שמאל', 'חזור לצד שמאל, בקצב נוח'],
        stepsEn: ['Stand with knees slightly bent', 'Step to the right and bring your left foot in', 'Step back to the left, at a comfortable pace'],
        ghost: { move: 'side_steps' },
      })
      : make(HIGH_KNEES, {
        stepsHe: ['עמוד זקוף', 'הרם ברך לגובה המותניים', 'החלף רגליים בקצב אחיד'],
        stepsEn: ['Stand tall', 'Raise one knee to hip height', 'Alternate legs at a steady pace'],
        ghost: { move: 'high_knees' },
      });
  }
  // One leg affected → the intact leg works, the other stays as the stable support
  const affected = lp.affectedLegs[0].startsWith('left') ? 'left' : 'right';
  const intact = affected === 'left' ? 'right' : 'left';
  const support = lp.crutches ? 'היאחז בקביים ליציבות' : 'עמוד יציב — אפשר להיעזר בקיר או בגב כיסא';
  const supportEn = lp.crutches ? 'Hold your crutches for balance' : 'Stand stable — you can hold a wall or a chair back';
  return make(WARM_UP_SINGLE_LEG_HIGH_KNEE, {
    id: lp.crutches ? 'single_leg_high_knee' : 'single_leg_high_knee_prosthesis',
    nameHe: `הרמת ברך ${SIDE_HE[intact]}`, nameEn: `${intact === 'left' ? 'Left' : 'Right'} Knee Raise`,
    stepsHe: [support, `הרם את ברך רגל ${SIDE_HE[intact]} לכיוון החזה`, 'הורד בשליטה וחזור'],
    stepsEn: [supportEn, `Raise your ${intact} knee toward your chest`, 'Lower with control and repeat'],
    ghost: { move: 'single_knee', side: intact },
  });
}

// ---- Sport activation (rehab + sport / sport only) ----
function sportActivation(sport, lp, hasBall) {
  const family = sportFamily(sport);
  if (family === 'football') {
    if (lp.wheelchair || lp.affectedLegs.length === 2) return null;
    const kickSide = lp.affectedLegs.length === 1
      ? (lp.affectedLegs[0].startsWith('left') ? 'right' : 'left')
      : null;
    const legHe = kickSide ? `ברגל ${SIDE_HE[kickSide]}` : 'לסירוגין';
    const legEn = kickSide ? `with your ${kickSide} leg` : 'alternating legs';
    const support = lp.crutches ? ['היאחז בקביים ליציבות'] : ['עמוד יציב — אפשר להיעזר בקיר'];
    const supportEn = lp.crutches ? ['Hold your crutches for balance'] : ['Stand stable — you can hold a wall'];
    return hasBall
      ? make(WARM_UP_FORWARD_KICKS, {
        id: 'ball_touches', nameHe: 'נגיעות בכדור', nameEn: 'Ball Touches',
        stepsHe: [...support, `נגע בכדור בקצות האצבעות ${legHe}`, 'קצב קל ואחיד, בשליטה'],
        stepsEn: [...supportEn, `Tap the top of the ball ${legEn}`, 'Light, steady rhythm, with control'],
        ghost: { move: 'kick', side: kickSide, small: true },
        suppressCorrections: ['kickHigher'],
        ball: true,
      })
      : make(WARM_UP_FORWARD_KICKS, {
        id: 'air_kicks', nameHe: 'בעיטות באוויר', nameEn: 'Air Kicks',
        stepsHe: [...support, `בעט קדימה באוויר ${legHe}`, 'תנועה מבוקרת — לא בעיטה חזקה'],
        stepsEn: [...supportEn, `Kick forward in the air ${legEn}`, 'Controlled movement — not a hard kick'],
        ghost: { move: 'kick', side: kickSide },
      });
  }
  if (family === 'basketball') {
    if (lp.trainableArms.length < 2) return null;
    return make(WARM_UP_ARM_PUNCHES, {
      id: hasBall ? 'wall_chest_passes' : 'air_chest_passes',
      nameHe: hasBall ? 'מסירות חזה לקיר' : 'מסירות חזה באוויר',
      nameEn: hasBall ? 'Wall Chest Passes' : 'Air Chest Passes',
      stepsHe: hasBall
        ? ['עמוד מול קיר במרחק של כמה צעדים', 'מסור את הכדור מהחזה לקיר בשתי ידיים', 'תפוס וחזור']
        : ['ידיים מול החזה כאילו מחזיקים כדור', 'דחוף את שתי הידיים קדימה כמו מסירה', 'החזר לחזה וחזור'],
      stepsEn: hasBall
        ? ['Face a wall a few steps away', 'Chest-pass the ball to the wall with both hands', 'Catch and repeat']
        : ['Hands at your chest as if holding a ball', 'Push both hands forward like a pass', 'Bring them back and repeat'],
      ghost: { move: 'chest_pass', romCapDeg: capOf(lp, lp.trainableArms) },
      suppressCorrections: ['armPunchesSmall'],
      ball: hasBall,
    });
  }
  if (family === 'tennis') {
    return make(WARM_UP_CORE_TWISTS, {
      id: 'shadow_swings', nameHe: 'תנועות מחבט באוויר', nameEn: 'Shadow Swings',
      stepsHe: ['עמידה או ישיבה יציבה', 'חקה תנועת פורהנד בסיבוב של הגו', 'חזור לתנועת בקהנד, בשליטה'],
      stepsEn: ['Stable stance or seat', 'Mimic a forehand by rotating your trunk', 'Then a backhand, with control'],
      ghost: { move: 'twist' },
    });
  }
  return null;
}

/** Track: explicit, or derived from the sport. */
export function resolveTrack(profile) {
  if (profile?.trainingTrack) return profile.trainingTrack;
  return profile?.sport === 'rehab' ? 'rehab_only' : 'sport_only';
}

/** The sport whose activation drill is used, or null. */
function activationSport(profile, track) {
  if (track === 'rehab_sport') return profile?.rehabSport || null;
  if (track === 'sport_only') return profile?.sport || null;
  return null;
}

/** True if the warm-up should ask "do you have a ball?" (rehab + sport track with a ball drill). */
export function needsBallQuestion(profile) {
  const track = resolveTrack(profile);
  if (track !== 'rehab_sport') return false;
  const sport = activationSport(profile, track);
  const family = sportFamily(sport);
  if (family !== 'football' && family !== 'basketball') return false;
  return !!sportActivation(sport, getLimbProfile(profile), true);
}

/**
 * Plan the warm-up.
 * @param {Object} profile - Firestore user profile
 * @param {{ hasBall?: boolean }} [options]
 * @returns {Object[]} 3 exercises (each with analyze, instructions, spokenSteps, ghost, suppressCorrections)
 */
export function planWarmUp(profile, { hasBall = false } = {}) {
  const lp = getLimbProfile(profile);
  const track = resolveTrack(profile);
  const rehab = track !== 'sport_only';

  const candidates = [
    armMobility(lp),
    legMobility(lp, rehab),
    activationSport(profile, track) ? sportActivation(activationSport(profile, track), lp, hasBall) : null,
    // fallbacks (in order) when a slot above is not possible for this body
    coreTwists(lp),
    armPunches(lp),
  ];

  const plan = [];
  for (const ex of candidates) {
    if (!ex || plan.some(p => p.id === ex.id || (p.baseId === ex.baseId && p.ghost?.move === ex.ghost?.move))) continue;
    plan.push(ex);
    if (plan.length === WARM_UP_EXERCISE_COUNT) break;
  }
  return plan;
}
