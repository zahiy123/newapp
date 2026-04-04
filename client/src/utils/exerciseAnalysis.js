import {
  analyzeShootingForm, analyzeHandDribbling, analyzeStroke,
  analyzeServe, analyzeFootwork, analyzeKickTechnique,
  analyzeAmputeeCrutchKick, analyzeAmputeeCrutchSprint,
  analyzeWheelchairBasketballShooting, analyzeWheelchairBasketballDribbling,
  analyzeWheelchairBasketballChestPass,
  analyzeWheelchairTennisStroke, analyzeWheelchairTennisServe
} from './sportAnalyzers';
import { angleCosine } from './motionEngine';

// Key landmark indices
const LM = {
  NOSE: 0,
  LEFT_EYE: 2, RIGHT_EYE: 5,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28
};

// Law of cosines angle — uses 3D distances, more stable than atan2
// Landmarks are pre-stabilized by Kalman filter in Training.jsx
function angle(a, b, c) {
  return angleCosine(a, b, c);
}

// --- Minimum ROM validation for rep counting ---
// Returns true if the angle delta between phase start and current meets the minimum threshold.
// Uses calibration data if available (30% of calibrated range), otherwise uses fixed minimums.
const MIN_ROM_DEFAULTS = {
  knee: 20,       // squat, lunge: at least 20° of knee bend (was 25°, lowered for kids)
  elbow: 20,      // pushup, curl, dips: at least 20° of elbow bend (was 30°, lowered for kids)
  shoulder: 15,   // shoulder press: at least 15° (was 20°)
  yDelta: 0.03,   // Y-position based: at least 3% of frame height (was 4%)
};

function meetsMinROM(prevState, joint, currentAngle, phaseStartAngle) {
  if (phaseStartAngle == null) return true; // no tracking yet
  const delta = Math.abs(currentAngle - phaseStartAngle);
  const cal = prevState?._calibration;

  // If we have calibration data for this joint, require 40% of calibrated range (was 50%)
  // Lower threshold accommodates kids and athletes with limited ROM
  if (cal) {
    // Check both left and right variants
    const calData = cal[joint] || cal[`left${joint.charAt(0).toUpperCase() + joint.slice(1)}`]
      || cal[`right${joint.charAt(0).toUpperCase() + joint.slice(1)}`];
    if (calData && calData.range > 8) {
      return delta >= calData.range * 0.4;
    }
  }

  // Fallback to fixed minimum
  return delta >= (MIN_ROM_DEFAULTS[joint] || 15);
}

// Minimum time between reps (ms) — prevents impossibly fast "reps" from jitter
const MIN_REP_INTERVAL_MS = 800; // real reps take at least 0.8s

function canCountRep(lastRepTime) {
  if (!lastRepTime) return true;
  return Date.now() - lastRepTime >= MIN_REP_INTERVAL_MS;
}

// --- Landmark Visibility Validation ---
// Checks if required body part groups are visible to the camera.
// Returns { valid: true } or { valid: false, missingParts: ['legs'] }
export function validateLandmarks(landmarks, requiredGroups = [], amputationProfile) {
  if (!landmarks || requiredGroups.length === 0) return { valid: true };

  // Determine which side is amputated to skip it in validation
  const ampSide = amputationProfile?.amputationSide;
  const ampDisability = amputationProfile?.disability;

  const missing = [];

  for (const group of requiredGroups) {
    let visible = false;
    switch (group) {
      case 'legs': {
        const lKnee = landmarks[LM.LEFT_KNEE];
        const lAnkle = landmarks[LM.LEFT_ANKLE];
        const rKnee = landmarks[LM.RIGHT_KNEE];
        const rAnkle = landmarks[LM.RIGHT_ANKLE];
        const leftOk = lKnee?.visibility > 0.3 && lAnkle?.visibility > 0.3;
        const rightOk = rKnee?.visibility > 0.3 && rAnkle?.visibility > 0.3;
        // For one-leg amputees, only require the intact leg
        if (ampDisability === 'one_leg' && ampSide === 'left') {
          visible = rightOk;
        } else if (ampDisability === 'one_leg' && ampSide === 'right') {
          visible = leftOk;
        } else {
          visible = leftOk || rightOk;
        }
        break;
      }
      case 'arms': {
        const lElbow = landmarks[LM.LEFT_ELBOW];
        const lWrist = landmarks[LM.LEFT_WRIST];
        const rElbow = landmarks[LM.RIGHT_ELBOW];
        const rWrist = landmarks[LM.RIGHT_WRIST];
        const leftOk = lElbow?.visibility > 0.3 && lWrist?.visibility > 0.3;
        const rightOk = rElbow?.visibility > 0.3 && rWrist?.visibility > 0.3;
        // For one-arm amputees, only require the intact arm
        if (ampDisability === 'one_arm' && ampSide === 'left') {
          visible = rightOk;
        } else if (ampDisability === 'one_arm' && ampSide === 'right') {
          visible = leftOk;
        } else {
          visible = leftOk || rightOk;
        }
        break;
      }
      case 'hips': {
        const lHip = landmarks[LM.LEFT_HIP];
        const rHip = landmarks[LM.RIGHT_HIP];
        visible = lHip?.visibility > 0.3 || rHip?.visibility > 0.3;
        break;
      }
      case 'shoulders': {
        const lShoulder = landmarks[LM.LEFT_SHOULDER];
        const rShoulder = landmarks[LM.RIGHT_SHOULDER];
        visible = lShoulder?.visibility > 0.3 || rShoulder?.visibility > 0.3;
        break;
      }
      default:
        visible = true;
    }
    if (!visible) missing.push(group);
  }

  if (missing.length === 0) return { valid: true };
  if (missing.length >= 2) return { valid: false, missingParts: ['all'] };

  // Directional hint: if legs missing but shoulders visible → camera too high
  let direction;
  if (missing.includes('legs') || missing.includes('hips')) {
    const lShoulder = landmarks[LM.LEFT_SHOULDER];
    const rShoulder = landmarks[LM.RIGHT_SHOULDER];
    if (lShoulder?.visibility > 0.3 || rShoulder?.visibility > 0.3) {
      direction = 'down';
    }
  } else if (missing.includes('shoulders') || missing.includes('arms')) {
    const lHip = landmarks[LM.LEFT_HIP];
    const rHip = landmarks[LM.RIGHT_HIP];
    if (lHip?.visibility > 0.3 || rHip?.visibility > 0.3) {
      direction = 'up';
    }
  }

  return { valid: false, missingParts: missing, direction };
}

// --- Perspective Detection ---
// Detects if user is facing camera (front) or showing profile (side)
export function detectPerspective(landmarks) {
  if (!landmarks) return 'unknown';
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];

  const leftVis = lShoulder?.visibility > 0.3;
  const rightVis = rShoulder?.visibility > 0.3;

  if (!leftVis && !rightVis) return 'unknown';
  if (!leftVis || !rightVis) return 'side'; // only one shoulder visible

  const xDist = Math.abs(lShoulder.x - rShoulder.x);
  if (xDist > 0.12) return 'front';
  if (xDist < 0.06) return 'side';
  return 'unknown';
}

// Check if perspective is appropriate for lying exercises (plank, push-ups, etc.)
// Lying exercises are best viewed from the side, not front-on.
const LYING_CUEKEYS = ['plank', 'push', 'sideplank', 'mountain', 'crunch', 'bridge'];

export function checkPerspective(landmarks, orientation) {
  if (!orientation || orientation !== ORIENTATION.LYING) return { valid: true };
  const perspective = detectPerspective(landmarks);
  if (perspective === 'front') {
    return {
      valid: false,
      feedback: {
        type: 'perspective',
        text: 'שים את המצלמה מהצד כדי שאוכל לראות את התנוחה שלך טוב יותר',
        textEn: 'Place the camera to the side so I can see your form better',
      },
    };
  }
  return { valid: true };
}

// --- Orientation Verification System ---
// Determines if user is in the correct body position for the exercise
export const ORIENTATION = {
  STANDING: 'standing',   // body vertical (tilt > 60° from floor)
  LYING: 'lying',         // body horizontal (tilt < 30° from floor)
  SITTING: 'sitting',     // wheelchair / seated exercises
  ANY: 'any',             // no orientation requirement
};

// Calculate body tilt angle relative to floor (0° = flat, 90° = upright)
function getBodyTiltDeg(landmarks) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  if (!lShoulder || !lHip || lShoulder.visibility < 0.3 || lHip.visibility < 0.3) return null;

  const shoulderMidX = (lShoulder.x + (rShoulder?.visibility > 0.3 ? rShoulder.x : lShoulder.x)) / 2;
  const shoulderMidY = (lShoulder.y + (rShoulder?.visibility > 0.3 ? rShoulder.y : lShoulder.y)) / 2;
  const hipMidX = (lHip.x + (rHip?.visibility > 0.3 ? rHip.x : lHip.x)) / 2;
  const hipMidY = (lHip.y + (rHip?.visibility > 0.3 ? rHip.y : lHip.y)) / 2;

  const dx = Math.abs(hipMidX - shoulderMidX);
  const dy = Math.abs(hipMidY - shoulderMidY);

  // atan2(vertical, horizontal) → 90° when vertical, 0° when horizontal
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

// Orientation messages — aggressive coach style (Hebrew primary)
const ORIENTATION_MSGS = {
  lying_from_standing: {
    he: 'תרד לרצפה! שכיבות סמיכה עושים למטה, לא בעמידה!',
    en: 'Get down on the floor! Push-ups are done lying down, not standing!',
  },
  lying_from_sitting: {
    he: 'תרד לרצפה ושכב! התרגיל הזה דורש שכיבה!',
    en: 'Get on the floor! This exercise requires a lying position!',
  },
  standing_from_lying: {
    he: 'קום! התרגיל הזה בעמידה בלבד!',
    en: 'Stand up! This exercise is done standing only!',
  },
  standing_from_sitting: {
    he: 'קום על הרגליים! אי אפשר לעשות את זה בישיבה!',
    en: 'Get on your feet! You can\'t do this sitting down!',
  },
  sitting_from_standing: {
    he: 'שב בכיסא! התרגיל הזה מתבצע בישיבה!',
    en: 'Sit down! This exercise is performed seated!',
  },
  sitting_from_lying: {
    he: 'שב בכיסא! התרגיל הזה מתבצע בישיבה!',
    en: 'Sit in the chair! This exercise is performed seated!',
  },
};

/**
 * Check if user is in the correct body orientation for the exercise.
 * Uses body tilt angle + calibration height comparison.
 * @returns {{ valid: boolean, feedback?: { type: string, text: string, textEn: string } }}
 */
export function checkOrientation(landmarks, required, prevState) {
  if (!required || required === ORIENTATION.ANY) return { valid: true };
  if (!landmarks) return { valid: true }; // can't check without landmarks

  const tilt = getBodyTiltDeg(landmarks);
  if (tilt === null) return { valid: true }; // can't determine — don't block

  // Determine current orientation from tilt
  let currentOrientation;
  if (tilt > 55) {
    currentOrientation = 'standing';
  } else if (tilt < 35) {
    currentOrientation = 'lying';
  } else {
    // Ambiguous zone (35-55°) — could be bent-over exercises, don't block
    return { valid: true };
  }

  // Sitting detection: use detectPosture for sitting/wheelchair
  if (required === ORIENTATION.SITTING) {
    const posture = detectPosture(landmarks);
    if (posture === 'sitting' || posture === 'wheelchair') return { valid: true };
    const msgKey = currentOrientation === 'lying' ? 'sitting_from_lying' : 'sitting_from_standing';
    return { valid: false, feedback: { type: 'orientation', text: ORIENTATION_MSGS[msgKey].he, textEn: ORIENTATION_MSGS[msgKey].en } };
  }

  // Calibration height check — extra layer for LYING exercises
  if (required === ORIENTATION.LYING && prevState?._calibration?._calShoulderY != null) {
    const lShoulder = landmarks[LM.LEFT_SHOULDER];
    const rShoulder = landmarks[LM.RIGHT_SHOULDER];
    if (lShoulder?.visibility > 0.3) {
      const currentShoulderY = (lShoulder.y + (rShoulder?.visibility > 0.3 ? rShoulder.y : lShoulder.y)) / 2;
      const calShoulderY = prevState._calibration._calShoulderY;
      // If shoulder Y hasn't dropped significantly from standing calibration → still standing
      // In normalized coords, Y increases downward; lying = shoulder Y closer to 0.5 (mid-frame) or higher
      if (currentShoulderY < calShoulderY + 0.10 && currentOrientation === 'standing') {
        return {
          valid: false,
          feedback: { type: 'orientation', text: ORIENTATION_MSGS.lying_from_standing.he, textEn: ORIENTATION_MSGS.lying_from_standing.en },
        };
      }
    }
  }

  // Standard tilt check
  if (required === ORIENTATION.LYING && currentOrientation === 'standing') {
    return { valid: false, feedback: { type: 'orientation', text: ORIENTATION_MSGS.lying_from_standing.he, textEn: ORIENTATION_MSGS.lying_from_standing.en } };
  }
  if (required === ORIENTATION.STANDING && currentOrientation === 'lying') {
    return { valid: false, feedback: { type: 'orientation', text: ORIENTATION_MSGS.standing_from_lying.he, textEn: ORIENTATION_MSGS.standing_from_lying.en } };
  }

  // Also check sitting via detectPosture for standing-required exercises
  if (required === ORIENTATION.STANDING) {
    const posture = detectPosture(landmarks);
    if (posture === 'sitting') {
      return { valid: false, feedback: { type: 'orientation', text: ORIENTATION_MSGS.standing_from_sitting.he, textEn: ORIENTATION_MSGS.standing_from_sitting.en } };
    }
  }

  return { valid: true };
}

/**
 * Check movement quality using calibration data.
 * Returns ROM percentage (0-100) relative to calibrated range.
 * If ROM < 50%, returns a coach feedback message.
 */
export function checkMovementQuality(prevState, joint, currentAngle, phaseStartAngle) {
  if (phaseStartAngle == null) return { romPct: 100, feedback: null };
  const delta = Math.abs(currentAngle - phaseStartAngle);
  const cal = prevState?._calibration;

  if (!cal) return { romPct: 100, feedback: null }; // no calibration → can't assess quality

  const calData = cal[joint] || cal[`left${joint.charAt(0).toUpperCase() + joint.slice(1)}`]
    || cal[`right${joint.charAt(0).toUpperCase() + joint.slice(1)}`];

  if (!calData || calData.range < 10) return { romPct: 100, feedback: null };

  const romPct = Math.round((delta / calData.range) * 100);

  if (romPct < 50) {
    return {
      romPct,
      feedback: {
        type: 'quality',
        text: `תנועה לא מלאה! אתה מבצע רק ${romPct}% מהטווח שלך. תרד נמוך יותר!`,
        textEn: `Incomplete movement! Only ${romPct}% of your range. Go deeper!`,
      },
    };
  }

  return { romPct, feedback: null };
}

/**
 * Smooth an angle reading to filter out camera jitter / pose estimation noise.
 * Uses exponential moving average (EMA) with α=0.4.
 * Ignores deltas < 2° as noise. Stores smoothed value in prevState.
 */
// Smoothing is now handled by Kalman filter in Training.jsx (LandmarkStabilizer).
// These functions are pass-through wrappers to avoid breaking existing call sites.
// EMA smoothing for computed angles — reduces jitter in rep detection
// alpha: 0.5 gives fast response with jitter removal (angles change slower than raw coords)
const ANGLE_EMA_ALPHA = 0.5;

function smoothAngle(rawAngle, prevState, key) {
  const prev = prevState?.[key];
  if (prev == null || isNaN(prev)) return rawAngle;
  return prev + ANGLE_EMA_ALPHA * (rawAngle - prev);
}

const Y_EMA_ALPHA = 0.5;

function smoothY(rawY, prevState, key) {
  const prev = prevState?.[key];
  if (prev == null || isNaN(prev)) return rawY;
  return prev + Y_EMA_ALPHA * (rawY - prev);
}

function getStandingLeg(landmarks) {
  const leftAnkle = landmarks[LM.LEFT_ANKLE];
  const rightAnkle = landmarks[LM.RIGHT_ANKLE];
  if (!leftAnkle || leftAnkle.visibility < 0.3) return 'right';
  if (!rightAnkle || rightAnkle.visibility < 0.3) return 'left';
  return leftAnkle.y > rightAnkle.y ? 'left' : 'right';
}

// Rolling movement detection with smoothing — forgiving, human-like detection.
// Uses a 10-frame history buffer to avoid false "not moving" on small pauses.
function detectMovement(landmarks, prevLandmarks, prevState) {
  if (!prevLandmarks) return false;
  const trackPoints = [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP,
    LM.LEFT_WRIST, LM.RIGHT_WRIST];
  let totalDelta = 0;
  let counted = 0;

  for (const idx of trackPoints) {
    const curr = landmarks[idx];
    const prev = prevLandmarks[idx];
    if (curr && prev && curr.visibility > 0.3 && prev.visibility > 0.3) {
      totalDelta += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
      counted++;
    }
  }

  const frameDelta = counted > 0 ? totalDelta / counted : 0;

  // Rolling buffer of last 10 frame deltas (stored in prevState)
  const history = prevState?._movementHistory ? [...prevState._movementHistory] : [];
  history.push(frameDelta);
  if (history.length > 10) history.shift();

  // Store history back for next frame (caller must persist in state)
  if (prevState) prevState._movementHistory = history;

  // Average over the buffer — smooths out micro-pauses
  const avgDelta = history.reduce((s, v) => s + v, 0) / history.length;

  // Forgiving thresholds — need sustained stillness before "not moving"
  if (avgDelta > 0.004) return true;
  // Only "not moving" if 5+ recent frames are all still
  const allStill = history.length >= 5 && history.every(d => d < 0.003);
  return !allStill;
}

// Detect posture: 'sitting', 'standing', 'wheelchair', or 'unknown'
// Uses 3 factors with 2-of-3 voting for sitting detection:
// 1. Hip-knee vertical distance (small = sitting)
// 2. Hip-knee-ankle angle (70°-110° = sitting)
// 3. Torso ratio: nose-to-hip vs shoulder-to-hip (compressed = sitting)
// userProfile param: if mobilityAid === 'wheelchair', returns 'wheelchair' instead of 'sitting'
export function detectPosture(landmarks, userProfile) {
  if (!landmarks) return 'unknown';

  const isWheelchairUser = userProfile?.mobilityAid === 'wheelchair';

  const nose = landmarks[LM.NOSE];
  const leftHip = landmarks[LM.LEFT_HIP];
  const rightHip = landmarks[LM.RIGHT_HIP];
  const leftKnee = landmarks[LM.LEFT_KNEE];
  const rightKnee = landmarks[LM.RIGHT_KNEE];
  const leftAnkle = landmarks[LM.LEFT_ANKLE];
  const rightAnkle = landmarks[LM.RIGHT_ANKLE];
  const leftShoulder = landmarks[LM.LEFT_SHOULDER];
  const rightShoulder = landmarks[LM.RIGHT_SHOULDER];

  // Try whichever side has better visibility
  let hip, knee, ankle;
  if (leftHip?.visibility > 0.3 && leftKnee?.visibility > 0.3) {
    hip = leftHip; knee = leftKnee; ankle = leftAnkle;
  } else if (rightHip?.visibility > 0.3 && rightKnee?.visibility > 0.3) {
    hip = rightHip; knee = rightKnee; ankle = rightAnkle;
  } else {
    // Wheelchair users: if we can see upper body but not legs, that's expected
    if (isWheelchairUser && leftHip?.visibility > 0.3 && leftShoulder?.visibility > 0.3) return 'wheelchair';
    return 'unknown';
  }

  let sittingVotes = 0;
  let standingVotes = 0;

  // Factor 1: Hip-knee vertical distance (normalized coords, Y increases downward)
  const hipKneeVertDist = knee.y - hip.y; // positive = knee below hip
  if (hipKneeVertDist < 0.12 && hipKneeVertDist > -0.02) {
    sittingVotes++;
  } else if (hipKneeVertDist > 0.15) {
    standingVotes++;
  }

  // Factor 2: Hip-knee-ankle angle (sitting = 70°-110°, standing > 150°)
  if (ankle?.visibility > 0.3) {
    const legAngle = angle(hip, knee, ankle);
    if (legAngle >= 70 && legAngle <= 110) {
      sittingVotes++;
    } else if (legAngle > 150) {
      standingVotes++;
    }
  }

  // Factor 3: Torso compression ratio
  // When sitting, nose-to-hip distance is small relative to shoulder-to-hip
  if (nose?.visibility > 0.3 && leftShoulder?.visibility > 0.3 && rightShoulder?.visibility > 0.3) {
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipMidY = (leftHip.y + (rightHip?.visibility > 0.3 ? rightHip.y : leftHip.y)) / 2;
    const noseToHip = hipMidY - nose.y;
    const shoulderToHip = hipMidY - shoulderMidY;
    // When sitting, torso is compressed: noseToHip is close to shoulderToHip
    if (shoulderToHip > 0.01 && noseToHip > 0.01) {
      const torsoRatio = noseToHip / shoulderToHip;
      if (torsoRatio < 1.6) {
        sittingVotes++;
      } else if (torsoRatio > 2.0) {
        standingVotes++;
      }
    }
  }

  // 2-of-3 voting
  if (sittingVotes >= 2) return isWheelchairUser ? 'wheelchair' : 'sitting';
  if (standingVotes >= 2) return 'standing';

  // Fallback: if hip is clearly above knee, probably standing
  if (hipKneeVertDist > 0.12) return 'standing';

  // Wheelchair users: default to wheelchair rather than unknown
  if (isWheelchairUser) return 'wheelchair';

  return 'unknown';
}

// Detect if head is looking down
export function detectHeadDown(landmarks) {
  if (!landmarks) return false;
  const nose = landmarks[LM.NOSE];
  const leftShoulder = landmarks[LM.LEFT_SHOULDER];
  const rightShoulder = landmarks[LM.RIGHT_SHOULDER];
  if (!nose || !leftShoulder || !rightShoulder) return false;
  if (nose.visibility < 0.4 || leftShoulder.visibility < 0.4) return false;

  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const headDropRatio = (shoulderMidY - nose.y);
  return headDropRatio < 0.04;
}

// Location-aware equipment/prop substitution (sport-aware)
export function getLocationProps(location, isHe, sport) {
  // Fitness: no chairs/defenders/markers needed
  if (sport === 'fitness') {
    const fitnessProps = {
      home: {
        markers: isHe ? 'מרחב פתוח' : 'open space',
        distance: isHe ? '2 מטר' : '2 meters',
        defenders: '',
        setup: isHe ? 'פנה מרחב פתוח לאימון, ללא ציוד נדרש' : 'Clear open space for training, no equipment needed',
      },
      yard: {
        markers: isHe ? 'מרחב פתוח' : 'open space',
        distance: isHe ? '5 מטר' : '5 meters',
        defenders: '',
        setup: isHe ? 'מצא מרחב פתוח בחצר לאימון' : 'Find open space in the yard for training',
      },
      field: {
        markers: isHe ? 'מרחב פתוח' : 'open space',
        distance: isHe ? '5 מטר' : '5 meters',
        defenders: '',
        setup: isHe ? 'מצא מרחב פתוח לאימון' : 'Find open space for training',
      },
      gym: {
        markers: isHe ? 'אזור אימון' : 'training area',
        distance: isHe ? '3 מטר' : '3 meters',
        defenders: '',
        setup: isHe ? 'מצא אזור פתוח בחדר הכושר' : 'Find an open area in the gym',
      },
    };
    return fitnessProps[location] || fitnessProps.field;
  }

  // Tennis: court-specific setup
  if (sport === 'tennis' || sport === 'tennisWheelchair') {
    const tennisProps = {
      home: {
        markers: isHe ? 'מטרות (מגבות או בקבוקים)' : 'targets (towels or bottles)',
        distance: isHe ? '3 מטר' : '3 meters',
        defenders: isHe ? 'מטרות' : 'targets',
        setup: isHe ? 'הצב מטרות (מגבות/בקבוקים) לדיוק מכות' : 'Place targets (towels/bottles) for stroke accuracy',
      },
      yard: {
        markers: isHe ? 'מטרות או קונוסים' : 'targets or cones',
        distance: isHe ? '5 מטר' : '5 meters',
        defenders: isHe ? 'מטרות' : 'targets',
        setup: isHe ? 'הצב קונוסים כמטרות לאימון מכות' : 'Place cones as targets for stroke practice',
      },
      field: {
        markers: isHe ? 'קונוסים או מטרות' : 'cones or targets',
        distance: isHe ? '5 מטר' : '5 meters',
        defenders: isHe ? 'מטרות' : 'targets',
        setup: isHe ? 'סמן אזורי מטרה במגרש עם קונוסים' : 'Mark target zones on court with cones',
      },
      gym: {
        markers: isHe ? 'מטרות' : 'targets',
        distance: isHe ? '3 מטר' : '3 meters',
        defenders: isHe ? 'מטרות' : 'targets',
        setup: isHe ? 'הצב מטרות לאימון דיוק' : 'Place targets for accuracy training',
      },
    };
    return tennisProps[location] || tennisProps.field;
  }

  // Ball sports (football, basketball, etc.): keep markers/defenders
  const props = {
    home: {
      markers: isHe ? 'כיסאות או פחיות' : 'chairs or cans',
      distance: isHe ? '2 מטר' : '2 meters',
      defenders: isHe ? 'שני כיסאות' : 'two chairs',
      setup: isHe ? 'הצב שני כיסאות או פחיות במרחק 2 מטר' : 'Place two chairs or cans 2 meters apart',
    },
    yard: {
      markers: isHe ? 'קונוסים או שקיות' : 'cones or bags',
      distance: isHe ? '5 מטר' : '5 meters',
      defenders: isHe ? 'קונוסים' : 'cones',
      setup: isHe ? 'הצב קונוסים או שקיות במרחק 5 מטר' : 'Place cones or bags 5 meters apart',
    },
    field: {
      markers: isHe ? 'קונוסים או שקיות' : 'cones or bags',
      distance: isHe ? '5 מטר' : '5 meters',
      defenders: isHe ? 'קונוסים' : 'cones',
      setup: isHe ? 'הצב שני קונוסים או שקיות במרחק 5 מטר' : 'Place two cones or bags 5 meters apart',
    },
    gym: {
      markers: isHe ? 'קונוסים או משקולות' : 'cones or weights',
      distance: isHe ? '3 מטר' : '3 meters',
      defenders: isHe ? 'קונוסים' : 'cones',
      setup: isHe ? 'הצב קונוסים או משקולות במרחק 3 מטר' : 'Place cones or weights 3 meters apart',
    },
  };
  return props[location] || props.field;
}

// --- Rep counting for single-leg squat ---
export function analyzeSquat(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  // Gate: if sitting or unknown posture, no technique feedback
  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const leg = getStandingLeg(landmarks);
  const hip = landmarks[leg === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
  const knee = landmarks[leg === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
  const ankle = landmarks[leg === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

  if (!hip || !knee || !ankle) return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };

  const rawKneeAngle = angle(hip, knee, ankle);
  const kneeAngle = smoothAngle(rawKneeAngle, prevState, '_smoothKnee');
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? kneeAngle;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  if (phase === 'up' && kneeAngle < 120) {
    newPhase = 'down';
    newFirstRep = true;
    newPhaseStartAngle = kneeAngle;
    newRepCounted = false;
    feedback = { type: 'info', text: 'יפה! ירידה...' };
  } else if (phase === 'down') {
    // Early count at 80% of return phase
    const earlyThreshold = phaseStartAngle + (160 - phaseStartAngle) * 0.8;
    if (!repCounted && kneeAngle > earlyThreshold && meetsMinROM(prevState, 'knee', kneeAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      // Coaching: assess squat depth quality
      const romDelta = Math.abs(kneeAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 70) {
        coaching = { he: 'עומק מעולה! סקוואט מלא - המשך ככה', en: 'Excellent depth! Full squat - keep it up' };
      } else if (romDelta > 45) {
        coaching = { he: 'עומק טוב. נסה לרדת עוד קצת - ירכיים מקבילות לרצפה', en: 'Good depth. Try going a bit lower - thighs parallel to floor' };
      } else {
        coaching = { he: 'רד יותר עמוק! הירכיים צריכות להגיע לפחות למקביל לרצפה', en: 'Go deeper! Thighs should reach at least parallel to floor' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset at full extension
    if (kneeAngle > 160) {
      newPhase = 'up';
      newRepCounted = false;
      newPhaseStartAngle = kneeAngle;
    }
  }

  // Knee valgus detection (knees collapsing inward)
  if (newFirstRep && newPhase === 'down') {
    const lKnee = landmarks[LM.LEFT_KNEE];
    const rKnee = landmarks[LM.RIGHT_KNEE];
    const lHip = landmarks[LM.LEFT_HIP];
    const rHip = landmarks[LM.RIGHT_HIP];
    if (lKnee?.visibility > 0.3 && rKnee?.visibility > 0.3 && lHip?.visibility > 0.3 && rHip?.visibility > 0.3) {
      const hipWidth = Math.abs(lHip.x - rHip.x);
      const kneeWidth = Math.abs(lKnee.x - rKnee.x);
      if (hipWidth > 0.01 && kneeWidth / hipWidth < 0.7) {
        feedback = { type: 'warning', text: 'הברכיים קורסות פנימה! תפתח אותן החוצה לרוחב כתפיים',
                     coaching: { he: 'הברכיים נופלות פנימה! דחוף אותן החוצה בקו עם האצבעות - זה מגן על הברכיים ומפעיל את הישבן', en: 'Knees caving in! Push them out in line with toes - this protects knees and activates glutes' } };
      }
    }
  }

  // Forward lean detection
  if (newFirstRep && newPhase === 'down') {
    const lShoulder = landmarks[LM.LEFT_SHOULDER];
    const rShoulder = landmarks[LM.RIGHT_SHOULDER];
    if (lShoulder?.visibility > 0.3 && rShoulder?.visibility > 0.3 && hip?.visibility > 0.3) {
      const shoulderX = (lShoulder.x + rShoulder.x) / 2;
      const hipX = hip.x;
      // If shoulders are significantly in front of hips (forward lean)
      if (Math.abs(shoulderX - hipX) > 0.08) {
        feedback = { type: 'warning', text: 'הגב נוטה קדימה! שמור על חזה זקוף',
                     coaching: { he: 'הגב נוטה קדימה מדי - שמור על חזה זקוף, הסתכל קדימה, דחוף את הישבן אחורה', en: 'Leaning too far forward - keep chest up, look ahead, push hips back' } };
      }
    }
  }

  // Only give technique warnings AFTER first rep has started
  if (newFirstRep && newPhase === 'down' && kneeAngle < 70) {
    feedback = { type: 'warning', text: 'אל תרד יותר מדי! שמור על הברך מעל הקרסול',
                 coaching: { he: 'עומק מוגזם - הברכיים עוברות את האצבעות. עצור כשהירכיים מקבילות לרצפה', en: 'Too deep - knees past toes. Stop when thighs are parallel to floor' } };
  }

  return { reps: newReps, phase: newPhase, feedback, kneeAngle: Math.round(kneeAngle), moving, headDown: newFirstRep ? headDown : false, lastRepTime, firstRepStarted: newFirstRep, posture, _phaseStartAngle: newPhaseStartAngle, _smoothKnee: kneeAngle, _repCounted: newRepCounted, _prevLandmarks: landmarks };
}

// --- Rep counting for crutch dips ---
export function analyzeDips(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const leftShoulder = landmarks[LM.LEFT_SHOULDER];
  const rightShoulder = landmarks[LM.RIGHT_SHOULDER];
  const leftElbow = landmarks[13];

  if (!leftShoulder || !leftElbow) return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const prevY = prevState.prevShoulderY || shoulderY;
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const threshold = 0.03;
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartY = prevState._phaseStartY ?? shoulderY;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartY = phaseStartY;

  if (phase === 'up' && shoulderY - prevY > threshold) {
    newPhase = 'down';
    newFirstRep = true;
    newPhaseStartY = shoulderY;
    newRepCounted = false;
  } else if (phase === 'down') {
    // Early count at 80%: when shoulder has risen 80% back to start
    const yDelta = Math.abs(shoulderY - phaseStartY);
    const targetY = phaseStartY - yDelta; // approximate up position
    const earlyRise = prevY - shoulderY > threshold * 0.5; // shoulder moving up
    if (!repCounted && earlyRise && yDelta >= MIN_ROM_DEFAULTS.yDelta && canCountRep(lastRepTime)) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      let coaching = null;
      if (yDelta > 0.08) {
        coaching = { he: 'ירידה עמוקה מצוינת! שליטה מלאה', en: 'Excellent deep dip! Full control' };
      } else if (yDelta > 0.05) {
        coaching = { he: 'טוב! נסה לרדת עוד - מרפקים ב-90 מעלות', en: 'Good! Try going deeper - elbows at 90 degrees' };
      } else {
        coaching = { he: 'רד יותר עמוק! המרפקים צריכים להגיע ל-90 מעלות', en: 'Go deeper! Elbows should reach 90 degrees' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset when fully up
    if (prevY - shoulderY > threshold) {
      const fullDelta = Math.abs(shoulderY - phaseStartY);
      if (fullDelta >= MIN_ROM_DEFAULTS.yDelta) {
        newPhase = 'up';
        newRepCounted = false;
        newPhaseStartY = shoulderY;
      }
    }
  }

  return { reps: newReps, phase: newPhase, feedback, prevShoulderY: shoulderY, moving, headDown: newFirstRep ? headDown : false, lastRepTime, firstRepStarted: newFirstRep, posture, _phaseStartY: newPhaseStartY, _repCounted: newRepCounted, _prevLandmarks: landmarks };
}

// --- Plank hold analysis ---
export function analyzePlank(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  // Visibility check: need shoulders, hips, legs
  const vis = validateLandmarks(landmarks, ['shoulders', 'hips', 'legs']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);

  // Average both sides for more stable readings
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];

  const avgPt = (a, b) => {
    if (a?.visibility > 0.3 && b?.visibility > 0.3) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: 1 };
    if (a?.visibility > 0.3) return a;
    if (b?.visibility > 0.3) return b;
    return null;
  };

  const shoulder = avgPt(lShoulder, rShoulder);
  const hip = avgPt(lHip, rHip);
  const ankle = avgPt(lAnkle, rAnkle);
  const knee = avgPt(lKnee, rKnee);

  if (!shoulder || !hip || !ankle) return { ...prevState, feedback: null, posture: 'unknown', _prevLandmarks: landmarks };

  const bodyAngle = angle(shoulder, hip, ankle);

  // Plank detection: body should be roughly horizontal
  const isHorizontal = Math.abs(shoulder.y - ankle.y) < 0.15;
  // Hip should be between shoulder and ankle Y (with tolerance)
  const minY = Math.min(shoulder.y, ankle.y) - 0.05;
  const maxY = Math.max(shoulder.y, ankle.y) + 0.05;
  const hipInLine = hip.y >= minY && hip.y <= maxY;
  const isInPlankPosition = isHorizontal && hipInLine && bodyAngle < 200;

  let feedback = null;
  let posture = isInPlankPosition ? 'plank' : 'unknown';

  // Only give feedback when actually in plank position
  if (isInPlankPosition) {
    if (bodyAngle >= 170 && bodyAngle <= 180) {
      feedback = { type: 'good', text: 'מעולה! גב ישר, המשך כך!',
                   coaching: { he: 'יישור מושלם! גוף ישר כמו קרש - אלוף!', en: 'Perfect alignment! Body straight as a board - champion!' } };
    } else if (bodyAngle >= 160 && bodyAngle < 170) {
      feedback = { type: 'info', text: 'טוב! נסה ליישר עוד קצת',
                   coaching: { he: 'כמעט מושלם - ישר את הגוף עוד קצת', en: 'Almost perfect - straighten your body a bit more' } };
    } else if (bodyAngle < 160) {
      feedback = { type: 'warning', text: 'הירכיים גבוהות מדי! הורד אותן ושמור על גב ישר',
                   coaching: { he: 'הירכיים עולות למעלה - הורד אותן לקו ישר עם הכתפיים והקרסוליים', en: 'Hips piking up - lower them in line with shoulders and ankles' } };
    } else if (bodyAngle > 180) {
      // Check if hips are sagging
      const midY = (shoulder.y + ankle.y) / 2;
      if (hip.y > midY) {
        feedback = { type: 'warning', text: 'הירכיים שוקעות! הרם אותן ושמור על בטן אסופה',
                     coaching: { he: 'הירכיים שוקעות - כווץ את הבטן והרם את האגן. דמיין קו ישר מראש לעקב', en: 'Hips sagging - tighten abs and lift pelvis. Imagine a straight line from head to heels' } };
      }
    }

    // Knee check: if knees are bent significantly
    if (knee && Math.abs(knee.y - ankle.y) > 0.08) {
      feedback = { type: 'warning', text: 'ישר את הרגליים! הברכיים כפופות',
                   coaching: { he: 'הברכיים כפופות - ישר את הרגליים לגמרי. רגליים ישרות = הפעלת ליבה חזקה יותר', en: 'Knees bent - straighten your legs fully. Straight legs = stronger core activation' } };
    }
  }

  return { ...prevState, feedback, bodyAngle: Math.round(bodyAngle), moving, headDown: false, isActive: isInPlankPosition, firstRepStarted: isInPlankPosition || prevState.firstRepStarted, lastRepTime: isInPlankPosition ? Date.now() : prevState.lastRepTime, posture, _prevLandmarks: landmarks };
}

// --- Dribbling / center of gravity analysis ---
export function analyzeDribbling(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  // Gate: if sitting or unknown posture, no technique feedback at all
  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const nose = landmarks[LM.NOSE];
  const leftHip = landmarks[LM.LEFT_HIP];
  const rightHip = landmarks[LM.RIGHT_HIP];

  if (!nose || !leftHip || !rightHip) return { ...prevState, feedback: null, posture, moving, headDown: false, _prevLandmarks: landmarks };

  const hipCenter = (leftHip.y + rightHip.y) / 2;
  const cogRatio = hipCenter / nose.y;
  let feedback = null;

  // ONLY give technique feedback when actively moving AND standing
  const firstRepStarted = prevState.firstRepStarted || false;
  let newFirstRep = firstRepStarted;

  if (moving && posture === 'standing') {
    newFirstRep = true;
  }

  // Only technical feedback after first movement is detected
  if (newFirstRep && moving) {
    if (cogRatio > 1.5) {
      feedback = { type: 'good', text: 'מרכז כובד נמוך, מעולה! כל הכבוד!' };
    } else if (cogRatio < 1.2) {
      feedback = { type: 'warning', text: 'הנמך את מרכז הכובד! כופף את הברכיים' };
    } else {
      feedback = { type: 'info', text: 'טוב, נסה להנמיך עוד קצת לאיזון טוב יותר' };
    }

    const hipDiff = Math.abs(leftHip.y - rightHip.y);
    if (hipDiff > 0.05) {
      feedback = { type: 'warning', text: 'שמור על גוף ישר! אתה נוטה לצד' };
    }
  }
  // No feedback when standing still or sitting

  return { ...prevState, feedback, cogRatio: cogRatio.toFixed(2), moving, headDown: newFirstRep ? headDown : false, lastRepTime: moving ? Date.now() : prevState.lastRepTime, firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks };
}

// ==========================================
// WARM-UP ANALYZERS
// ==========================================

// --- Arm circles: detect wrist movement amplitude around shoulder ---
export function analyzeArmCircles(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const bodyMoving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  if (!lShoulder || !lWrist) return { ...prevState, feedback: null, posture, moving: bodyMoving, _prevLandmarks: landmarks };

  // Track wrist Y min/max over recent frames for amplitude detection
  const history = prevState._wristHistory || [];
  const wristY = (lWrist.y + (rWrist?.visibility > 0.3 ? rWrist.y : lWrist.y)) / 2;
  history.push(wristY);
  if (history.length > 30) history.shift(); // ~0.5s window at 60fps

  // Also track wrist X for horizontal circles
  const historyX = prevState._wristHistoryX || [];
  const wristX = (lWrist.x + (rWrist?.visibility > 0.3 ? rWrist.x : lWrist.x)) / 2;
  historyX.push(wristX);
  if (historyX.length > 30) historyX.shift();

  let feedback = null;
  const amplitudeY = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;
  const amplitudeX = historyX.length > 10
    ? Math.max(...historyX) - Math.min(...historyX)
    : 0;
  // Use the larger of X or Y amplitude — arm circles can be in any plane
  const amplitude = Math.max(amplitudeY, amplitudeX);

  // Arm circles: wrist moves even when torso stays still
  // Detect wrist-specific movement by comparing wrist position frame-to-frame
  let wristMoving = false;
  if (prevState._prevWristY !== undefined) {
    const wristDelta = Math.abs(wristY - prevState._prevWristY) + Math.abs(wristX - (prevState._prevWristX || wristX));
    wristMoving = wristDelta > 0.005;
  }

  // moving = body movement OR wrist movement (arm circles don't move the torso)
  const moving = bodyMoving || wristMoving;

  if (moving && amplitude > 0.12) {
    feedback = { type: 'good', text: null }; // good movement, no text needed
  } else if (moving && amplitude > 0.04 && amplitude <= 0.12) {
    feedback = { type: 'warning', text: 'armCirclesSmall' }; // marker for TTS
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState,
    feedback,
    posture,
    moving,
    _wristHistory: history,
    _wristHistoryX: historyX,
    _prevWristY: wristY,
    _prevWristX: wristX,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- High knees: detect knee height relative to hip ---
export function analyzeHighKnees(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];

  if (!lHip || !lKnee) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  const hipY = (lHip.y + (rHip?.visibility > 0.3 ? rHip.y : lHip.y)) / 2;
  // Check if either knee is near or above hip level (Y decreases upward)
  const leftKneeHigh = lKnee?.visibility > 0.3 && (hipY - lKnee.y) > 0.02;
  const rightKneeHigh = rKnee?.visibility > 0.3 && (hipY - rKnee.y) > 0.02;
  const kneeIsHigh = leftKneeHigh || rightKneeHigh;

  // Count knee lifts
  const wasHigh = prevState._kneeWasHigh || false;
  let reps = prevState.reps || 0;
  let feedback = null;

  if (kneeIsHigh && !wasHigh) {
    reps++;
    feedback = { type: 'count', text: `${reps}!`, count: reps };
  }

  // Check knee height quality - is it high enough?
  if (kneeIsHigh) {
    const bestKneeGap = Math.max(
      lKnee?.visibility > 0.3 ? hipY - lKnee.y : 0,
      rKnee?.visibility > 0.3 ? hipY - rKnee.y : 0
    );
    // Knee barely reaches hip level
    if (bestKneeGap < 0.05 && bestKneeGap > 0.02) {
      feedback = { type: 'warning', text: 'kneesHigher' };
    }
  } else if (!moving && (prevState.reps || 0) > 0) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState,
    reps,
    feedback,
    posture,
    moving,
    _kneeWasHigh: kneeIsHigh,
    lastRepTime: kneeIsHigh ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Side-to-side steps: detect lateral hip movement ---
export function analyzeSideSteps(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  if (!lHip || !rHip) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  const hipCenterX = (lHip.x + rHip.x) / 2;

  // Track lateral position history
  const history = prevState._hipXHistory || [];
  history.push(hipCenterX);
  if (history.length > 30) history.shift();

  let feedback = null;
  const lateralRange = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && lateralRange > 0.08) {
    feedback = { type: 'good', text: null }; // good lateral movement
  } else if (moving && lateralRange > 0.03 && lateralRange <= 0.08) {
    feedback = { type: 'warning', text: 'widerSteps' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState,
    feedback,
    posture,
    moving,
    _hipXHistory: history,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// ==========================================
// ADAPTIVE WARM-UP: Disability context
// ==========================================

export function getDisabilityContext(userProfile) {
  if (!userProfile) return { type: 'none', usesCrutches: false, usesWheelchair: false, limitations: new Set() };

  const disability = userProfile.disability || 'none';
  const mobilityAid = userProfile.mobilityAid || 'none';
  const limitations = new Set();

  if (disability === 'one_leg' || disability === 'two_legs' || mobilityAid === 'wheelchair')
    limitations.add('lower_limb');
  if (disability === 'one_arm') limitations.add('upper_limb');
  if (mobilityAid === 'crutches') limitations.add('shoulder_strain');
  if (disability === 'other') { limitations.add('lower_limb'); limitations.add('shoulder_strain'); }

  return {
    type: disability,
    usesCrutches: mobilityAid === 'crutches',
    usesWheelchair: mobilityAid === 'wheelchair',
    limitations
  };
}

// Backward-compat wrapper
export function getLimitations(userProfile) {
  return getDisabilityContext(userProfile).limitations;
}

// --- Single Leg High Knee: adapted for one_leg + crutches ---
export function analyzeSingleLegHighKnee(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const leg = getStandingLeg(landmarks);
  const hip = landmarks[leg === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
  const knee = landmarks[leg === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];

  if (!hip || !knee) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  const hipY = hip.y;
  const kneeHigh = (hipY - knee.y) > 0.01; // Lower threshold for crutch-supported lift

  const wasHigh = prevState._kneeWasHigh || false;
  let reps = prevState.reps || 0;
  let feedback = null;

  if (kneeHigh && !wasHigh) {
    reps++;
    feedback = { type: 'count', text: `${reps}!`, count: reps };
  }

  if (kneeHigh) {
    const kneeGap = hipY - knee.y;
    if (kneeGap < 0.04 && kneeGap > 0.01) {
      feedback = { type: 'warning', text: 'kneeToChest' };
    }
  } else if (!moving && (prevState.reps || 0) > 0) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState, reps, feedback, posture, moving,
    _kneeWasHigh: kneeHigh,
    lastRepTime: kneeHigh ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Forward Kicks: for one_leg crutch users ---
export function analyzeForwardKicks(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const leg = getStandingLeg(landmarks);
  const hip = landmarks[leg === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
  const ankle = landmarks[leg === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

  if (!hip || !ankle) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  // Track ankle X displacement from hip (forward kick = ankle moves away from hip X)
  const history = prevState._ankleXHistory || [];
  const ankleXDisp = Math.abs(ankle.x - hip.x);
  history.push(ankleXDisp);
  if (history.length > 30) history.shift();

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && amplitude > 0.08) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.03 && amplitude <= 0.08) {
    feedback = { type: 'warning', text: 'kickHigher' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState, feedback, posture, moving,
    _ankleXHistory: history,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Balance Hops: for one_leg crutch users ---
export function analyzeBalanceHops(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  if (!lHip) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  const hipCenterY = (lHip.y + (rHip?.visibility > 0.3 ? rHip.y : lHip.y)) / 2;
  const history = prevState._hipYHistory || [];
  history.push(hipCenterY);
  if (history.length > 30) history.shift();

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && amplitude > 0.04) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.01 && amplitude <= 0.04) {
    feedback = { type: 'warning', text: 'hopMore' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState, feedback, posture, moving,
    _hipYHistory: history,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Single Arm Rotation: for one_arm users ---
export function analyzeSingleArmRotation(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const bodyMoving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  // Use whichever wrist has higher visibility (the remaining arm)
  const wrist = (lWrist?.visibility || 0) >= (rWrist?.visibility || 0) ? lWrist : rWrist;
  if (!wrist || wrist.visibility < 0.3) return { ...prevState, feedback: null, posture, moving: bodyMoving, _prevLandmarks: landmarks };

  const history = prevState._wristHistory || [];
  history.push(wrist.y);
  if (history.length > 30) history.shift();

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  // Detect wrist movement even when torso is still
  let wristMoving = false;
  if (prevState._prevWristY !== undefined) {
    wristMoving = Math.abs(wrist.y - prevState._prevWristY) + Math.abs(wrist.x - (prevState._prevWristX || wrist.x)) > 0.005;
  }
  const moving = bodyMoving || wristMoving;

  if (moving && amplitude > 0.12) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.04 && amplitude <= 0.12) {
    feedback = { type: 'warning', text: 'singleArmSmall' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState, feedback, posture, moving,
    _wristHistory: history,
    _prevWristY: wrist.y,
    _prevWristX: wrist.x,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Arm punches: upper-body replacement for high knees ---
export function analyzeArmPunches(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const bodyMoving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  if (!lWrist) return { ...prevState, feedback: null, posture, moving: bodyMoving, _prevLandmarks: landmarks };

  // Track wrist X-axis oscillation (forward/back punching amplitude)
  const history = prevState._wristXHistory || [];
  const wristX = (lWrist.x + (rWrist?.visibility > 0.3 ? rWrist.x : lWrist.x)) / 2;
  history.push(wristX);
  if (history.length > 30) history.shift();

  // Track wrist Y too for upward punches
  const wristY = (lWrist.y + (rWrist?.visibility > 0.3 ? rWrist.y : lWrist.y)) / 2;

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  // Detect wrist movement even when torso is still (punching in place)
  let wristMoving = false;
  if (prevState._prevPunchX !== undefined) {
    wristMoving = Math.abs(wristX - prevState._prevPunchX) + Math.abs(wristY - (prevState._prevPunchY || wristY)) > 0.005;
  }
  const moving = bodyMoving || wristMoving;

  if (moving && amplitude > 0.10) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.03 && amplitude <= 0.10) {
    feedback = { type: 'warning', text: 'armPunchesSmall' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState,
    feedback,
    posture,
    moving,
    _wristXHistory: history,
    _prevPunchX: wristX,
    _prevPunchY: wristY,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Core twists: shoulder-safe replacement for arm circles ---
export function analyzeCoreTwists(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['shoulders', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];

  if (!lShoulder || !rShoulder) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  // Track shoulder X oscillation (torso rotation)
  const history = prevState._shoulderXHistory || [];
  const shoulderDiffX = Math.abs(lShoulder.x - rShoulder.x);
  history.push(shoulderDiffX);
  if (history.length > 30) history.shift();

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && amplitude > 0.06) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.02 && amplitude <= 0.06) {
    feedback = { type: 'warning', text: 'twistMore' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState,
    feedback,
    posture,
    moving,
    _shoulderXHistory: history,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// Substitute warm-up exercise definitions
const WARM_UP_ARM_PUNCHES = {
  id: 'arm_punches',
  name: { he: 'אגרופים קדימה', en: 'Arm Punches' },
  description: { he: 'הושט את הזרועות קדימה ואחורה בתנועת אגרוף', en: 'Extend your arms forward and back in a punching motion' },
  duration: 45,
  analyze: analyzeArmPunches,
};

const WARM_UP_CORE_TWISTS = {
  id: 'core_twists',
  name: { he: 'סיבובי גוף', en: 'Core Twists' },
  description: { he: 'סובב את פלג הגוף העליון מצד לצד', en: 'Rotate your upper body side to side' },
  duration: 45,
  analyze: analyzeCoreTwists,
};

// Adapted warm-up exercises for disabilities
const WARM_UP_SINGLE_LEG_HIGH_KNEE = {
  id: 'single_leg_high_knee',
  name: { he: 'הרמת ברך', en: 'High Knee Raise' },
  description: { he: 'הרם את הברך לכיוון החזה תוך שמירה על יציבות', en: 'Raise your knee toward your chest while maintaining balance' },
  duration: 45, analyze: analyzeSingleLegHighKnee,
};

const WARM_UP_FORWARD_KICKS = {
  id: 'forward_kicks_crutches',
  name: { he: 'בעיטות חימום', en: 'Warm-up Kicks' },
  description: { he: 'בעט קדימה ברגל לחימום שרירי הירך', en: 'Kick forward to warm up your thigh muscles' },
  duration: 45, analyze: analyzeForwardKicks,
};

const WARM_UP_BALANCE_HOPS = {
  id: 'balance_hops',
  name: { he: 'קפיצות איזון', en: 'Balance Hops' },
  description: { he: 'קפיצות קטנות במקום תוך שמירה על יציבות עם הקביים', en: 'Small hops in place while maintaining balance with crutches' },
  duration: 45, analyze: analyzeBalanceHops,
};

const WARM_UP_SINGLE_ARM_ROTATION = {
  id: 'single_arm_rotation',
  name: { he: 'סיבוב יד אחת', en: 'Single Arm Rotation' },
  description: { he: 'סובב את היד הפעילה שלך בתנועה עגולה רחבה', en: 'Rotate your active arm in wide circular motions' },
  duration: 45, analyze: analyzeSingleArmRotation,
};

// Warm-up exercise definitions
export const WARM_UP_EXERCISES = [
  {
    id: 'arm_circles',
    name: { he: 'סיבובי ידיים', en: 'Arm Circles' },
    description: { he: 'סובב את הזרועות בתנועה עגולה', en: 'Rotate your arms in circular motions' },
    duration: 45,
    analyze: analyzeArmCircles,
  },
  {
    id: 'high_knees',
    name: { he: 'ברכיים למעלה', en: 'High Knees' },
    description: { he: 'הרם את הברכיים לגובה המותניים בזו אחר זו', en: 'Lift your knees to waist height alternately' },
    duration: 45,
    analyze: analyzeHighKnees,
  },
  {
    id: 'side_steps',
    name: { he: 'צעדי רדיפה', en: 'Side-to-Side Steps' },
    description: { he: 'צעד לצדדים בתנועה מהירה', en: 'Step side to side quickly' },
    duration: 45,
    analyze: analyzeSideSteps,
  },
];

// Build adaptive warm-up list based on user profile disability context
export function getWarmUpExercises(userProfile) {
  const ctx = getDisabilityContext(userProfile);

  // One-leg amputee with crutches — amputee football warm-up
  if (ctx.type === 'one_leg' && ctx.usesCrutches) {
    return [WARM_UP_SINGLE_LEG_HIGH_KNEE, WARM_UP_FORWARD_KICKS, WARM_UP_BALANCE_HOPS];
  }
  // One-leg without crutches (prosthesis) — adapted high knees + standard
  if (ctx.type === 'one_leg') {
    return [WARM_UP_EXERCISES[0], WARM_UP_SINGLE_LEG_HIGH_KNEE, WARM_UP_EXERCISES[2]];
  }
  // Upper-limb amputee — single arm rotation + standard legs
  if (ctx.type === 'one_arm') {
    return [WARM_UP_SINGLE_ARM_ROTATION, WARM_UP_EXERCISES[1], WARM_UP_EXERCISES[2]];
  }
  // Wheelchair / two-legs — upper body focused
  if (ctx.type === 'two_legs' || ctx.usesWheelchair) {
    return [WARM_UP_EXERCISES[0], WARM_UP_ARM_PUNCHES, WARM_UP_CORE_TWISTS];
  }
  // 'other' — conservative upper body set
  if (ctx.type === 'other') {
    return [WARM_UP_CORE_TWISTS, WARM_UP_ARM_PUNCHES, WARM_UP_EXERCISES[2]];
  }
  // Default (no disability)
  return [...WARM_UP_EXERCISES];
}

// ==========================================
// STRENGTH EXERCISE ANALYZERS
// ==========================================

// --- Generic rep counter: tracks coordinated body movement (multi-joint) ---
// Requires shoulder + hip + wrist to ALL move vertically in sync to prevent
// false reps from head nods, camera shake, or air movements.
export function analyzeGenericReps(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false,
             firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lm = (idx) => landmarks[idx];
  const v = (idx) => lm(idx) && lm(idx).visibility > 0.3;

  // REQUIRE: Both shoulders AND both hips visible
  if (!v(LM.LEFT_SHOULDER) || !v(LM.RIGHT_SHOULDER) ||
      !v(LM.LEFT_HIP) || !v(LM.RIGHT_HIP)) {
    return { ...prevState, feedback: { type: 'visibility', text: 'הזז את המצלמה כדי שאראה את כל הגוף' },
             posture, moving, headDown, _prevLandmarks: landmarks };
  }

  // === ANGLE-BASED REP COUNTING — no Y-position dependency ===
  // Track the primary changing joint angle (elbow OR knee)
  let elbowAngle = null;
  if (v(LM.LEFT_SHOULDER) && v(LM.LEFT_ELBOW) && v(LM.LEFT_WRIST)) {
    elbowAngle = angle(lm(LM.LEFT_SHOULDER), lm(LM.LEFT_ELBOW), lm(LM.LEFT_WRIST));
  } else if (v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_ELBOW) && v(LM.RIGHT_WRIST)) {
    elbowAngle = angle(lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_ELBOW), lm(LM.RIGHT_WRIST));
  }

  let kneeAngle = null;
  if (v(LM.LEFT_HIP) && v(LM.LEFT_KNEE) && v(LM.LEFT_ANKLE)) {
    kneeAngle = angle(lm(LM.LEFT_HIP), lm(LM.LEFT_KNEE), lm(LM.LEFT_ANKLE));
  } else if (v(LM.RIGHT_HIP) && v(LM.RIGHT_KNEE) && v(LM.RIGHT_ANKLE)) {
    kneeAngle = angle(lm(LM.RIGHT_HIP), lm(LM.RIGHT_KNEE), lm(LM.RIGHT_ANKLE));
  }

  // Hip angle (shoulder-hip-knee) — detects bending at the waist
  let hipAngle = null;
  if (v(LM.LEFT_SHOULDER) && v(LM.LEFT_HIP) && v(LM.LEFT_KNEE)) {
    hipAngle = angle(lm(LM.LEFT_SHOULDER), lm(LM.LEFT_HIP), lm(LM.LEFT_KNEE));
  } else if (v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_HIP) && v(LM.RIGHT_KNEE)) {
    hipAngle = angle(lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_HIP), lm(LM.RIGHT_KNEE));
  }

  // Must have at least one trackable joint angle
  if (elbowAngle == null && kneeAngle == null && hipAngle == null) {
    return { ...prevState, feedback: { type: 'visibility', text: 'הזז את המצלמה כדי שאראה את המפרקים' },
             posture, moving, headDown, _prevLandmarks: landmarks };
  }

  // Build angle history (track all available angles)
  const angleHistory = prevState._angleHistory || [];
  angleHistory.push({ elbow: elbowAngle, knee: kneeAngle, hip: hipAngle });
  if (angleHistory.length > 60) angleHistory.shift();

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'idle';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let firstRepStarted = prevState.firstRepStarted || false;
  let phaseStartAngle = prevState._phaseStartAngle;

  // Determine which joint has the most variation — that's the primary exercise joint
  if (angleHistory.length >= 20) {
    const recent = angleHistory.slice(-20);

    // Calculate range for each joint type
    let bestJoint = null;
    let bestRange = 0;
    let bestCurrent = null;
    let bestMin = null;
    let bestMax = null;

    for (const jointKey of ['elbow', 'knee', 'hip']) {
      const vals = recent.map(f => f[jointKey]).filter(v => v != null);
      if (vals.length < 10) continue;
      const jMin = Math.min(...vals);
      const jMax = Math.max(...vals);
      const range = jMax - jMin;
      if (range > bestRange) {
        bestRange = range;
        bestJoint = jointKey;
        bestCurrent = vals[vals.length - 1];
        bestMin = jMin;
        bestMax = jMax;
      }
    }

    // STRICT: require at least 25° range of motion in the primary joint
    // Head nods cause <5° change in elbow/knee/hip angles
    if (bestJoint && bestRange > 25 && bestCurrent != null) {
      firstRepStarted = true;

      if (phase === 'idle' || phase === 'up') {
        // Angle decreasing significantly → flexion phase (going down)
        if (bestCurrent < bestMin + bestRange * 0.3) {
          newPhase = 'down';
          phaseStartAngle = bestCurrent;
        }
      } else if (phase === 'down') {
        // Angle increasing back to near max → extension phase (going up) = 1 rep
        if (bestCurrent > bestMin + bestRange * 0.7 && canCountRep(lastRepTime)) {
          const romDelta = phaseStartAngle != null ? Math.abs(bestCurrent - phaseStartAngle) : bestRange;
          // Must have at least 20° of actual ROM in this rep
          if (romDelta > 20) {
            newPhase = 'up';
            newReps = reps + 1;
            lastRepTime = Date.now();
            feedback = { type: 'count', text: `${newReps}!`, count: newReps };
          }
        }
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture, _phaseStartAngle: phaseStartAngle,
    _angleHistory: angleHistory, _prevLandmarks: landmarks,
  };
}

// --- Bicep Curl: elbow angle tracking ---
export function analyzeBicepCurl(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  // Use whichever side is more visible
  let shoulder, elbow, wrist, hip;
  if ((landmarks[LM.LEFT_ELBOW]?.visibility || 0) >= (landmarks[LM.RIGHT_ELBOW]?.visibility || 0)) {
    shoulder = landmarks[LM.LEFT_SHOULDER]; elbow = landmarks[LM.LEFT_ELBOW];
    wrist = landmarks[LM.LEFT_WRIST]; hip = landmarks[LM.LEFT_HIP];
  } else {
    shoulder = landmarks[LM.RIGHT_SHOULDER]; elbow = landmarks[LM.RIGHT_ELBOW];
    wrist = landmarks[LM.RIGHT_WRIST]; hip = landmarks[LM.RIGHT_HIP];
  }

  if (!shoulder || !elbow || !wrist || elbow.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  const rawElbowAngle = angle(shoulder, elbow, wrist);
  const elbowAngle = smoothAngle(rawElbowAngle, prevState, '_smoothElbow');
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? elbowAngle;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;

  if (phase === 'down' && elbowAngle < 50) {
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartAngle = elbowAngle;
    newRepCounted = false;
    feedback = { type: 'info', text: 'כיווץ מעולה! החזק רגע למעלה' };
  } else if (phase === 'up') {
    // Early count at 80% of return phase
    const earlyThreshold = phaseStartAngle + (150 - phaseStartAngle) * 0.8;
    if (!repCounted && elbowAngle > earlyThreshold && meetsMinROM(prevState, 'elbow', elbowAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      const romDelta = Math.abs(elbowAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 100) {
        coaching = { he: 'מעולה! טווח תנועה מלא ושליטה מושלמת', en: 'Excellent! Full range of motion with perfect control' };
      } else if (romDelta > 70) {
        coaching = { he: 'טוב. נסה לכופף יותר - הבא את כף היד עד לכתף', en: 'Good. Try curling more - bring hand all the way to shoulder' };
      } else {
        coaching = { he: 'כופף יותר! טווח תנועה חלקי לא בונה שריר מקסימלי', en: 'Curl more! Partial range won\'t build maximum muscle' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset at full extension
    if (elbowAngle > 150) {
      newPhase = 'down';
      newRepCounted = false;
      newPhaseStartAngle = elbowAngle;
    }
  }

  // Good form: elbow stays tight AND no shrug → positive feedback
  let formGood = true;

  // Form: elbow drifting from torso (body swinging)
  if (newFirstRep && hip && elbow.visibility > 0.3) {
    const elbowDrift = Math.abs(elbow.x - hip.x);
    if (elbowDrift > 0.12) {
      feedback = { type: 'warning', text: 'שמור את המרפקים צמודים לגוף! אל תיתן להם לזוז',
                   coaching: { he: 'הגוף מתנדנד - נעל את המרפקים ליד הגוף. רק האמה זזה, לא הזרוע כולה', en: 'Body swinging - lock elbows to your sides. Only forearm moves, not the whole arm' } };
      formGood = false;
    }
  }

  // Form: shoulder shrug
  if (newFirstRep && shoulder && elbowAngle < 60) {
    const shoulderShrug = (prevState._prevShoulderY || shoulder.y) - shoulder.y;
    if (shoulderShrug > 0.02) {
      feedback = { type: 'warning', text: 'אל תרים את הכתפיים! רק המרפקים זזים, הכתפיים נשארות למטה',
                   coaching: { he: 'הכתפיים עולות למעלה - שחרר אותן למטה. זה מעמיס על הטרפז במקום הביספ', en: 'Shoulders rising - drop them down. This loads traps instead of biceps' } };
      formGood = false;
    }
  }

  // Form: not going full range
  if (newFirstRep && newPhase === 'up' && elbowAngle > 80 && elbowAngle < 120) {
    feedback = { type: 'warning', text: 'כווץ עד הסוף! הביא את היד לכתף',
                 coaching: { he: 'כופף יותר - הבא את כף היד עד לכתף. טווח תנועה מלא = שריר חזק יותר', en: 'Curl fully - bring hand to shoulder. Full ROM = stronger muscle' } };
    formGood = false;
  }

  // Good form positive reinforcement (every 3 reps)
  if (formGood && newReps > 0 && newReps % 3 === 0 && newPhase === 'down' && feedback?.type === 'count') {
    feedback = { type: 'good', text: 'טכניקה מושלמת! מרפקים צמודים, כל הכבוד!',
                 coaching: { he: 'טכניקה מושלמת! מרפקים צמודים, תנועה מבוקרת - אתה אלוף!', en: 'Perfect technique! Elbows locked, controlled movement - you\'re a champion!' } };
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartAngle: newPhaseStartAngle, _smoothElbow: elbowAngle, _prevShoulderY: shoulder.y, _repCounted: newRepCounted, _prevLandmarks: landmarks
  };
}

// --- Bent Over Row: torso angle + wrist Y relative to hip ---
export function analyzeBentOverRow(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const shoulder = landmarks[LM.LEFT_SHOULDER];
  const hip = landmarks[LM.LEFT_HIP];
  const knee = landmarks[LM.LEFT_KNEE];
  const wrist = landmarks[LM.LEFT_WRIST];

  if (!shoulder || !hip || !wrist || shoulder.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  // Torso angle: shoulder-hip-knee
  const torsoAngle = knee ? angle(shoulder, hip, knee) : 180;
  const wristToHipY = hip.y - wrist.y; // positive = wrist above hip

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartY = prevState._phaseStartY ?? wristToHipY;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartY = phaseStartY;

  if (phase === 'down' && wristToHipY > 0.05) {
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartY = wristToHipY;
    feedback = { type: 'info', text: 'משיכה טובה! כווץ את הגב' };
  } else if (phase === 'up' && wristToHipY < -0.02) {
    const yDelta = Math.abs(wristToHipY - phaseStartY);
    if (yDelta >= MIN_ROM_DEFAULTS.yDelta && canCountRep(lastRepTime)) {
      newPhase = 'down';
      newReps = reps + 1;
      lastRepTime = Date.now();
      newPhaseStartY = wristToHipY;
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }
  }

  // Form: torso too upright or too low
  if (newFirstRep && torsoAngle > 160) {
    feedback = { type: 'warning', text: 'הרכן את הגוף יותר קדימה! זווית של 45 מעלות, גב ישר' };
  } else if (newFirstRep && torsoAngle < 60) {
    feedback = { type: 'warning', text: 'אל תרכן יותר מדי! תשמור על גב ישר, אתה מסתכן בפציעה' };
  }

  // Good form every 3 reps
  if (newReps > 0 && newReps % 3 === 0 && torsoAngle >= 80 && torsoAngle <= 130 && feedback?.type === 'count') {
    feedback = { type: 'good', text: 'טכניקה מעולה! זווית גוף מושלמת' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartY: newPhaseStartY, _prevLandmarks: landmarks
  };
}

// --- Lateral Raise: wrist Y relative to shoulder ---
export function analyzeLateralRaise(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lElbow = landmarks[LM.LEFT_ELBOW];

  if (!lShoulder || !lWrist || lShoulder.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  const shoulderY = (lShoulder.y + (rShoulder?.y || lShoulder.y)) / 2;
  const wristY = (lWrist.y + (rWrist?.visibility > 0.3 ? rWrist.y : lWrist.y)) / 2;
  const wristRelShoulder = shoulderY - wristY; // positive = wrist above shoulder

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartY = prevState._phaseStartY ?? wristRelShoulder;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartY = phaseStartY;

  if (phase === 'down' && wristRelShoulder > -0.02) {
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartY = wristRelShoulder;
    feedback = { type: 'info', text: 'הרמה יפה!' };
  } else if (phase === 'up' && wristRelShoulder < -0.10) {
    const yDelta = Math.abs(wristRelShoulder - phaseStartY);
    if (yDelta >= MIN_ROM_DEFAULTS.yDelta && canCountRep(lastRepTime)) {
      newPhase = 'down';
      newReps = reps + 1;
      lastRepTime = Date.now();
      newPhaseStartY = wristRelShoulder;
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }
  }

  // Form: wrists too high above shoulders
  if (newFirstRep && wristRelShoulder > 0.08) {
    feedback = { type: 'warning', text: 'אל תרים מעל גובה הכתפיים!' };
  }

  // Form: elbows too straight (should have slight bend)
  if (newFirstRep && lElbow?.visibility > 0.3 && lShoulder && lWrist) {
    const elbAngle = angle(lShoulder, lElbow, lWrist);
    if (elbAngle > 170) {
      feedback = { type: 'warning', text: 'כופף קצת את המרפקים!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartY: newPhaseStartY, _prevLandmarks: landmarks
  };
}

// --- Glute Bridge: hip Y position rise/fall ---
export function analyzeGluteBridge(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const lKnee = landmarks[LM.LEFT_KNEE];

  if (!lHip || !lShoulder || lHip.visibility < 0.3) {
    return { ...prevState, feedback: null, posture: 'unknown', moving, _prevLandmarks: landmarks };
  }

  const hipY = (lHip.y + (rHip?.visibility > 0.3 ? rHip.y : lHip.y)) / 2;
  const shoulderY = lShoulder.y;

  // Track hip height relative to baseline
  const baselineHipY = prevState._baselineHipY || hipY;
  const hipRise = baselineHipY - hipY; // positive = hip rising

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newBaseline = baselineHipY;

  // Update baseline when hip is at its lowest
  if (hipY > baselineHipY) newBaseline = hipY;

  // Track phase start for ROM validation
  const phaseStartRise = prevState._phaseStartRise ?? hipRise;
  let newPhaseStartRise = phaseStartRise;

  if (phase === 'down' && hipRise > 0.04) {
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartRise = hipRise;
    feedback = { type: 'info', text: 'הרמה יפה!' };
  } else if (phase === 'up' && hipRise < 0.01) {
    const delta = Math.abs(hipRise - phaseStartRise);
    if (delta >= MIN_ROM_DEFAULTS.yDelta) {
      newPhase = 'down';
      newReps = reps + 1;
      lastRepTime = Date.now();
      newPhaseStartRise = hipRise;
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }
  }

  // Form: hip not high enough
  if (newFirstRep && newPhase === 'up' && hipRise < 0.03 && hipRise > 0.01) {
    feedback = { type: 'warning', text: 'הרם את הירכיים יותר גבוה! סחוט את הישבן חזק למעלה' };
  }

  // Good form every 3 reps
  if (newReps > 0 && newReps % 3 === 0 && hipRise > 0.04 && feedback?.type === 'count') {
    feedback = { type: 'good', text: 'גובה מעולה! תחזיק שנייה למעלה' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: false, lastRepTime, firstRepStarted: newFirstRep,
    posture: 'floor', _baselineHipY: newBaseline, _phaseStartRise: newPhaseStartRise, _prevLandmarks: landmarks
  };
}

// --- Tricep Extension: arms overhead, elbow angle ---
export function analyzeTricepExtension(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  let shoulder, elbow, wrist;
  if ((landmarks[LM.LEFT_ELBOW]?.visibility || 0) >= (landmarks[LM.RIGHT_ELBOW]?.visibility || 0)) {
    shoulder = landmarks[LM.LEFT_SHOULDER]; elbow = landmarks[LM.LEFT_ELBOW]; wrist = landmarks[LM.LEFT_WRIST];
  } else {
    shoulder = landmarks[LM.RIGHT_SHOULDER]; elbow = landmarks[LM.RIGHT_ELBOW]; wrist = landmarks[LM.RIGHT_WRIST];
  }

  if (!shoulder || !elbow || !wrist || elbow.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  const rawElbowAngle = angle(shoulder, elbow, wrist);
  const elbowAngle = smoothAngle(rawElbowAngle, prevState, '_smoothElbow');
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? elbowAngle;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;

  if (phase === 'down' && elbowAngle < 90) {
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartAngle = elbowAngle;
    feedback = { type: 'info', text: 'ירידה טובה!' };
  } else if (phase === 'up' && elbowAngle > 150) {
    if (meetsMinROM(prevState, 'elbow', elbowAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newPhase = 'down';
      newReps = reps + 1;
      lastRepTime = Date.now();
      newPhaseStartAngle = elbowAngle;
      const romDelta = Math.abs(elbowAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 80) {
        coaching = { he: 'מצוין! טווח תנועה מלא - הטריצפס עובד מקסימום', en: 'Excellent! Full ROM - triceps working at maximum' };
      } else if (romDelta > 50) {
        coaching = { he: 'טוב! כופף את המרפקים עוד קצת לירידה עמוקה יותר', en: 'Good! Bend elbows a bit more for deeper extension' };
      } else {
        coaching = { he: 'כופף יותר! הורד את המשקל עד מאחורי הראש', en: 'Bend more! Lower the weight behind your head' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
  }

  // Form: elbows flaring out
  let tricepFormGood = true;
  if (newFirstRep && shoulder && elbow) {
    const elbowSpread = Math.abs(elbow.x - shoulder.x);
    if (elbowSpread > 0.10) {
      feedback = { type: 'warning', text: 'שמור את המרפקים קרובים לראש! אל תיתן להם להתפשט',
                   coaching: { he: 'המרפקים מתרחקים מהראש - שמור אותם צמודים! מרפקים רחבים מעבירים עומס לכתפיים', en: 'Elbows flaring out - keep them close to head! Wide elbows shift load to shoulders' } };
      tricepFormGood = false;
    }
  }

  // Form: not extending fully
  if (newFirstRep && newPhase === 'up' && elbowAngle > 120 && elbowAngle < 145) {
    feedback = { type: 'warning', text: 'יישר את הזרועות עד הסוף! טווח תנועה מלא',
                 coaching: { he: 'יישר את הזרועות עד הסוף! נעילת המרפקים למעלה מפעילה את הטריצפס באופן מקסימלי', en: 'Extend arms fully! Locking out activates triceps maximally' } };
    tricepFormGood = false;
  }

  // Good form every 3 reps
  if (tricepFormGood && newReps > 0 && newReps % 3 === 0 && feedback?.type === 'count') {
    feedback = { type: 'good', text: 'מרפקים צמודים, תנועה מלאה! מעולה!',
                 coaching: { he: 'טכניקה מצוינת! מרפקים צמודים לראש, תנועה מבוקרת - אתה אלוף!', en: 'Excellent technique! Elbows close to head, controlled movement - champion!' } };
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartAngle: newPhaseStartAngle, _smoothElbow: elbowAngle, _prevLandmarks: landmarks
  };
}

// --- Wall Sit: hold-type, hip-knee ~90°, upright torso ---
export function analyzeWallSit(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);

  const hip = landmarks[LM.LEFT_HIP];
  const knee = landmarks[LM.LEFT_KNEE];
  const ankle = landmarks[LM.LEFT_ANKLE];
  const shoulder = landmarks[LM.LEFT_SHOULDER];

  if (!hip || !knee || !ankle || hip.visibility < 0.3) {
    return { ...prevState, feedback: null, posture: 'unknown', moving, _prevLandmarks: landmarks };
  }

  const kneeAngle = angle(hip, knee, ankle);
  const isInPosition = kneeAngle >= 70 && kneeAngle <= 110;

  let feedback = null;

  if (isInPosition) {
    if (kneeAngle >= 85 && kneeAngle <= 95) {
      feedback = { type: 'good', text: 'מעולה! זווית מושלמת!' };
    }
    // Knees past ankles
    if (knee.x > ankle.x + 0.05 || knee.x < ankle.x - 0.05) {
      // Check if knees are forward of ankles (in profile view, knee.y should be close to ankle.y)
    }
  }

  // Hips dropping
  if (isInPosition && kneeAngle < 75) {
    feedback = { type: 'warning', text: 'עלה קצת! הירכיים יורדות מדי' };
  } else if (isInPosition && kneeAngle > 105) {
    feedback = { type: 'warning', text: 'רד קצת יותר! ברכיים ב-90 מעלות' };
  }

  return {
    ...prevState, feedback, moving, headDown: false,
    isActive: isInPosition,
    firstRepStarted: isInPosition || prevState.firstRepStarted,
    lastRepTime: isInPosition ? Date.now() : prevState.lastRepTime,
    posture: isInPosition ? 'wallsit' : 'standing',
    _prevLandmarks: landmarks
  };
}

// --- Mountain Climbers: plank + knee Y oscillation ---
export function analyzeMountainClimbers(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders', 'legs']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);

  const shoulder = landmarks[LM.LEFT_SHOULDER];
  const hip = landmarks[LM.LEFT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];

  if (!shoulder || !hip || shoulder.visibility < 0.3) {
    return { ...prevState, feedback: null, posture: 'unknown', moving, _prevLandmarks: landmarks };
  }

  // Check plank-like position
  const isPlankLike = hip.y > shoulder.y * 0.8;

  // Track knee Y oscillation
  const kneeY = Math.min(
    lKnee?.visibility > 0.3 ? lKnee.y : 1,
    rKnee?.visibility > 0.3 ? rKnee.y : 1
  );
  const prevKneeY = prevState._prevKneeY || kneeY;
  const kneeMovingUp = prevKneeY - kneeY > 0.02;

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'back';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  const phaseStartKneeY = prevState._phaseStartKneeY ?? kneeY;
  let newPhaseStartKneeY = phaseStartKneeY;

  if (isPlankLike) {
    if (phase === 'back' && kneeY < hip.y - 0.03) {
      newPhase = 'forward';
      newFirstRep = true;
      newPhaseStartKneeY = kneeY;
    } else if (phase === 'forward' && kneeY > hip.y - 0.01) {
      const yDelta = Math.abs(kneeY - phaseStartKneeY);
      if (yDelta >= MIN_ROM_DEFAULTS.yDelta && canCountRep(lastRepTime)) {
        newPhase = 'back';
        newReps = reps + 1;
        lastRepTime = Date.now();
        newPhaseStartKneeY = kneeY;
        feedback = { type: 'count', text: `${newReps}!`, count: newReps };
      }
    }

    // Hips rising warning
    if (newFirstRep && shoulder.y - hip.y > 0.15) {
      feedback = { type: 'warning', text: 'שמור על הירכיים למטה! אל תרים את הישבן, ליבה חזקה' };
    }

    // Good form every 5 reps
    if (newReps > 0 && newReps % 5 === 0 && feedback?.type === 'count') {
      feedback = { type: 'good', text: `${newReps} חזרות! קצב מעולה, המשך ככה!` };
    }
  } else if (moving) {
    // Not in plank position but moving — guide them
    feedback = { type: 'warning', text: 'רד לתנוחת פלאנק! ידיים על הרצפה, גוף ישר' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: false, lastRepTime, firstRepStarted: newFirstRep,
    posture: isPlankLike ? 'plank' : 'unknown', _prevKneeY: kneeY, _phaseStartKneeY: newPhaseStartKneeY, _prevLandmarks: landmarks
  };
}

// --- Crunches: shoulder Y rise from flat ---
export function analyzeCrunches(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['shoulders', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);

  const shoulder = landmarks[LM.LEFT_SHOULDER];
  const hip = landmarks[LM.LEFT_HIP];

  if (!shoulder || !hip || shoulder.visibility < 0.3) {
    return { ...prevState, feedback: null, posture: 'unknown', moving, _prevLandmarks: landmarks };
  }

  // Track shoulder Y relative to hip
  const shoulderToHip = hip.y - shoulder.y; // positive = shoulder above hip
  const baselineY = prevState._baselineY || shoulder.y;

  // Update baseline when shoulder is low
  let newBaseline = baselineY;
  if (shoulder.y > baselineY) newBaseline = shoulder.y;

  const rise = newBaseline - shoulder.y; // positive = rising

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  const phaseStartRise = prevState._phaseStartRise ?? rise;
  let newPhaseStartRise = phaseStartRise;

  if (phase === 'down' && rise > 0.03) {
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartRise = rise;
    feedback = { type: 'info', text: 'כיווץ!' };
  } else if (phase === 'up' && rise < 0.01) {
    const delta = Math.abs(rise - phaseStartRise);
    if (delta >= MIN_ROM_DEFAULTS.yDelta) {
      newPhase = 'down';
      newReps = reps + 1;
      lastRepTime = Date.now();
      newPhaseStartRise = rise;
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }
  }

  // Form: insufficient lift
  if (newFirstRep && newPhase === 'up' && rise < 0.02 && rise > 0.005) {
    feedback = { type: 'warning', text: 'הרם את הכתפיים יותר! כווץ את הבטן' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: false, lastRepTime, firstRepStarted: newFirstRep,
    posture: 'floor', _baselineY: newBaseline, _phaseStartRise: newPhaseStartRise, _prevLandmarks: landmarks
  };
}

// --- Side Plank: hold-type, side orientation + alignment ---
export function analyzeSidePlank(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['shoulders', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);

  const shoulder = landmarks[LM.LEFT_SHOULDER];
  const hip = landmarks[LM.LEFT_HIP];
  const ankle = landmarks[LM.LEFT_ANKLE];

  if (!shoulder || !hip || shoulder.visibility < 0.3) {
    return { ...prevState, feedback: null, posture: 'unknown', moving, _prevLandmarks: landmarks };
  }

  // Side plank: body roughly horizontal, hip off ground
  const bodyAngle = ankle ? angle(shoulder, hip, ankle) : 180;
  const isInPosition = bodyAngle > 150 && hip.y > shoulder.y * 0.85;

  let feedback = null;

  if (isInPosition) {
    if (bodyAngle > 165) {
      feedback = { type: 'good', text: 'יישור מעולה! המשך כך!' };
    }
    // Hip sag
    if (hip.y > shoulder.y + 0.05 && ankle && hip.y > ankle.y + 0.02) {
      feedback = { type: 'warning', text: 'הרם את הירכיים! אל תיתן להן לשקוע' };
    }
  }

  return {
    ...prevState, feedback, moving, headDown: false,
    isActive: isInPosition,
    firstRepStarted: isInPosition || prevState.firstRepStarted,
    lastRepTime: isInPosition ? Date.now() : prevState.lastRepTime,
    posture: isInPosition ? 'sideplank' : 'unknown',
    _prevLandmarks: landmarks
  };
}

// --- Band Pull Apart: wrist X spread ---
export function analyzeBandPullApart(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];

  if (!lWrist || !rWrist || lWrist.visibility < 0.3 || rWrist.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  const wristSpread = Math.abs(lWrist.x - rWrist.x);
  const shoulderWidth = lShoulder && rShoulder ? Math.abs(lShoulder.x - rShoulder.x) : 0.15;
  const spreadRatio = wristSpread / shoulderWidth;

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'together';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartSpread = prevState._phaseStartSpread ?? spreadRatio;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartSpread = phaseStartSpread;

  if (phase === 'together' && spreadRatio > 2.0) {
    newPhase = 'apart';
    newFirstRep = true;
    newPhaseStartSpread = spreadRatio;
    feedback = { type: 'info', text: 'מתיחה טובה!' };
  } else if (phase === 'apart' && spreadRatio < 1.2) {
    const delta = Math.abs(spreadRatio - phaseStartSpread);
    if (delta >= 0.5) { // minimum spread change of 0.5x shoulder width
      newPhase = 'together';
      newReps = reps + 1;
      lastRepTime = Date.now();
      newPhaseStartSpread = spreadRatio;
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }
  }

  // Form: elbows bending too much
  if (newFirstRep && lElbow?.visibility > 0.3 && lShoulder && lWrist) {
    const elbAngle = angle(lShoulder, lElbow, lWrist);
    if (elbAngle < 140) {
      feedback = { type: 'warning', text: 'שמור על הזרועות ישרות! אל תכופף את המרפקים' };
    }
  }

  // Form: shoulder shrug
  if (newFirstRep && lShoulder?.visibility > 0.3) {
    const shoulderShrug = (prevState._prevShoulderY || lShoulder.y) - lShoulder.y;
    if (shoulderShrug > 0.02) {
      feedback = { type: 'warning', text: 'הורד את הכתפיים! אל תרים אותן' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartSpread: newPhaseStartSpread, _prevShoulderY: lShoulder?.y, _prevLandmarks: landmarks
  };
}

// --- Push-ups: elbow angle + shoulder/wrist Y ---
export function analyzePushUps(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP];

  // Use whichever side is more visible
  let shoulder, elbow, wrist;
  if ((lElbow?.visibility || 0) >= (rElbow?.visibility || 0)) {
    shoulder = lShoulder; elbow = lElbow; wrist = lWrist;
  } else {
    shoulder = rShoulder; elbow = rElbow; wrist = rWrist;
  }

  if (!shoulder || !elbow || !wrist || elbow.visibility < 0.3) {
    return { ...prevState, feedback: null, moving, headDown: false, posture: 'unknown', _prevLandmarks: landmarks };
  }

  const rawElbowAngle = angle(shoulder, elbow, wrist);
  const elbowAngle = smoothAngle(rawElbowAngle, prevState, '_smoothElbow');
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? elbowAngle;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;

  // === ADAPTIVE THRESHOLDS ===
  // Use calibration data when available (handles kids/small ROM),
  // otherwise fall back to generous defaults
  const cal = prevState._calibration;
  const calElbow = cal?.leftElbow || cal?.rightElbow;
  // Calibrated thresholds: DOWN when angle drops 20% below max, UP when 90% back to max
  // Defaults: DOWN < 120° (was 100° — too strict for kids), UP > 155° (was 160°)
  const downThreshold = calElbow?.range > 15
    ? calElbow.max - calElbow.range * 0.2
    : 120;
  const upThreshold = calElbow?.range > 15
    ? calElbow.max - calElbow.range * 0.1
    : 155;

  // Velocity-based direction change detection (supplement to angle thresholds)
  const prevAngle = prevState._smoothElbow ?? elbowAngle;
  const angleDelta = elbowAngle - prevAngle; // negative = bending, positive = extending
  const velocityDown = angleDelta < -1.5; // bending fast
  const velocityUp = angleDelta > 1.5;    // extending fast

  if (phase === 'up' && (elbowAngle < downThreshold || (velocityDown && elbowAngle < downThreshold + 15))) {
    newPhase = 'down';
    newFirstRep = true;
    newPhaseStartAngle = elbowAngle;
    newRepCounted = false;
    feedback = { type: 'info', text: 'ירידה טובה!' };
  } else if (phase === 'down') {
    // Early count at 75% of return phase (was 80% — more sensitive for kids)
    const earlyThreshold = phaseStartAngle + (upThreshold - phaseStartAngle) * 0.75;
    // Reduced MIN_ROM for calibrated users: 40% of range instead of 50% (meetsMinROM still applies)
    if (!repCounted && (elbowAngle > earlyThreshold || (velocityUp && elbowAngle > phaseStartAngle + 15)) && meetsMinROM(prevState, 'elbow', elbowAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      const romDelta = Math.abs(elbowAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 80) {
        coaching = { he: 'טכניקה מושלמת! ירידה מלאה עם גוף ישר כמו קרש', en: 'Perfect technique! Full depth with a plank-straight body' };
      } else if (romDelta > 50) {
        coaching = { he: 'טוב! נסה לרדת עוד קצת - החזה כמעט נוגע ברצפה', en: 'Good! Try going lower - chest almost touching the floor' };
      } else if (romDelta > 20) {
        coaching = { he: 'יפה! כל חזרה חשובה! נסה לרדת עוד קצת בפעם הבאה', en: 'Nice! Every rep counts! Try going a bit lower next time' };
      } else {
        coaching = { he: 'רד יותר! המרפקים צריכים להתכופף יותר', en: 'Go lower! Your elbows need more bend' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset at extension (adaptive)
    if (elbowAngle > upThreshold) {
      newPhase = 'up';
      newRepCounted = false;
      newPhaseStartAngle = elbowAngle;
    }
  }

  // Form check: hips sagging (hip much lower than shoulder line) — must move together
  if (newFirstRep && lHip?.visibility > 0.3 && shoulder?.visibility > 0.3) {
    const hipDrop = lHip.y - shoulder.y;
    if (hipDrop > 0.15) {
      feedback = { type: 'warning', text: 'שמור על גב ישר ובטן אסופה! האגן צונח',
                   coaching: { he: 'הירכיים שוקעות - חזק את הליבה! תחשוב על קו ישר מראש לעקב. כווץ את הבטן', en: 'Hips sagging - engage your core! Think straight line from head to heels. Tighten abs' } };
    } else if (hipDrop < -0.05) {
      feedback = { type: 'warning', text: 'הישבן למעלה מדי! שמור על קו ישר מכתפיים לקרסול',
                   coaching: { he: 'הישבן למעלה מדי - הורד את הירכיים. דמיין שמישהו שם ספר על הגב שלך - הוא לא צריך ליפול', en: 'Butt too high - lower your hips. Imagine a book on your back - it should not fall' } };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture: 'plank', _phaseStartAngle: newPhaseStartAngle, _smoothElbow: elbowAngle, _repCounted: newRepCounted, _prevLandmarks: landmarks
  };
}

// --- Lunges: front knee angle, auto-detect forward leg ---
export function analyzeLunges(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];

  if (!lHip || !lKnee || !lAnkle || !rHip || !rKnee || !rAnkle) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  // Auto-detect forward leg: the one with knee further forward (lower Y = higher on screen, but for lunges, the forward knee bends more)
  const leftKneeAngle = angle(lHip, lKnee, lAnkle);
  const rightKneeAngle = angle(rHip, rKnee, rAnkle);
  const rawKneeAngle = Math.min(leftKneeAngle, rightKneeAngle); // use the more bent knee
  const kneeAngle = smoothAngle(rawKneeAngle, prevState, '_smoothKnee');

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? kneeAngle;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;

  if (phase === 'up' && kneeAngle < 110) {
    newPhase = 'down';
    newFirstRep = true;
    newPhaseStartAngle = kneeAngle;
    newRepCounted = false;
    feedback = { type: 'info', text: 'ירידה יפה!' };
  } else if (phase === 'down') {
    // Early count at 80% of return phase
    const earlyThreshold = phaseStartAngle + (160 - phaseStartAngle) * 0.8;
    if (!repCounted && kneeAngle > earlyThreshold && meetsMinROM(prevState, 'knee', kneeAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      const romDelta = Math.abs(kneeAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 70) {
        coaching = { he: 'מכרעת מצוינת! ברך אחורית כמעט נוגעת ברצפה', en: 'Excellent lunge! Back knee almost touching floor' };
      } else if (romDelta > 45) {
        coaching = { he: 'טוב! נסה לרדת עוד - ברך אחורית קרובה לרצפה', en: 'Good! Try going lower - back knee close to floor' };
      } else {
        coaching = { he: 'רד יותר עמוק! הברך האחורית צריכה לגעת כמעט ברצפה', en: 'Go deeper! Back knee should almost touch the floor' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset at full extension
    if (kneeAngle > 160) {
      newPhase = 'up';
      newRepCounted = false;
      newPhaseStartAngle = kneeAngle;
    }
  }

  // Knee over ankle warning
  if (newFirstRep && kneeAngle < 70) {
    feedback = { type: 'warning', text: 'אל תרד יותר מדי! שמור על הברך מעל הקרסול',
                 coaching: { he: 'הברך עוברת את הקרסול - צעד רחב יותר קדימה, הברך הקדמית ב-90 מעלות', en: 'Knee past ankle - take a wider step forward, front knee at 90 degrees' } };
  }

  return {
    reps: newReps, phase: newPhase, feedback, kneeAngle: Math.round(kneeAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartAngle: newPhaseStartAngle, _smoothKnee: kneeAngle, _repCounted: newRepCounted, _prevLandmarks: landmarks
  };
}

// --- Shoulder Press: wrist above shoulder + elbow extension ---
export function analyzeShoulderPress(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  // Use whichever side is more visible
  let shoulder, elbow, wrist;
  if ((lElbow?.visibility || 0) >= (rElbow?.visibility || 0)) {
    shoulder = lShoulder; elbow = lElbow; wrist = lWrist;
  } else {
    shoulder = rShoulder; elbow = rElbow; wrist = rWrist;
  }

  if (!shoulder || !elbow || !wrist || elbow.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  const rawElbowAngle = angle(shoulder, elbow, wrist);
  const elbowAngle = smoothAngle(rawElbowAngle, prevState, '_smoothElbow');
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down'; // start at bottom
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? elbowAngle;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;

  // Up phase: wrist above shoulder (Y decreases upward) and elbow extended
  const wristAboveShoulder = wrist.y < shoulder.y;

  if (phase === 'down' && elbowAngle < 100) {
    newFirstRep = true;
    newPhaseStartAngle = elbowAngle;
    newRepCounted = false;
    // Ready position confirmed
  }

  if (phase === 'down') {
    // Early count at 80% of press phase
    const earlyThreshold = phaseStartAngle + (160 - phaseStartAngle) * 0.8;
    if (!repCounted && wristAboveShoulder && elbowAngle > earlyThreshold && meetsMinROM(prevState, 'shoulder', elbowAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newFirstRep = true;
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      const romDelta = Math.abs(elbowAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 80) {
        coaching = { he: 'לחיצה מושלמת! טווח תנועה מלא מהכתפיים עד למעלה', en: 'Perfect press! Full range from shoulders to overhead' };
      } else if (romDelta > 50) {
        coaching = { he: 'טוב! הורד את המשקולות עד לגובה האוזניים לטווח מלא', en: 'Good! Lower weights to ear level for full range' };
      } else {
        coaching = { he: 'הורד יותר! המשקולות צריכות לרדת לגובה הכתפיים', en: 'Lower more! Weights should come down to shoulder level' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset at full extension
    if (wristAboveShoulder && elbowAngle > 160) {
      newPhase = 'up';
      newRepCounted = false;
      newPhaseStartAngle = elbowAngle;
    }
  } else if (phase === 'up' && elbowAngle < 100) {
    newPhase = 'down';
    newPhaseStartAngle = elbowAngle;
    newRepCounted = false;
    feedback = { type: 'info', text: 'ירידה טובה!' };
  }

  // Back arch warning
  if (newFirstRep && !wristAboveShoulder && elbowAngle > 140 && moving) {
    feedback = { type: 'warning', text: 'דחוף את המשקולות למעלה! אל תקמר את הגב',
                 coaching: { he: 'הגב מתקמר - כווץ את הבטן ודחוף ישר למעלה. גב קמור מעמיס על עמוד השדרה', en: 'Back arching - tighten abs and press straight up. Arched back loads the spine' } };
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _phaseStartAngle: newPhaseStartAngle, _smoothElbow: elbowAngle, _repCounted: newRepCounted, _prevLandmarks: landmarks
  };
}

// --- Goblet Squat: reuses squat logic + wrist near chest check ---
export function analyzeGobletSquat(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  // Run base squat analysis
  const squatResult = analyzeSquat(landmarks, prevState);

  // Additional check: wrists should be near chest (holding weight)
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];

  if (squatResult.firstRepStarted && lWrist?.visibility > 0.3 && lShoulder?.visibility > 0.3) {
    const shoulderMidY = ((lShoulder?.y || 0) + (rShoulder?.y || 0)) / 2;
    const wristMidY = ((lWrist?.y || 0) + (rWrist?.visibility > 0.3 ? rWrist.y : lWrist.y)) / 2;
    const wristNearChest = Math.abs(wristMidY - shoulderMidY) < 0.15;

    if (!wristNearChest && squatResult.moving) {
      return { ...squatResult, feedback: { type: 'warning', text: 'החזק את המשקולת קרוב לחזה!' } };
    }
  }

  return squatResult;
}

// --- Jumping Exercise: jumping jacks, burpees ---
export function analyzeJumpingExercise(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lm = (idx) => landmarks[idx];
  const v = (idx) => lm(idx) && lm(idx).visibility > 0.3;

  if (!v(LM.LEFT_SHOULDER) || !v(LM.RIGHT_SHOULDER) || !v(LM.LEFT_HIP) || !v(LM.RIGHT_HIP)) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  // Track wrist height relative to shoulder — jumping jacks: hands go above shoulders
  const shoulderY = (lm(LM.LEFT_SHOULDER).y + lm(LM.RIGHT_SHOULDER).y) / 2;
  let wristAbove = false;
  if (v(LM.LEFT_WRIST) && v(LM.RIGHT_WRIST)) {
    const avgWristY = (lm(LM.LEFT_WRIST).y + lm(LM.RIGHT_WRIST).y) / 2;
    wristAbove = avgWristY < shoulderY - 0.05; // wrists above shoulders (Y is inverted)
  } else if (v(LM.LEFT_WRIST)) {
    wristAbove = lm(LM.LEFT_WRIST).y < shoulderY - 0.05;
  } else if (v(LM.RIGHT_WRIST)) {
    wristAbove = lm(LM.RIGHT_WRIST).y < shoulderY - 0.05;
  }

  // Also track hip Y for body going up/down (burpees)
  const hipY = (lm(LM.LEFT_HIP).y + lm(LM.RIGHT_HIP).y) / 2;
  const sHipY = smoothY(hipY, prevState, '_jumpHipY');

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down'; // start expecting arms down
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let firstRepStarted = prevState.firstRepStarted || false;

  if (phase === 'down' && wristAbove) {
    newPhase = 'up';
    firstRepStarted = true;
  } else if (phase === 'up' && !wristAbove && canCountRep(lastRepTime)) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture, _prevLandmarks: landmarks,
    _smooth_jumpHipY: sHipY,
  };
}

// --- Running Form: tracks knee lift alternation ---
export function analyzeRunningForm(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['legs', 'hips']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  const lm = (idx) => landmarks[idx];
  const v = (idx) => lm(idx) && lm(idx).visibility > 0.3;

  if (!v(LM.LEFT_HIP) || !v(LM.RIGHT_HIP)) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  // Track knee height — good running form has high knee lifts
  let kneeForm = 'neutral';
  const hipY = (lm(LM.LEFT_HIP).y + lm(LM.RIGHT_HIP).y) / 2;

  if (v(LM.LEFT_KNEE) && v(LM.RIGHT_KNEE)) {
    const lKneeY = lm(LM.LEFT_KNEE).y;
    const rKneeY = lm(LM.RIGHT_KNEE).y;
    const higherKnee = Math.min(lKneeY, rKneeY);
    // Good knee lift: knee reaches at least hip level
    if (higherKnee < hipY + 0.02) {
      kneeForm = 'good';
    } else {
      kneeForm = 'low';
    }
  }

  // Count strides via alternating knee lifts
  const reps = prevState.reps || 0;
  let lastRepTime = prevState.lastRepTime || null;
  let newReps = reps;
  let feedback = null;

  if (moving && kneeForm === 'good' && canCountRep(lastRepTime)) {
    newReps = reps + 1;
    lastRepTime = Date.now();
    if (newReps % 10 === 0) {
      feedback = { type: 'count', text: `${newReps} צעדים!`, count: newReps };
    }
  }

  if (kneeForm === 'low' && moving) {
    feedback = { type: 'warning', text: 'הרם ברכיים גבוה יותר!',
                 coaching: { he: 'הרם ברכיים גבוה יותר - ברכיים לגובה המותניים', en: 'Lift knees higher - knee to hip level' } };
  }

  return {
    reps: newReps, feedback, moving, headDown, posture, lastRepTime,
    firstRepStarted: newReps > 0, _prevLandmarks: landmarks,
  };
}

// --- Pull-ups: elbow angle tracking (hanging → chin-over-bar → hanging) ---
export function analyzePullUps(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const vis = validateLandmarks(landmarks, ['arms', 'shoulders']);
  if (!vis.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: vis.missingParts, direction: vis.direction }, posture: prevState.posture || 'unknown', _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks, prevState);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  // Use most visible side
  let shoulder, elbow, wrist;
  if ((lElbow?.visibility || 0) >= (rElbow?.visibility || 0)) {
    shoulder = lShoulder; elbow = lElbow; wrist = lWrist;
  } else {
    shoulder = rShoulder; elbow = rElbow; wrist = rWrist;
  }

  if (!shoulder || !elbow || !wrist || elbow.visibility < 0.3) {
    return { ...prevState, feedback: null, moving, headDown: false, posture: 'unknown', _prevLandmarks: landmarks };
  }

  const rawElbowAngle = angle(shoulder, elbow, wrist);
  const elbowAngle = smoothAngle(rawElbowAngle, prevState, '_smoothElbow');
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down'; // Start hanging (arms extended = 'down')
  const firstRepStarted = prevState.firstRepStarted || false;
  const phaseStartAngle = prevState._phaseStartAngle ?? elbowAngle;
  const repCounted = prevState._repCounted || false;
  let newRepCounted = repCounted;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;
  let newPhaseStartAngle = phaseStartAngle;

  // Pull-up phases: down = hanging (elbow > 140°), up = chin over bar (elbow < 90°)
  const downThreshold = 140;
  const upThreshold = 90;

  if (phase === 'down' && elbowAngle < upThreshold) {
    // Pulled up — arms flexed
    newPhase = 'up';
    newFirstRep = true;
    newPhaseStartAngle = elbowAngle;
    newRepCounted = false;
    feedback = { type: 'info', text: 'למעלה!' };
  } else if (phase === 'up') {
    // Count when returning to hang (75% back to extension)
    const earlyThreshold = phaseStartAngle + (downThreshold - phaseStartAngle) * 0.75;
    if (!repCounted && elbowAngle > earlyThreshold && meetsMinROM(prevState, 'elbow', elbowAngle, phaseStartAngle) && canCountRep(lastRepTime)) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      newRepCounted = true;
      const romDelta = Math.abs(elbowAngle - phaseStartAngle);
      let coaching = null;
      if (romDelta > 80) {
        coaching = { he: 'טווח תנועה מלא! סנטר מעל המוט, מעולה', en: 'Full ROM! Chin over bar, excellent' };
      } else if (romDelta > 50) {
        coaching = { he: 'טוב! נסה למשוך גבוה יותר, סנטר מעל המוט', en: 'Good! Try pulling higher, chin over bar' };
      } else {
        coaching = { he: 'משוך גבוה יותר! הסנטר צריך לעבור את המוט', en: 'Pull higher! Chin needs to clear the bar' };
      }
      feedback = { type: 'count', text: `${newReps}!`, count: newReps, coaching };
    }
    // Phase reset at full hang
    if (elbowAngle > downThreshold) {
      newPhase = 'down';
      newRepCounted = false;
      newPhaseStartAngle = elbowAngle;
    }
  }

  // Form check: body swinging (shoulder X drift between frames)
  if (newFirstRep && prevState._prevLandmarks) {
    const prevShoulder = prevState._prevLandmarks[LM.LEFT_SHOULDER];
    if (prevShoulder?.visibility > 0.3 && shoulder?.visibility > 0.3) {
      const xDrift = Math.abs(shoulder.x - prevShoulder.x);
      if (xDrift > 0.04) {
        feedback = { type: 'warning', text: 'הגוף מתנדנד! שמור על גוף ישר',
                     coaching: { he: 'הגוף מתנדנד - כווץ את הבטן ושמור על גוף ישר כמו קרש', en: 'Body swinging - engage core and keep body straight like a plank' } };
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture: 'standing', _phaseStartAngle: newPhaseStartAngle, _smoothElbow: elbowAngle, _repCounted: newRepCounted, _prevLandmarks: landmarks
  };
}

// Table-based analyzer mapping with keyword matching + required orientation
const O = ORIENTATION; // shorthand
const ANALYZER_MAP = [
  // === PULL-UPS (must be before push-ups so 'pull' doesn't match 'push') ===
  { keywords: ['pull', 'pullup', 'chin', 'מתח', 'מתחים', 'סנטר'], analyze: analyzePullUps, type: 'reps', cueKey: 'pull', orientation: O.STANDING },
  // === STANDING fitness exercises ===
  { keywords: ['ביספ', 'כפיפות מרפק', 'bicep curl', 'כפיפות ידיים'], analyze: analyzeBicepCurl, type: 'reps', cueKey: 'bicep', orientation: O.STANDING },
  { keywords: ['טריצפס', 'הרחבת מרפק', 'tricep extension', 'tricep'], analyze: analyzeTricepExtension, type: 'reps', cueKey: 'tricep', orientation: O.STANDING },
  { keywords: ['משיכת משקולת', 'משיכה', 'bent over row', 'row'], analyze: analyzeBentOverRow, type: 'reps', cueKey: 'row', orientation: O.STANDING },
  { keywords: ['הרמה צידית', 'lateral raise', 'הרמות צידיות'], analyze: analyzeLateralRaise, type: 'reps', cueKey: 'lateral', orientation: O.STANDING },
  { keywords: ['ישיבה על הקיר', 'wall sit', 'ישיבת קיר'], analyze: analyzeWallSit, type: 'hold', cueKey: 'wallsit', orientation: O.STANDING },
  { keywords: ['מתיחת גומייה', 'band pull apart', 'גומייה'], analyze: analyzeBandPullApart, type: 'reps', cueKey: 'pullApart', orientation: O.STANDING },
  { keywords: ['גובלט', 'goblet'], analyze: analyzeGobletSquat, type: 'reps', cueKey: 'squat', orientation: O.STANDING },
  { keywords: ['סקוואט', 'squat', 'כריעה', 'כריעות'], analyze: analyzeSquat, type: 'reps', cueKey: 'squat', orientation: O.STANDING },
  { keywords: ['דיפ', 'dip', 'שקיעות', 'שקיעה'], analyze: analyzeDips, type: 'reps', cueKey: 'dip', orientation: O.STANDING },
  { keywords: ['lunge', 'לאנג', 'מכרע', 'מכרעות'], analyze: analyzeLunges, type: 'reps', cueKey: 'lunge', orientation: O.STANDING },
  { keywords: ['shoulder press', 'כתפיים', 'לחיצת כתפ', 'לחיצות כתפ'], analyze: analyzeShoulderPress, type: 'reps', cueKey: 'shoulder', orientation: O.STANDING },
  // === STANDING dynamic exercises ===
  { keywords: ['jumping jack', "ג'אמפינג", 'בורפי', 'burpee', 'קפיצות פיצוח', 'קפיצות'], analyze: analyzeJumpingExercise, type: 'reps', cueKey: 'jump', orientation: O.STANDING },
  { keywords: ['ריצה', 'ספרינט', 'sprint', 'running', 'אינטרוולים', 'ריצת'], analyze: analyzeRunningForm, type: 'form', cueKey: 'running', orientation: O.STANDING },
  // === LYING fitness exercises ===
  { keywords: ['גשר ישבן', 'glute bridge', 'גשר'], analyze: analyzeGluteBridge, type: 'reps', cueKey: 'bridge', orientation: O.LYING },
  { keywords: ['מטפס הרים', 'mountain climber', 'מטפסי הרים'], analyze: analyzeMountainClimbers, type: 'reps', cueKey: 'mountain', orientation: O.LYING },
  { keywords: ['כפיפות בטן', 'crunch', 'בטן'], analyze: analyzeCrunches, type: 'reps', cueKey: 'crunch', orientation: O.LYING },
  { keywords: ['פלאנק צידי', 'side plank'], analyze: analyzeSidePlank, type: 'hold', cueKey: 'sideplank', orientation: O.LYING },
  { keywords: ['push', 'שכיבות סמיכה', 'שכיבות שמיכה', 'פוש', 'שכיבות'], analyze: analyzePushUps, type: 'reps', cueKey: 'push', orientation: O.LYING },
  { keywords: ['פלאנק', 'plank'], analyze: analyzePlank, type: 'hold', cueKey: 'plank', orientation: O.LYING },
  // === STANDING sport drills ===
  { keywords: ['דריבל', 'dribbl', 'שליטה', 'כדור'], analyze: analyzeDribbling, type: 'form', cueKey: 'dribbling', orientation: O.STANDING },
  { keywords: ['זריקה', 'קליעה', 'shooting', 'free throw', 'זריקות חופשיות'], analyze: analyzeShootingForm, type: 'form', cueKey: 'shooting', orientation: O.STANDING },
  { keywords: ['כדרור ביד', 'hand dribbl', 'כדרור כדורסל'], analyze: analyzeHandDribbling, type: 'form', cueKey: 'handDribble', orientation: O.STANDING },
  { keywords: ['פורהנד', 'בקהנד', 'מכות', 'forehand', 'backhand', 'מכות לקיר', 'wall hit'], analyze: analyzeStroke, type: 'form', cueKey: 'stroke', orientation: O.STANDING },
  { keywords: ['הגשה', 'serve', 'סרב'], analyze: analyzeServe, type: 'form', cueKey: 'serve', orientation: O.STANDING },
  { keywords: ['עבודת רגליים', 'footwork', 'תנועת מגרש', 'רגליים מהירות'], analyze: analyzeFootwork, type: 'form', cueKey: 'footwork', orientation: O.STANDING },
  { keywords: ['בעיטה', 'kick', 'בעיטות', 'shooting drill'], analyze: analyzeKickTechnique, type: 'form', cueKey: 'kick', orientation: O.STANDING },
  // === STANDING Paralympic — Amputee Football ===
  { keywords: ['בעיטה בקביים', 'בעיטת קביים', 'amputee kick', 'crutch kick'], analyze: analyzeAmputeeCrutchKick, type: 'form', cueKey: 'amputeeKick', orientation: O.STANDING },
  { keywords: ['ריצה בקביים', 'ספרינט קביים', 'crutch sprint', 'amputee sprint'], analyze: analyzeAmputeeCrutchSprint, type: 'form', cueKey: 'amputeeSprint', orientation: O.STANDING },
  // === SITTING Paralympic — Wheelchair Basketball ===
  { keywords: ['זריקה כיסא גלגלים', 'קליעה כיסא', 'wheelchair shooting', 'wheelchair basketball shoot'], analyze: analyzeWheelchairBasketballShooting, type: 'form', cueKey: 'wheelchairShooting', orientation: O.SITTING },
  { keywords: ['כדרור כיסא גלגלים', 'כדרור כיסא', 'wheelchair dribble'], analyze: analyzeWheelchairBasketballDribbling, type: 'form', cueKey: 'wheelchairDribble', orientation: O.SITTING },
  { keywords: ['מסירה כיסא גלגלים', 'מסירת חזה כיסא', 'wheelchair pass', 'chest pass wheelchair'], analyze: analyzeWheelchairBasketballChestPass, type: 'form', cueKey: 'wheelchairPass', orientation: O.SITTING },
  // === SITTING Paralympic — Wheelchair Tennis ===
  { keywords: ['מכות כיסא גלגלים', 'פורהנד כיסא', 'wheelchair stroke', 'wheelchair forehand'], analyze: analyzeWheelchairTennisStroke, type: 'form', cueKey: 'wheelchairStroke', orientation: O.SITTING },
  { keywords: ['הגשה כיסא גלגלים', 'סרב כיסא', 'wheelchair serve'], analyze: analyzeWheelchairTennisServe, type: 'form', cueKey: 'wheelchairServe', orientation: O.SITTING },
];

// Get the right analyzer based on exercise type
export function getAnalyzer(exerciseName) {
  const name = (exerciseName || '').toLowerCase();
  for (const entry of ANALYZER_MAP) {
    if (entry.keywords.some(kw => name.includes(kw))) {
      const ballAware = entry.type === 'form'; // sport drills can use ball data
      return { analyze: entry.analyze, type: entry.type, cueKey: entry.cueKey, ballAware, orientation: entry.orientation || O.ANY };
    }
  }
  return { analyze: analyzeGenericReps, type: 'reps', cueKey: 'default', ballAware: false, orientation: O.STANDING };
}

// Calibration: measure key joint angles for a given exercise type
// Called every frame during the 5-second calibration phase to track ROM
export function getCalibrationAngles(landmarks, cueKey) {
  const angles = {};
  const lm = (idx) => landmarks[idx];
  const v = (idx) => lm(idx) && lm(idx).visibility > 0.3;

  // Elbow angles (most exercises)
  if (v(LM.LEFT_SHOULDER) && v(LM.LEFT_ELBOW) && v(LM.LEFT_WRIST)) {
    angles.leftElbow = angle(lm(LM.LEFT_SHOULDER), lm(LM.LEFT_ELBOW), lm(LM.LEFT_WRIST));
  }
  if (v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_ELBOW) && v(LM.RIGHT_WRIST)) {
    angles.rightElbow = angle(lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_ELBOW), lm(LM.RIGHT_WRIST));
  }

  // Knee angles (squats, lunges, kicks)
  if (['squat', 'lunge', 'amputeeKick', 'kick'].includes(cueKey)) {
    if (v(LM.LEFT_HIP) && v(LM.LEFT_KNEE) && v(LM.LEFT_ANKLE))
      angles.leftKnee = angle(lm(LM.LEFT_HIP), lm(LM.LEFT_KNEE), lm(LM.LEFT_ANKLE));
    if (v(LM.RIGHT_HIP) && v(LM.RIGHT_KNEE) && v(LM.RIGHT_ANKLE))
      angles.rightKnee = angle(lm(LM.RIGHT_HIP), lm(LM.RIGHT_KNEE), lm(LM.RIGHT_ANKLE));
  }

  // Shoulder angles (overhead press, shooting, serves)
  if (['shoulder', 'wheelchairShooting', 'wheelchairServe', 'wheelchairStroke', 'shooting', 'serve'].includes(cueKey)) {
    if (v(LM.LEFT_ELBOW) && v(LM.LEFT_SHOULDER) && v(LM.LEFT_HIP))
      angles.leftShoulder = angle(lm(LM.LEFT_ELBOW), lm(LM.LEFT_SHOULDER), lm(LM.LEFT_HIP));
    if (v(LM.RIGHT_ELBOW) && v(LM.RIGHT_SHOULDER) && v(LM.RIGHT_HIP))
      angles.rightShoulder = angle(lm(LM.RIGHT_ELBOW), lm(LM.RIGHT_SHOULDER), lm(LM.RIGHT_HIP));
  }

  // Trunk rotation (wheelchair sports, passes, strokes, kicks)
  if (['wheelchairStroke', 'wheelchairServe', 'wheelchairPass', 'amputeeKick', 'stroke', 'kick'].includes(cueKey)) {
    if (v(LM.LEFT_SHOULDER) && v(LM.RIGHT_SHOULDER) && v(LM.LEFT_HIP) && v(LM.RIGHT_HIP)) {
      const shoulderMidX = (lm(LM.LEFT_SHOULDER).x + lm(LM.RIGHT_SHOULDER).x) / 2;
      const hipMidX = (lm(LM.LEFT_HIP).x + lm(LM.RIGHT_HIP).x) / 2;
      angles.trunkRotation = Math.abs(shoulderMidX - hipMidX) * 360;
    }
  }

  // Always capture shoulder + head Y for orientation verification
  if (v(LM.LEFT_SHOULDER)) {
    const sY = (lm(LM.LEFT_SHOULDER).y + (v(LM.RIGHT_SHOULDER) ? lm(LM.RIGHT_SHOULDER).y : lm(LM.LEFT_SHOULDER).y)) / 2;
    angles._shoulderY = sY;
  }
  if (v(LM.NOSE)) {
    angles._headY = lm(LM.NOSE).y;
  }

  return angles;
}
