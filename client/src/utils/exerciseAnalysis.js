import {
  analyzeShootingForm, analyzeHandDribbling, analyzeStroke,
  analyzeServe, analyzeFootwork, analyzeKickTechnique
} from './sportAnalyzers';

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

function angle(a, b, c) {
  const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs(rad * 180 / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

function getStandingLeg(landmarks) {
  const leftAnkle = landmarks[LM.LEFT_ANKLE];
  const rightAnkle = landmarks[LM.RIGHT_ANKLE];
  if (!leftAnkle || leftAnkle.visibility < 0.3) return 'right';
  if (!rightAnkle || rightAnkle.visibility < 0.3) return 'left';
  return leftAnkle.y > rightAnkle.y ? 'left' : 'right';
}

function detectMovement(landmarks, prevLandmarks) {
  if (!prevLandmarks) return false;
  const trackPoints = [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
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
  if (counted === 0) return false;
  return (totalDelta / counted) > 0.005;
}

// Detect posture: 'sitting', 'standing', or 'unknown'
// Uses 3 factors with 2-of-3 voting for sitting detection:
// 1. Hip-knee vertical distance (small = sitting)
// 2. Hip-knee-ankle angle (70°-110° = sitting)
// 3. Torso ratio: nose-to-hip vs shoulder-to-hip (compressed = sitting)
export function detectPosture(landmarks) {
  if (!landmarks) return 'unknown';

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
  if (sittingVotes >= 2) return 'sitting';
  if (standingVotes >= 2) return 'standing';

  // Fallback: if hip is clearly above knee, probably standing
  if (hipKneeVertDist > 0.12) return 'standing';

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

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const kneeAngle = angle(hip, knee, ankle);
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'up' && kneeAngle < 120) {
    newPhase = 'down';
    newFirstRep = true;
    feedback = { type: 'info', text: 'יפה! ירידה...' };
  } else if (phase === 'down' && kneeAngle > 160) {
    newPhase = 'up';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  // Only give technique warnings AFTER first rep has started
  if (newFirstRep && newPhase === 'down' && kneeAngle < 70) {
    feedback = { type: 'warning', text: 'אל תרד יותר מדי! שמור על הברך מעל הקרסול' };
  }

  return { reps: newReps, phase: newPhase, feedback, kneeAngle: Math.round(kneeAngle), moving, headDown: newFirstRep ? headDown : false, lastRepTime, firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks };
}

// --- Rep counting for crutch dips ---
export function analyzeDips(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'up' && shoulderY - prevY > threshold) {
    newPhase = 'down';
    newFirstRep = true;
  } else if (phase === 'down' && prevY - shoulderY > threshold) {
    newPhase = 'up';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  return { reps: newReps, phase: newPhase, feedback, prevShoulderY: shoulderY, moving, headDown: newFirstRep ? headDown : false, lastRepTime, firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks };
}

// --- Plank hold analysis ---
export function analyzePlank(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const shoulder = landmarks[LM.LEFT_SHOULDER];
  const hip = landmarks[LM.LEFT_HIP];
  const ankle = landmarks[LM.LEFT_ANKLE];

  if (!shoulder || !hip || !ankle) return { ...prevState, feedback: null, posture: 'unknown', _prevLandmarks: landmarks };

  const bodyAngle = angle(shoulder, hip, ankle);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  // Plank position: body is horizontal
  const isInPlankPosition = hip.y > shoulder.y * 0.8 && bodyAngle < 200;
  let feedback = null;
  let posture = isInPlankPosition ? 'plank' : detectPosture(landmarks);

  // Only give feedback when actually in plank position
  if (isInPlankPosition) {
    if (bodyAngle > 170) {
      feedback = { type: 'good', text: 'מעולה! גב ישר, המשך כך!' };
    } else if (bodyAngle < 150) {
      feedback = { type: 'warning', text: 'הרם את הירכיים! שמור על גב ישר' };
    } else if (bodyAngle > 185) {
      feedback = { type: 'warning', text: 'הורד את הירכיים קצת, אל תקמר את הגב' };
    }
  }
  // No feedback when sitting or standing for plank

  return { ...prevState, feedback, bodyAngle: Math.round(bodyAngle), moving, headDown: false, isActive: isInPlankPosition, firstRepStarted: isInPlankPosition || prevState.firstRepStarted, lastRepTime: isInPlankPosition ? Date.now() : prevState.lastRepTime, posture, _prevLandmarks: landmarks };
}

// --- Dribbling / center of gravity analysis ---
export function analyzeDribbling(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  if (!lShoulder || !lWrist) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  // Track wrist Y min/max over recent frames for amplitude detection
  const history = prevState._wristHistory || [];
  const wristY = (lWrist.y + (rWrist?.visibility > 0.3 ? rWrist.y : lWrist.y)) / 2;
  history.push(wristY);
  if (history.length > 30) history.shift(); // ~0.5s window at 60fps

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && amplitude > 0.15) {
    feedback = { type: 'good', text: null }; // good movement, no text needed
  } else if (moving && amplitude > 0.05 && amplitude <= 0.15) {
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
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- High knees: detect knee height relative to hip ---
export function analyzeHighKnees(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  // Use whichever wrist has higher visibility (the remaining arm)
  const wrist = (lWrist?.visibility || 0) >= (rWrist?.visibility || 0) ? lWrist : rWrist;
  if (!wrist || wrist.visibility < 0.3) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  const history = prevState._wristHistory || [];
  history.push(wrist.y);
  if (history.length > 30) history.shift();

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && amplitude > 0.15) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.05 && amplitude <= 0.15) {
    feedback = { type: 'warning', text: 'singleArmSmall' };
  } else if (!moving && history.length > 20) {
    feedback = { type: 'warning', text: 'notMoving' };
  }

  return {
    ...prevState, feedback, posture, moving,
    _wristHistory: history,
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Arm punches: upper-body replacement for high knees ---
export function analyzeArmPunches(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const posture = detectPosture(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, _prevLandmarks: landmarks };
  }

  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  if (!lWrist) return { ...prevState, feedback: null, posture, moving, _prevLandmarks: landmarks };

  // Track wrist X-axis oscillation (forward/back punching amplitude)
  const history = prevState._wristXHistory || [];
  const wristX = (lWrist.x + (rWrist?.visibility > 0.3 ? rWrist.x : lWrist.x)) / 2;
  history.push(wristX);
  if (history.length > 30) history.shift();

  let feedback = null;
  const amplitude = history.length > 10
    ? Math.max(...history) - Math.min(...history)
    : 0;

  if (moving && amplitude > 0.12) {
    feedback = { type: 'good', text: null };
  } else if (moving && amplitude > 0.04 && amplitude <= 0.12) {
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
    lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    _prevLandmarks: landmarks
  };
}

// --- Core twists: shoulder-safe replacement for arm circles ---
export function analyzeCoreTwists(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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
  name: { he: 'הרמת ברך עם קביים', en: 'Single Leg High Knee (Crutch Support)' },
  description: { he: 'היישען על הקביים והרם את הברך לכיוון החזה', en: 'Lean on your crutches and bring your knee to your chest' },
  duration: 45, analyze: analyzeSingleLegHighKnee,
};

const WARM_UP_FORWARD_KICKS = {
  id: 'forward_kicks_crutches',
  name: { he: 'בעיטות קדימה עם קביים', en: 'Forward Kicks with Crutches' },
  description: { he: 'היישען על הקביים ובעט קדימה ברגל', en: 'Lean on crutches and kick forward with your leg' },
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

// --- Generic rep counter: tracks shoulder-center Y oscillation for any up/down exercise ---
export function analyzeGenericReps(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  if (posture === 'sitting' || posture === 'unknown') {
    return { ...prevState, feedback: null, posture, moving: false, headDown: false, firstRepStarted: false, _prevLandmarks: landmarks };
  }

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  if (!lShoulder || !rShoulder || lShoulder.visibility < 0.3) {
    return { ...prevState, feedback: null, posture, moving, headDown, _prevLandmarks: landmarks };
  }

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const history = prevState._yHistory || [];
  history.push(shoulderY);
  if (history.length > 60) history.shift();

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  // Peak detection: need at least 15 frames
  if (history.length >= 15) {
    const recent = history.slice(-15);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const amplitude = max - min;
    const current = recent[recent.length - 1];

    if (amplitude > 0.03) {
      newFirstRep = true;
      if (phase === 'up' && current > min + amplitude * 0.7) {
        newPhase = 'down';
      } else if (phase === 'down' && current < min + amplitude * 0.3) {
        newPhase = 'up';
        newReps = reps + 1;
        lastRepTime = Date.now();
        feedback = { type: 'count', text: `${newReps}!`, count: newReps };
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: newFirstRep ? headDown : false,
    lastRepTime, firstRepStarted: newFirstRep, posture, _yHistory: history, _prevLandmarks: landmarks
  };
}

// --- Bicep Curl: elbow angle tracking ---
export function analyzeBicepCurl(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const elbowAngle = angle(shoulder, elbow, wrist);
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'down' && elbowAngle < 50) {
    newPhase = 'up';
    newFirstRep = true;
    feedback = { type: 'info', text: 'כיווץ מעולה! החזק רגע למעלה' };
  } else if (phase === 'up' && elbowAngle > 150) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  // Good form: elbow stays tight AND no shrug → positive feedback
  let formGood = true;

  // Form: elbow drifting from torso
  if (newFirstRep && hip && elbow.visibility > 0.3) {
    const elbowDrift = Math.abs(elbow.x - hip.x);
    if (elbowDrift > 0.12) {
      feedback = { type: 'warning', text: 'שמור את המרפקים צמודים לגוף! אל תיתן להם לזוז' };
      formGood = false;
    }
  }

  // Form: shoulder shrug
  if (newFirstRep && shoulder && elbowAngle < 60) {
    const shoulderShrug = (prevState._prevShoulderY || shoulder.y) - shoulder.y;
    if (shoulderShrug > 0.02) {
      feedback = { type: 'warning', text: 'אל תרים את הכתפיים! רק המרפקים זזים, הכתפיים נשארות למטה' };
      formGood = false;
    }
  }

  // Form: not going full range
  if (newFirstRep && newPhase === 'up' && elbowAngle > 80 && elbowAngle < 120) {
    feedback = { type: 'warning', text: 'כווץ עד הסוף! הביא את היד לכתף' };
    formGood = false;
  }

  // Good form positive reinforcement (every 3 reps)
  if (formGood && newReps > 0 && newReps % 3 === 0 && newPhase === 'down' && feedback?.type === 'count') {
    feedback = { type: 'good', text: 'טכניקה מושלמת! מרפקים צמודים, כל הכבוד!' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _prevShoulderY: shoulder.y, _prevLandmarks: landmarks
  };
}

// --- Bent Over Row: torso angle + wrist Y relative to hip ---
export function analyzeBentOverRow(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'down' && wristToHipY > 0.05) {
    newPhase = 'up';
    newFirstRep = true;
    feedback = { type: 'info', text: 'משיכה טובה! כווץ את הגב' };
  } else if (phase === 'up' && wristToHipY < -0.02) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
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
    firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks
  };
}

// --- Lateral Raise: wrist Y relative to shoulder ---
export function analyzeLateralRaise(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'down' && wristRelShoulder > -0.02) {
    newPhase = 'up';
    newFirstRep = true;
    feedback = { type: 'info', text: 'הרמה יפה!' };
  } else if (phase === 'up' && wristRelShoulder < -0.10) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
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
    firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks
  };
}

// --- Glute Bridge: hip Y position rise/fall ---
export function analyzeGluteBridge(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

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

  if (phase === 'down' && hipRise > 0.04) {
    newPhase = 'up';
    newFirstRep = true;
    feedback = { type: 'info', text: 'הרמה יפה!' };
  } else if (phase === 'up' && hipRise < 0.01) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
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
    posture: 'floor', _baselineHipY: newBaseline, _prevLandmarks: landmarks
  };
}

// --- Tricep Extension: arms overhead, elbow angle ---
export function analyzeTricepExtension(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const elbowAngle = angle(shoulder, elbow, wrist);
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'down' && elbowAngle < 90) {
    newPhase = 'up';
    newFirstRep = true;
    feedback = { type: 'info', text: 'ירידה טובה!' };
  } else if (phase === 'up' && elbowAngle > 150) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  // Form: elbows flaring out
  let tricepFormGood = true;
  if (newFirstRep && shoulder && elbow) {
    const elbowSpread = Math.abs(elbow.x - shoulder.x);
    if (elbowSpread > 0.10) {
      feedback = { type: 'warning', text: 'שמור את המרפקים קרובים לראש! אל תיתן להם להתפשט' };
      tricepFormGood = false;
    }
  }

  // Form: not extending fully
  if (newFirstRep && newPhase === 'up' && elbowAngle > 120 && elbowAngle < 145) {
    feedback = { type: 'warning', text: 'יישר את הזרועות עד הסוף! טווח תנועה מלא' };
    tricepFormGood = false;
  }

  // Good form every 3 reps
  if (tricepFormGood && newReps > 0 && newReps % 3 === 0 && feedback?.type === 'count') {
    feedback = { type: 'good', text: 'מרפקים צמודים, תנועה מלאה! מעולה!' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks
  };
}

// --- Wall Sit: hold-type, hip-knee ~90°, upright torso ---
export function analyzeWallSit(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

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

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

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

  if (isPlankLike) {
    if (phase === 'back' && kneeY < hip.y - 0.03) {
      newPhase = 'forward';
      newFirstRep = true;
    } else if (phase === 'forward' && kneeY > hip.y - 0.01) {
      newPhase = 'back';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
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
    posture: isPlankLike ? 'plank' : 'unknown', _prevKneeY: kneeY, _prevLandmarks: landmarks
  };
}

// --- Crunches: shoulder Y rise from flat ---
export function analyzeCrunches(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

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

  if (phase === 'down' && rise > 0.03) {
    newPhase = 'up';
    newFirstRep = true;
    feedback = { type: 'info', text: 'כיווץ!' };
  } else if (phase === 'up' && rise < 0.01) {
    newPhase = 'down';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  // Form: insufficient lift
  if (newFirstRep && newPhase === 'up' && rise < 0.02 && rise > 0.005) {
    feedback = { type: 'warning', text: 'הרם את הכתפיים יותר! כווץ את הבטן' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: false, lastRepTime, firstRepStarted: newFirstRep,
    posture: 'floor', _baselineY: newBaseline, _prevLandmarks: landmarks
  };
}

// --- Side Plank: hold-type, side orientation + alignment ---
export function analyzeSidePlank(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

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

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'together' && spreadRatio > 2.0) {
    newPhase = 'apart';
    newFirstRep = true;
    feedback = { type: 'info', text: 'מתיחה טובה!' };
  } else if (phase === 'apart' && spreadRatio < 1.2) {
    newPhase = 'together';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
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
    firstRepStarted: newFirstRep, posture, _prevShoulderY: lShoulder?.y, _prevLandmarks: landmarks
  };
}

// --- Push-ups: elbow angle + shoulder/wrist Y ---
export function analyzePushUps(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const elbowAngle = angle(shoulder, elbow, wrist);
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'up' && elbowAngle < 100) {
    newPhase = 'down';
    newFirstRep = true;
    feedback = { type: 'info', text: 'ירידה טובה!' };
  } else if (phase === 'down' && elbowAngle > 160) {
    newPhase = 'up';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  // Form check: hips sagging (hip much lower than shoulder line)
  if (newFirstRep && lHip?.visibility > 0.3 && shoulder?.visibility > 0.3) {
    const hipDrop = lHip.y - shoulder.y;
    if (hipDrop > 0.15) {
      feedback = { type: 'warning', text: 'הרם את הירכיים! שמור על גב ישר' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture: 'plank', _prevLandmarks: landmarks
  };
}

// --- Lunges: front knee angle, auto-detect forward leg ---
export function analyzeLunges(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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
  const kneeAngle = Math.min(leftKneeAngle, rightKneeAngle); // use the more bent knee

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'up';
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  if (phase === 'up' && kneeAngle < 110) {
    newPhase = 'down';
    newFirstRep = true;
    feedback = { type: 'info', text: 'ירידה יפה!' };
  } else if (phase === 'down' && kneeAngle > 160) {
    newPhase = 'up';
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  }

  // Knee over ankle warning
  if (newFirstRep && kneeAngle < 70) {
    feedback = { type: 'warning', text: 'אל תרד יותר מדי! שמור על הברך מעל הקרסול' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, kneeAngle: Math.round(kneeAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks
  };
}

// --- Shoulder Press: wrist above shoulder + elbow extension ---
export function analyzeShoulderPress(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const posture = detectPosture(landmarks);
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
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

  const elbowAngle = angle(shoulder, elbow, wrist);
  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'down'; // start at bottom
  const firstRepStarted = prevState.firstRepStarted || false;

  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let newFirstRep = firstRepStarted;

  // Up phase: wrist above shoulder (Y decreases upward) and elbow extended
  const wristAboveShoulder = wrist.y < shoulder.y;

  if (phase === 'down' && elbowAngle < 100) {
    newFirstRep = true;
    // Ready position confirmed
  }

  if (phase === 'down' && wristAboveShoulder && elbowAngle > 160) {
    newPhase = 'up';
    newFirstRep = true;
    newReps = reps + 1;
    lastRepTime = Date.now();
    feedback = { type: 'count', text: `${newReps}!`, count: newReps };
  } else if (phase === 'up' && elbowAngle < 100) {
    newPhase = 'down';
    feedback = { type: 'info', text: 'ירידה טובה!' };
  }

  // Back arch warning
  if (newFirstRep && !wristAboveShoulder && elbowAngle > 140 && moving) {
    feedback = { type: 'warning', text: 'דחוף את המשקולות למעלה! אל תקמר את הגב' };
  }

  return {
    reps: newReps, phase: newPhase, feedback, elbowAngle: Math.round(elbowAngle),
    moving, headDown: newFirstRep ? headDown : false, lastRepTime,
    firstRepStarted: newFirstRep, posture, _prevLandmarks: landmarks
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

// Table-based analyzer mapping with keyword matching
const ANALYZER_MAP = [
  { keywords: ['ביספ', 'כפיפות מרפק', 'bicep curl'], analyze: analyzeBicepCurl, type: 'reps', cueKey: 'bicep' },
  { keywords: ['טריצפס', 'הרחבת מרפק', 'tricep extension'], analyze: analyzeTricepExtension, type: 'reps', cueKey: 'tricep' },
  { keywords: ['משיכת משקולת', 'משיכה', 'bent over row', 'row'], analyze: analyzeBentOverRow, type: 'reps', cueKey: 'row' },
  { keywords: ['הרמה צידית', 'lateral raise'], analyze: analyzeLateralRaise, type: 'reps', cueKey: 'lateral' },
  { keywords: ['גשר ישבן', 'glute bridge', 'גשר'], analyze: analyzeGluteBridge, type: 'reps', cueKey: 'bridge' },
  { keywords: ['ישיבה על הקיר', 'wall sit'], analyze: analyzeWallSit, type: 'hold', cueKey: 'wallsit' },
  { keywords: ['מטפס הרים', 'mountain climber'], analyze: analyzeMountainClimbers, type: 'reps', cueKey: 'mountain' },
  { keywords: ['כפיפות בטן', 'crunch'], analyze: analyzeCrunches, type: 'reps', cueKey: 'crunch' },
  { keywords: ['פלאנק צידי', 'side plank'], analyze: analyzeSidePlank, type: 'hold', cueKey: 'sideplank' },
  { keywords: ['מתיחת גומייה', 'band pull apart'], analyze: analyzeBandPullApart, type: 'reps', cueKey: 'pullApart' },
  { keywords: ['גובלט', 'goblet'], analyze: analyzeGobletSquat, type: 'reps', cueKey: 'squat' },
  { keywords: ['סקוואט', 'squat', 'כריעה'], analyze: analyzeSquat, type: 'reps', cueKey: 'squat' },
  { keywords: ['push', 'שכיבות סמיכה', 'שכיבות שמיכה', 'פוש'], analyze: analyzePushUps, type: 'reps', cueKey: 'push' },
  { keywords: ['דיפ', 'dip'], analyze: analyzeDips, type: 'reps', cueKey: 'dip' },
  { keywords: ['פלאנק', 'plank'], analyze: analyzePlank, type: 'hold', cueKey: 'plank' },
  { keywords: ['lunge', 'לאנג', 'מכרע'], analyze: analyzeLunges, type: 'reps', cueKey: 'lunge' },
  { keywords: ['shoulder press', 'כתפיים', 'לחיצת כתפ'], analyze: analyzeShoulderPress, type: 'reps', cueKey: 'shoulder' },
  { keywords: ['דריבל', 'dribbl', 'שליטה', 'כדור'], analyze: analyzeDribbling, type: 'form', cueKey: 'dribbling' },
  // Sport-specific drill analyzers (basketball, tennis, football)
  { keywords: ['זריקה', 'קליעה', 'shooting', 'free throw', 'זריקות חופשיות'], analyze: analyzeShootingForm, type: 'form', cueKey: 'shooting' },
  { keywords: ['כדרור ביד', 'hand dribbl', 'כדרור כדורסל'], analyze: analyzeHandDribbling, type: 'form', cueKey: 'handDribble' },
  { keywords: ['פורהנד', 'בקהנד', 'מכות', 'forehand', 'backhand', 'מכות לקיר', 'wall hit'], analyze: analyzeStroke, type: 'form', cueKey: 'stroke' },
  { keywords: ['הגשה', 'serve', 'סרב'], analyze: analyzeServe, type: 'form', cueKey: 'serve' },
  { keywords: ['עבודת רגליים', 'footwork', 'תנועת מגרש', 'רגליים מהירות'], analyze: analyzeFootwork, type: 'form', cueKey: 'footwork' },
  { keywords: ['בעיטה', 'kick', 'בעיטות', 'shooting drill'], analyze: analyzeKickTechnique, type: 'form', cueKey: 'kick' },
];

// Get the right analyzer based on exercise type
export function getAnalyzer(exerciseName) {
  const name = (exerciseName || '').toLowerCase();
  for (const entry of ANALYZER_MAP) {
    if (entry.keywords.some(kw => name.includes(kw))) {
      const ballAware = entry.type === 'form'; // sport drills can use ball data
      return { analyze: entry.analyze, type: entry.type, cueKey: entry.cueKey, ballAware };
    }
  }
  return { analyze: analyzeGenericReps, type: 'reps', cueKey: 'default', ballAware: false };
}
