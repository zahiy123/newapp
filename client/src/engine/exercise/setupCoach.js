// ============================================================
// setupCoach — positions the trainee like a real coach before (and during) an exercise
//
// PURE. A human coach never trains someone half out of view and never guesses: they say
// exactly how to stand — "step back so I see you head to toe", "tilt the camera down",
// "move a little to the left", "turn side-on" — and only then "great, now I can see you,
// let's start". assessSetup() returns the SINGLE most important fix (or ok) for the
// current frame, in plain, precise words, for the profile in use.
//
// Priority: body found → too close → feet / head cut (step back or tilt the camera) →
// off-centre / cut at a side (move left / right) → too far → orientation (side-on /
// facing) → clarity (light / hidden limbs).
// Directions are as the trainee sees the screen (the camera view is mirrored).
// ============================================================

import { P, torsoLength, trunkLean, sideUsable } from './kinematics.js';
import { detectView } from './confidence.js';

const VIS = 0.5;
const NOSE = 0;
const FOOT_POINTS = { left: [P.LEFT_ANKLE, 31], right: [P.RIGHT_ANKLE, 32] };   // ankle, foot index
const TOO_CLOSE_TORSO = 0.45;     // torso longer than this share of the frame height → too close
const TOO_FAR_TORSO = 0.11;       // shorter → too far
const EDGE = 0.02;
const CENTER_BAND = [0.22, 0.78];

const say = (code, he, en, region = null) => ({ code, he, en, region });

export const SETUP = Object.freeze({
  noBody: say('no_body', 'עמוד מול המצלמה כך שאראה אותך', 'Stand in front of the camera so I can see you', 'body'),
  stepBack: say('step_back', 'התרחק מהמצלמה כדי שאראה אותך מכף רגל ועד ראש', 'Step back so I can see you from head to toe', 'body'),
  feetStepBack: say('feet_step_back', 'התרחק קצת — לא רואים את הרגליים. אני צריך לראות אותך מכף רגל ועד ראש', "Step back a little — I can't see your feet. I need you head to toe", 'legs'),
  tiltDown: say('tilt_down', 'הטה את המצלמה קצת למטה — חותכים לי את הרגליים', 'Tilt the camera down a little — your feet are cut off', 'legs'),
  tiltUp: say('tilt_up', 'הטה את המצלמה קצת למעלה — חותכים לי את הראש', 'Tilt the camera up a little — your head is cut off', 'body'),
  moveLeft: say('move_left', 'זוז קצת שמאלה — אתה יוצא מהמסגרת', "Move a little to the left — you're leaving the frame", 'body'),
  moveRight: say('move_right', 'זוז קצת ימינה — אתה יוצא מהמסגרת', "Move a little to the right — you're leaving the frame", 'body'),
  stepCloser: say('step_closer', 'התקרב קצת למצלמה — אתה רחוק מדי', "Come a little closer — you're too far", 'body'),
  turnSide: say('turn_side', 'הסתובב עם הצד למצלמה — כך אמדוד את התנועה במדויק', "Turn side-on to the camera — that's how I measure this precisely", 'body'),
  turnFront: say('turn_front', 'עמוד עם הפנים למצלמה', 'Face the camera', 'body'),
  light: say('light', 'לא רואה אותך מספיק ברור — הוסף אור או הזז דברים שמסתירים אותך', "I can't see you clearly — add light or move whatever is hiding you", 'body'),
  arms: say('arms', 'לא רואים את הידיים — הרחק אותן מהגוף או התרחק קצת', "I can't see your arms — keep them clear of your body or step back a little", 'arms'),
});

export const READY = Object.freeze({
  first: { he: 'מעולה, עכשיו אני רואה אותך — אפשר להתחיל!', en: "Great, now I can see you — let's start!" },
  again: { he: 'מצוין, אני רואה אותך — ממשיכים', en: 'Perfect, I can see you — carry on' },
});

const ok = (p, v = VIS) => p && (p.visibility ?? 1) >= v;

/**
 * The most important positioning fix for this frame, or ok.
 * @param {Object[]|null} landmarks - raw pose landmarks (anatomical sides, raw image coords)
 * @param {Object} profile - execution profile (require, cameraView, posture)
 * @param {Object} [lp] - limbProfile
 * @returns {{ ok: boolean, issue: null | { code, he, en, region } }}
 */
export function assessSetup(landmarks, profile, lp = {}) {
  const fail = (issue) => ({ ok: false, issue });
  if (!landmarks) return fail(SETUP.noBody);
  const sh = [landmarks[P.LEFT_SHOULDER], landmarks[P.RIGHT_SHOULDER]].filter(p => ok(p, 0.3));
  const hp = [landmarks[P.LEFT_HIP], landmarks[P.RIGHT_HIP]].filter(p => ok(p, 0.3));
  const torso = torsoLength(landmarks);
  if (!sh.length || !hp.length || !torso) return fail(SETUP.noBody);

  const require = new Set(profile?.require || []);
  const needFeet = require.has('legs') || require.has('body');
  const nose = landmarks[NOSE];
  const upright = (trunkLean(landmarks) ?? 0) < 45;
  // Head: judged when upright (lying on the floor the head is at the side, not the top)
  const headCut = upright && (!ok(nose) || nose.y < 0.05);
  const feetSides = ['left', 'right'].filter(s => sideUsable('leg', s, lp));
  const footInFrame = (s) => {
    const pts = FOOT_POINTS[s].map(i => landmarks[i]).filter(p => ok(p));
    return pts.length > 0 && pts.every(p => p.y <= 0.98 && p.x >= -EDGE && p.x <= 1 + EDGE);
  };
  const feetCut = needFeet && feetSides.length > 0 && !feetSides.some(footInFrame);

  // 1. Too close (or both ends cut)
  if ((headCut && feetCut) || torso > TOO_CLOSE_TORSO) return fail(SETUP.stepBack);
  // 2. Feet / head cut: tilt the camera if there is room on the other end, else step back
  if (feetCut) return fail(upright && ok(nose) && nose.y > 0.22 ? SETUP.tiltDown : SETUP.feetStepBack);
  if (headCut) {
    const ankles = [landmarks[P.LEFT_ANKLE], landmarks[P.RIGHT_ANKLE]].filter(p => ok(p));
    const lowest = ankles.length ? Math.max(...ankles.map(p => p.y)) : Math.max(...hp.map(p => p.y));
    return fail(lowest < 0.8 ? SETUP.tiltUp : SETUP.stepBack);
  }
  // 3. Left / right. Raw x near 0 is the RIGHT of the mirrored screen → move left (and vice versa)
  const keyIdx = [NOSE, 11, 12, 23, 24, ...(needFeet ? [25, 26, 27, 28] : [])];
  const xs = keyIdx.map(i => landmarks[i]).filter(p => ok(p, 0.3)).map(p => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const cx = (minX + maxX) / 2;
  if (minX < EDGE || (upright && cx < CENTER_BAND[0])) return fail(SETUP.moveLeft);
  if (maxX > 1 - EDGE || (upright && cx > CENTER_BAND[1])) return fail(SETUP.moveRight);
  // 4. Too far
  if (torso < TOO_FAR_TORSO) return fail(SETUP.stepCloser);
  // 5. Orientation for standing measurements
  if (upright && profile?.posture === 'standing') {
    const view = detectView(landmarks);
    if (profile.cameraView === 'side' && view === 'front') return fail(SETUP.turnSide);
    if (profile.cameraView === 'front' && view === 'side') return fail(SETUP.turnFront);
  }
  // 6. Clarity of the points the exercise needs
  const core = [...sh, ...hp];
  const meanVis = core.reduce((s, p) => s + (p.visibility ?? 1), 0) / core.length;
  if (meanVis < 0.6) return fail(SETUP.light);
  return { ok: true, issue: null };
}
