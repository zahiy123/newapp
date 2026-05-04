import { angleCosine } from './motionEngine';

const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32
};

function angle(a, b, c) { return angleCosine(a, b, c); }
function vis(lm) { return lm && lm.visibility > 0.3; }

// Movement detection helper
function detectMovement(landmarks, prevLandmarks) {
  if (!prevLandmarks) return false;
  const trackPoints = [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
  let totalDelta = 0, counted = 0;
  for (const idx of trackPoints) {
    const curr = landmarks[idx], prev = prevLandmarks[idx];
    if (curr && prev && curr.visibility > 0.3 && prev.visibility > 0.3) {
      totalDelta += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
      counted++;
    }
  }
  if (counted === 0) return false;
  return (totalDelta / counted) > 0.005;
}

// Physio-Eye Compensation Detection Helpers
function detectTrunkLean(landmarks) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  if (!vis(lShoulder) || !vis(rShoulder)) return null;

  const shoulderTilt = Math.abs(lShoulder.y - rShoulder.y);
  if (shoulderTilt > 0.04) {
    return {
      type: 'compensation',
      text: 'אל תטה לצד! מרכז את המשקל',
      coaching: { he: 'אל תטה לצד! מרכז את המשקל', en: 'Don\'t lean to the side! Center your weight' }
    };
  }
  return null;
}

function detectShoulderHike(landmarks) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lEar = landmarks[LM.LEFT_EAR];
  const rEar = landmarks[LM.RIGHT_EAR];

  if (vis(lShoulder) && vis(lEar)) {
    const lDist = Math.abs(lShoulder.y - lEar.y);
    if (lDist < 0.03) {
      return {
        type: 'compensation',
        text: 'הורד את הכתף! אל תרים לאוזן',
        coaching: { he: 'הורד את הכתף! אל תרים לאוזן', en: 'Lower your shoulder! Don\'t hike it up' }
      };
    }
  }

  if (vis(rShoulder) && vis(rEar)) {
    const rDist = Math.abs(rShoulder.y - rEar.y);
    if (rDist < 0.03) {
      return {
        type: 'compensation',
        text: 'הורד את הכתף! אל תרים לאוזן',
        coaching: { he: 'הורד את הכתף! אל תרים לאוזן', en: 'Lower your shoulder! Don\'t hike it up' }
      };
    }
  }

  return null;
}

function detectPelvicTilt(landmarks) {
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  if (!vis(lHip) || !vis(rHip)) return null;

  const hipTilt = Math.abs(lHip.y - rHip.y);
  if (hipTilt > 0.03) {
    return {
      type: 'compensation',
      text: 'שמור על אגן ישר! יישר את האגן',
      coaching: { he: 'שמור על אגן ישר! יישר את האגן', en: 'Keep pelvis level! Straighten your pelvis' }
    };
  }
  return null;
}

function detectBackArch(landmarks) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  if (!vis(lShoulder) || !vis(rShoulder) || !vis(lHip) || !vis(rHip)) return null;

  const shoulderX = (lShoulder.x + rShoulder.x) / 2;
  const hipX = (lHip.x + rHip.x) / 2;

  const forwardArch = Math.abs(hipX - shoulderX);
  if (forwardArch > 0.08) {
    return {
      type: 'compensation',
      text: 'אל תקמר את הגב! שמור על גב ישר',
      coaching: { he: 'אל תקמר את הגב! שמור על גב ישר', en: 'Don\'t arch your back! Keep spine neutral' }
    };
  }
  return null;
}

// Check all compensations and return first detected
function checkCompensations(landmarks) {
  return detectTrunkLean(landmarks) ||
         detectShoulderHike(landmarks) ||
         detectPelvicTilt(landmarks) ||
         detectBackArch(landmarks);
}

// ============================================================================
// SHOULDERS (3)
// ============================================================================

export function analyzeRehabPendulum(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;
  const swingPeak = prevState.swingPeak || null;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Track wrist oscillation relative to shoulder
  let wristY = null;
  let shoulderY = null;

  if (vis(lWrist) && vis(lShoulder)) {
    wristY = lWrist.y;
    shoulderY = lShoulder.y;
  } else if (vis(rWrist) && vis(rShoulder)) {
    wristY = rWrist.y;
    shoulderY = rShoulder.y;
  }

  if (wristY === null || shoulderY === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const wristDrop = wristY - shoulderY;
  const now = Date.now();

  // Detect swing cycle: wrist goes down (positive wristDrop peak) then up
  if (phase === 'ready' || phase === 'swing_up') {
    if (wristDrop > 0.15) { // Wrist below shoulder
      return {
        ...prevState,
        phase: 'swing_down',
        swingPeak: wristDrop,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'swing_down') {
    if (wristDrop < 0.05) { // Wrist returns near shoulder level
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'swing_up',
        feedback: {
          type: 'success',
          text: `נדנדה ${newReps}`,
          coaching: { he: `יפה! נדנדה ${newReps}`, en: `Good! Swing ${newReps}` }
        },
        lastRepTime: now,
        firstRepStarted: true,
        swingPeak: null,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabFrontRaise(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Calculate shoulder flexion angle (elbow-shoulder-hip)
  const lFlexion = vis(lElbow) && vis(lShoulder) && vis(lHip) ? angle(lElbow, lShoulder, lHip) : null;
  const rFlexion = vis(rElbow) && vis(rShoulder) && vis(rHip) ? angle(rElbow, rShoulder, rHip) : null;

  if (lFlexion === null && rFlexion === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const flexion = lFlexion !== null ? lFlexion : rFlexion;
  const now = Date.now();

  // Phase detection: arm down (~170°) -> up (~90°)
  if (phase === 'ready' || phase === 'down') {
    if (flexion < 120) { // Arm lifting (smaller angle = more flexion)
      return {
        ...prevState,
        phase: 'up',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'up') {
    if (flexion > 150) { // Arm returned down
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'down',
        feedback: {
          type: 'success',
          text: `הרמה ${newReps}`,
          coaching: { he: `מעולה! הרמה ${newReps}`, en: `Excellent! Raise ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabExternalRotation(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Track wrist X position relative to elbow X (external rotation moves wrist outward)
  let wristX = null;
  let elbowX = null;
  let shoulderX = null;

  if (vis(lWrist) && vis(lElbow) && vis(lShoulder)) {
    wristX = lWrist.x;
    elbowX = lElbow.x;
    shoulderX = lShoulder.x;
  } else if (vis(rWrist) && vis(rElbow) && vis(rShoulder)) {
    wristX = rWrist.x;
    elbowX = rElbow.x;
    shoulderX = rShoulder.x;
  }

  if (wristX === null || elbowX === null || shoulderX === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  // Check if elbow drifts too far from body
  const elbowDrift = Math.abs(elbowX - shoulderX);
  if (elbowDrift > 0.15) {
    return {
      ...prevState,
      feedback: {
        type: 'warning',
        text: 'הצמד את המרפק לגוף!',
        coaching: { he: 'הצמד את המרפק לגוף!', en: 'Keep elbow pinned to your side!' }
      },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const wristOffset = Math.abs(wristX - elbowX);
  const now = Date.now();

  // Phase: internal rotation (wrist near elbow) -> external rotation (wrist away from elbow)
  if (phase === 'ready' || phase === 'external') {
    if (wristOffset < 0.08) { // Wrist close to elbow (internal rotation)
      return {
        ...prevState,
        phase: 'internal',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'internal') {
    if (wristOffset > 0.15) { // Wrist rotated outward
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'external',
        feedback: {
          type: 'success',
          text: `סיבוב ${newReps}`,
          coaching: { he: `כל הכבוד! סיבוב ${newReps}`, en: `Well done! Rotation ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

// ============================================================================
// ARMS (3)
// ============================================================================

export function analyzeRehabElbowFlexion(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Calculate elbow angle
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;

  if (lElbowAngle === null && rElbowAngle === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const elbowAngle = lElbowAngle !== null ? lElbowAngle : rElbowAngle;
  const now = Date.now();

  // Phase: straight (~170°) -> bent (~50°)
  if (phase === 'ready' || phase === 'bent') {
    if (elbowAngle > 160) { // Elbow straight
      return {
        ...prevState,
        phase: 'straight',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'straight') {
    if (elbowAngle < 70) { // Elbow fully bent
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'bent',
        feedback: {
          type: 'success',
          text: `כיפוף ${newReps}`,
          coaching: { he: `יפה מאוד! כיפוף ${newReps}`, en: `Very good! Flexion ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabElbowExtension(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Calculate elbow angle
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;

  if (lElbowAngle === null && rElbowAngle === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const elbowAngle = lElbowAngle !== null ? lElbowAngle : rElbowAngle;
  const now = Date.now();

  // Phase: bent (~60°) -> straight (~170°)
  if (phase === 'ready' || phase === 'straight') {
    if (elbowAngle < 80) { // Elbow bent
      return {
        ...prevState,
        phase: 'bent',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'bent') {
    if (elbowAngle > 165) { // Elbow fully extended
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'straight',
        feedback: {
          type: 'success',
          text: `יישור ${newReps}`,
          coaching: { he: `מצוין! יישור ${newReps}`, en: `Excellent! Extension ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabPronSup(landmarks, prevState = {}) {
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;
  const oscillationCount = prevState.oscillationCount || 0;

  // Check compensations first (elbow drift)
  if (vis(lElbow) && vis(rElbow)) {
    const elbowDrift = Math.abs(lElbow.x - rElbow.x);
    if (elbowDrift > 0.2) {
      return {
        ...prevState,
        feedback: {
          type: 'warning',
          text: 'שמור על מרפקים יציבים!',
          coaching: { he: 'שמור על מרפקים יציבים!', en: 'Keep elbows stable!' }
        },
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  // Track wrist stability (should stay in roughly same position during rotation)
  let wristY = null;
  let wristX = null;

  if (vis(lWrist)) {
    wristY = lWrist.y;
    wristX = lWrist.x;
  } else if (vis(rWrist)) {
    wristY = rWrist.y;
    wristX = rWrist.x;
  }

  if (wristY === null || wristX === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  // Detect gentle oscillation as proxy for rotation
  const prevWristY = prevState.wristY || wristY;
  const deltaY = Math.abs(wristY - prevWristY);

  const now = Date.now();

  if (deltaY > 0.01 && deltaY < 0.05) { // Small movement detected
    const newOscillationCount = oscillationCount + 1;

    if (newOscillationCount >= 4) { // 4 oscillations = 1 complete rotation cycle
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        oscillationCount: 0,
        feedback: {
          type: 'success',
          text: `סיבוב ${newReps}`,
          coaching: { he: `כל הכבוד! סיבוב ${newReps}`, en: `Good job! Rotation ${newReps}` }
        },
        lastRepTime: now,
        firstRepStarted: true,
        wristY,
        moving,
        _prevLandmarks: landmarks
      };
    }

    return {
      ...prevState,
      oscillationCount: newOscillationCount,
      wristY,
      moving,
      _prevLandmarks: landmarks
    };
  }

  return {
    ...prevState,
    wristY,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

// ============================================================================
// BACK (3)
// ============================================================================

export function analyzeRehabCatCow(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Calculate spine curvature via shoulder-hip-knee angle
  const lSpine = vis(lShoulder) && vis(lHip) && vis(lKnee) ? angle(lShoulder, lHip, lKnee) : null;
  const rSpine = vis(rShoulder) && vis(rHip) && vis(rKnee) ? angle(rShoulder, rHip, rKnee) : null;

  if (lSpine === null && rSpine === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הגוף בשדה הראייה (על ארבע)' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const spineAngle = lSpine !== null ? lSpine : rSpine;
  const now = Date.now();

  // Cat: spine arched (smaller angle ~150°), Cow: spine extended (larger angle ~180°)
  if (phase === 'ready' || phase === 'cow') {
    if (spineAngle < 160) { // Cat position (arched back)
      return {
        ...prevState,
        phase: 'cat',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'cat') {
    if (spineAngle > 175) { // Cow position (extended back)
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'cow',
        feedback: {
          type: 'success',
          text: `חתול-פרה ${newReps}`,
          coaching: { he: `מעולה! חתול-פרה ${newReps}`, en: `Excellent! Cat-cow ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabPelvicTilt(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check if legs are bending (compensation)
  const lKneeAngle = vis(lHip) && vis(lKnee) && landmarks[LM.LEFT_ANKLE] && vis(landmarks[LM.LEFT_ANKLE])
    ? angle(lHip, lKnee, landmarks[LM.LEFT_ANKLE]) : null;
  const rKneeAngle = vis(rHip) && vis(rKnee) && landmarks[LM.RIGHT_ANKLE] && vis(landmarks[LM.RIGHT_ANKLE])
    ? angle(rHip, rKnee, landmarks[LM.RIGHT_ANKLE]) : null;

  if ((lKneeAngle !== null && lKneeAngle < 160) || (rKneeAngle !== null && rKneeAngle < 160)) {
    return {
      ...prevState,
      feedback: {
        type: 'warning',
        text: 'אל תרים רגליים! הטה רק את האגן',
        coaching: { he: 'אל תרים רגליים! הטה רק את האגן', en: 'Don\'t lift legs! Tilt pelvis only' }
      },
      moving,
      _prevLandmarks: landmarks
    };
  }

  // Track hip Y relative to shoulder Y (very small movement)
  if (!vis(lShoulder) || !vis(rShoulder) || !vis(lHip) || !vis(rHip)) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'שכב על הגב, הצב את הגוף בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const hipY = (lHip.y + rHip.y) / 2;
  const hipDelta = hipY - shoulderY;

  const now = Date.now();

  // Phase: neutral (hip delta baseline) -> tilted (hip rises slightly)
  if (phase === 'ready' || phase === 'tilted') {
    if (hipDelta < -0.02) { // Pelvis tilted up (hip Y closer to shoulder Y)
      return {
        ...prevState,
        phase: 'neutral',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'neutral') {
    if (hipDelta > 0.02) { // Pelvis returned to neutral or tilted down
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'tilted',
        feedback: {
          type: 'success',
          text: `הטיית אגן ${newReps}`,
          coaching: { he: `יפה מאוד! הטיית אגן ${newReps}`, en: `Very good! Pelvic tilt ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabWallAngel(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Track wrist Y relative to shoulder Y
  if (!vis(lShoulder) || !vis(rShoulder) || !vis(lWrist) || !vis(rWrist)) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרועות בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const wristY = (lWrist.y + rWrist.y) / 2;
  const wristRise = shoulderY - wristY; // Positive when wrists above shoulders

  const now = Date.now();

  // Phase: arms down (wrists near or below shoulders) -> arms up (wrists above shoulders)
  if (phase === 'ready' || phase === 'up') {
    if (wristRise < 0.05) { // Wrists near shoulder level
      return {
        ...prevState,
        phase: 'down',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'down') {
    if (wristRise > 0.15) { // Wrists raised significantly above shoulders
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'up',
        feedback: {
          type: 'success',
          text: `מלאך ${newReps}`,
          coaching: { he: `מצוין! מלאך ${newReps}`, en: `Excellent! Angel ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

// ============================================================================
// LEGS (3)
// ============================================================================

export function analyzeRehabSLR(landmarks, prevState = {}) {
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations: opposite leg bending, back arch
  const lKneeAngle = vis(lHip) && vis(lKnee) && vis(lAnkle) ? angle(lHip, lKnee, lAnkle) : null;
  const rKneeAngle = vis(rHip) && vis(rKnee) && vis(rAnkle) ? angle(rHip, rKnee, rAnkle) : null;

  // Both legs should stay relatively straight
  if ((lKneeAngle !== null && lKneeAngle < 160) && (rKneeAngle !== null && rKneeAngle < 160)) {
    return {
      ...prevState,
      feedback: {
        type: 'warning',
        text: 'שמור על רגליים ישרות!',
        coaching: { he: 'שמור על רגליים ישרות!', en: 'Keep legs straight!' }
      },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Track which leg is lifting by comparing ankle Y positions
  if (!vis(lAnkle) || !vis(rAnkle) || !vis(lHip) || !vis(rHip)) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'שכב על הגב, הצב את הרגליים בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const hipY = (lHip.y + rHip.y) / 2;
  const lAnkleLift = hipY - lAnkle.y; // Positive when left ankle rises
  const rAnkleLift = hipY - rAnkle.y; // Positive when right ankle rises

  const maxLift = Math.max(lAnkleLift, rAnkleLift);
  const now = Date.now();

  // Phase: leg down (ankle near hip level) -> leg up (ankle raised)
  if (phase === 'ready' || phase === 'up') {
    if (maxLift < 0.1) { // Leg down
      return {
        ...prevState,
        phase: 'down',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'down') {
    if (maxLift > 0.25) { // Leg raised
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'up',
        feedback: {
          type: 'success',
          text: `הרמת רגל ${newReps}`,
          coaching: { he: `כל הכבוד! הרמת רגל ${newReps}`, en: `Well done! Leg raise ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabSeatedKneeFlex(landmarks, prevState = {}) {
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check trunk lean compensation
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];

  if (vis(lShoulder) && vis(rShoulder) && vis(lHip) && vis(rHip)) {
    const shoulderX = (lShoulder.x + rShoulder.x) / 2;
    const hipX = (lHip.x + rHip.x) / 2;
    const trunkLean = Math.abs(shoulderX - hipX);

    if (trunkLean > 0.1) {
      return {
        ...prevState,
        feedback: {
          type: 'warning',
          text: 'אל תתכופף קדימה! שב זקוף',
          coaching: { he: 'אל תתכופף קדימה! שב זקוף', en: 'Don\'t lean forward! Sit upright' }
        },
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  // Calculate knee angle
  const lKneeAngle = vis(lHip) && vis(lKnee) && vis(lAnkle) ? angle(lHip, lKnee, lAnkle) : null;
  const rKneeAngle = vis(rHip) && vis(rKnee) && vis(rAnkle) ? angle(rHip, rKnee, rAnkle) : null;

  if (lKneeAngle === null && rKneeAngle === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הרגליים בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const kneeAngle = lKneeAngle !== null ? lKneeAngle : rKneeAngle;
  const now = Date.now();

  // Phase: extended (~170°) -> flexed (~90°)
  if (phase === 'ready' || phase === 'flexed') {
    if (kneeAngle > 160) { // Knee extended
      return {
        ...prevState,
        phase: 'extended',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'extended') {
    if (kneeAngle < 100) { // Knee flexed
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'flexed',
        feedback: {
          type: 'success',
          text: `כיפוף ברך ${newReps}`,
          coaching: { he: `מעולה! כיפוף ברך ${newReps}`, en: `Excellent! Knee flexion ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabMiniSquat(landmarks, prevState = {}) {
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check knee valgus (knees collapsing inward)
  if (vis(lKnee) && vis(rKnee)) {
    const kneeDist = Math.abs(lKnee.x - rKnee.x);
    if (kneeDist < 0.05) {
      return {
        ...prevState,
        feedback: {
          type: 'warning',
          text: 'אל תכופף את הברכיים פנימה!',
          coaching: { he: 'אל תכופף את הברכיים פנימה!', en: 'Don\'t let knees collapse inward!' }
        },
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  // Check trunk lean compensation
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Calculate knee angle (mini squat: 160° -> 140°)
  const lKneeAngle = vis(lHip) && vis(lKnee) && vis(lAnkle) ? angle(lHip, lKnee, lAnkle) : null;
  const rKneeAngle = vis(rHip) && vis(rKnee) && vis(rAnkle) ? angle(rHip, rKnee, rAnkle) : null;

  if (lKneeAngle === null && rKneeAngle === null) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הגוף בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const kneeAngle = Math.min(lKneeAngle !== null ? lKneeAngle : 180, rKneeAngle !== null ? rKneeAngle : 180);
  const now = Date.now();

  // Phase: standing (>165°) -> mini squat (140-160°)
  if (phase === 'ready' || phase === 'squat') {
    if (kneeAngle > 165) { // Standing
      return {
        ...prevState,
        phase: 'stand',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'stand') {
    if (kneeAngle < 155) { // Mini squat (shallow)
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'squat',
        feedback: {
          type: 'success',
          text: `מיני סקוואט ${newReps}`,
          coaching: { he: `יפה מאוד! מיני סקוואט ${newReps}`, en: `Very good! Mini squat ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

// ============================================================================
// FUNCTIONAL (3)
// ============================================================================

export function analyzeRehabReach(landmarks, prevState = {}) {
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rWrist = landmarks[LM.RIGHT_WRIST];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check compensations first
  const compensation = checkCompensations(landmarks);
  if (compensation) {
    return { ...prevState, feedback: compensation, moving, _prevLandmarks: landmarks };
  }

  // Calculate wrist distance from hip (normalized)
  if (!vis(lHip) || !vis(rHip)) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הגוף בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const hipX = (lHip.x + rHip.x) / 2;
  const hipY = (lHip.y + rHip.y) / 2;

  let reachDist = 0;
  if (vis(lWrist)) {
    const dx = lWrist.x - hipX;
    const dy = lWrist.y - hipY;
    reachDist = Math.sqrt(dx * dx + dy * dy);
  } else if (vis(rWrist)) {
    const dx = rWrist.x - hipX;
    const dy = rWrist.y - hipY;
    reachDist = Math.sqrt(dx * dx + dy * dy);
  } else {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הזרוע בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const now = Date.now();

  // Phase: arm close to body (low reach) -> arm extended (high reach)
  if (phase === 'ready' || phase === 'extended') {
    if (reachDist < 0.2) { // Arm close to body
      return {
        ...prevState,
        phase: 'retracted',
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'retracted') {
    if (reachDist > 0.4) { // Arm extended to reach
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'extended',
        feedback: {
          type: 'success',
          text: `הושטה ${newReps}`,
          coaching: { he: `כל הכבוד! הושטה ${newReps}`, en: `Well done! Reach ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabWeightShift(landmarks, prevState = {}) {
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;
  const shiftDirection = prevState.shiftDirection || null;

  // Check trunk lean compensation (upper body should not lean)
  if (vis(lShoulder) && vis(rShoulder) && vis(lHip) && vis(rHip)) {
    const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
    const hipMidX = (lHip.x + rHip.x) / 2;
    const trunkLean = Math.abs(shoulderMidX - hipMidX);

    if (trunkLean > 0.08) {
      return {
        ...prevState,
        feedback: {
          type: 'warning',
          text: 'אל תטה את הגוף! הזז את האגן',
          coaching: { he: 'אל תטה את הגוף! הזז את האגן', en: 'Don\'t lean! Shift your hips' }
        },
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  // Track hip midpoint X oscillation
  if (!vis(lHip) || !vis(rHip)) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הגוף בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const hipMidX = (lHip.x + rHip.x) / 2;
  const centerX = prevState.centerX || hipMidX;
  const offset = hipMidX - centerX;

  const now = Date.now();

  // Detect shift left or right from center
  if (phase === 'ready' || phase === 'center') {
    if (Math.abs(offset) > 0.05) {
      const direction = offset > 0 ? 'right' : 'left';
      return {
        ...prevState,
        phase: 'shifted',
        shiftDirection: direction,
        firstRepStarted: true,
        centerX,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'shifted') {
    if (Math.abs(offset) < 0.02) { // Returned to center
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'center',
        feedback: {
          type: 'success',
          text: `העברת משקל ${newReps}`,
          coaching: { he: `מצוין! העברת משקל ${newReps}`, en: `Excellent! Weight shift ${newReps}` }
        },
        lastRepTime: now,
        shiftDirection: null,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    centerX,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}

export function analyzeRehabSitToStand(landmarks, prevState = {}) {
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'ready';
  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const lastRepTime = prevState.lastRepTime || 0;
  const firstRepStarted = prevState.firstRepStarted || false;

  // Check excessive forward trunk lean
  if (vis(lShoulder) && vis(rShoulder) && vis(lHip) && vis(rHip)) {
    const shoulderY = (lShoulder.y + rShoulder.y) / 2;
    const hipY = (lHip.y + rHip.y) / 2;
    const shoulderX = (lShoulder.x + rShoulder.x) / 2;
    const hipX = (lHip.x + rHip.x) / 2;

    const forwardLean = Math.abs(shoulderX - hipX);
    if (forwardLean > 0.15) {
      return {
        ...prevState,
        feedback: {
          type: 'warning',
          text: 'אל תתכופף יותר מדי קדימה!',
          coaching: { he: 'אל תתכופף יותר מדי קדימה!', en: 'Don\'t lean too far forward!' }
        },
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  // Check asymmetric push-off (pelvic tilt)
  const pelvicCompensation = detectPelvicTilt(landmarks);
  if (pelvicCompensation) {
    return { ...prevState, feedback: pelvicCompensation, moving, _prevLandmarks: landmarks };
  }

  // Track shoulder Y position (large delta = transition)
  if (!vis(lShoulder) || !vis(rShoulder)) {
    return {
      ...prevState,
      feedback: { type: 'info', text: 'הצב את הגוף בשדה הראייה' },
      moving,
      _prevLandmarks: landmarks
    };
  }

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const baselineY = prevState.baselineY || shoulderY;
  const deltaY = baselineY - shoulderY; // Positive when standing up (shoulder rises)

  const now = Date.now();

  // Phase: sitting (baseline) -> standing (shoulder rises significantly)
  if (phase === 'ready' || phase === 'standing') {
    if (Math.abs(deltaY) < 0.05) { // At baseline (sitting)
      return {
        ...prevState,
        phase: 'sitting',
        baselineY: shoulderY,
        firstRepStarted: true,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  if (phase === 'sitting') {
    if (deltaY > 0.15) { // Standing up (shoulder moved up significantly)
      const newReps = reps + 1;
      return {
        ...prevState,
        reps: newReps,
        phase: 'standing',
        feedback: {
          type: 'success',
          text: `קימה מישיבה ${newReps}`,
          coaching: { he: `כל הכבוד! קימה מישיבה ${newReps}`, en: `Well done! Sit-to-stand ${newReps}` }
        },
        lastRepTime: now,
        moving,
        _prevLandmarks: landmarks
      };
    }
  }

  return {
    ...prevState,
    baselineY,
    moving,
    feedback: null,
    _prevLandmarks: landmarks
  };
}
