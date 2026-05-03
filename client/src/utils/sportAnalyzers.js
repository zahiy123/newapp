// Sport-specific drill analyzers for basketball, tennis, football, and Paralympic sports
// Each analyzer follows the standard return format:
// { reps, phase, feedback: {type, text}, moving, posture, headDown, firstRepStarted, lastRepTime, formIssues }
// All accept optional ballData third param for ball-aware feedback
// Paralympic analyzers use _calibration baseline from prevState for personalized thresholds

import { angleCosine } from './motionEngine';

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

// Law of cosines angle — more stable than atan2, uses 3D distances
function angle(a, b, c) {
  return angleCosine(a, b, c);
}

// Required landmark groups for quick declaration
const LANDMARKS = {
  UPPER_BODY: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST],
  HIPS: [LM.LEFT_HIP, LM.RIGHT_HIP],
  LEGS: [LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  HEAD: [LM.NOSE],
};

// Pre-analysis visibility check — returns { valid, missingParts }
// If invalid, analyzer should return visibility feedback instead of technique feedback
function validateLandmarks(landmarks, requiredIndices, threshold = 0.5) {
  if (!landmarks) return { valid: false, missingParts: ['all'] };
  let validCount = 0;
  const missing = [];
  for (const idx of requiredIndices) {
    const lm = landmarks[idx];
    if (lm && lm.visibility >= threshold) validCount++;
    else missing.push(idx);
  }
  if (validCount / requiredIndices.length >= 0.7) return { valid: true, missingParts: [] };
  const parts = new Set();
  if (missing.some(i => [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_KNEE, LM.RIGHT_KNEE].includes(i))) parts.add('legs');
  if (missing.some(i => [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW].includes(i))) parts.add('arms');
  if (missing.some(i => [LM.LEFT_HIP, LM.RIGHT_HIP].includes(i))) parts.add('hips');
  if (parts.size === 0) parts.add('all');
  return { valid: false, missingParts: [...parts] };
}

// Helper: get calibrated threshold or fallback to default
function calThreshold(calibration, joint, pct, fallback) {
  const cal = calibration?.[joint];
  if (!cal || cal.range < 5) return fallback; // range too small = bad calibration
  return cal.min + cal.range * pct;
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

function detectHeadDown(landmarks) {
  if (!landmarks) return false;
  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  if (!nose || !lShoulder || !rShoulder) return false;
  if (nose.visibility < 0.4 || lShoulder.visibility < 0.4) return false;
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  return (shoulderMidY - nose.y) < 0.04;
}

function vis(lm) { return lm && lm.visibility > 0.3; }

// Trunk rotation helper (shoulder-hip lateral offset) — returns approximate degrees
function getTrunkRotation(landmarks) {
  const lS = landmarks[LM.LEFT_SHOULDER], rS = landmarks[LM.RIGHT_SHOULDER];
  const lH = landmarks[LM.LEFT_HIP], rH = landmarks[LM.RIGHT_HIP];
  if (!vis(lS) || !vis(rS) || !vis(lH) || !vis(rH)) return 0;
  const shoulderDiffX = rS.x - lS.x;
  const hipDiffX = rH.x - lH.x;
  return Math.abs(shoulderDiffX - hipDiffX) * 180;
}

// ============================================
// BASKETBALL: Shooting Form
// ============================================
// Tracks elbow angle (ideal 70-90°), wrist above shoulder (follow-through), knee flexion
export function analyzeShootingForm(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const rHip = landmarks[LM.RIGHT_HIP];
  const rKnee = landmarks[LM.RIGHT_KNEE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST];

  // Pick shooting arm (whichever wrist is higher = shooting hand)
  let shoulder, elbow, wrist;
  if (vis(rWrist) && vis(lWrist)) {
    if (rWrist.y < lWrist.y) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
    else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  } else if (vis(rWrist)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
  else if (vis(lWrist)) { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  else { return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks }; }

  if (!vis(shoulder) || !vis(elbow)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  const reps = prevState.reps || 0;
  const phase = prevState.phase || 'setup'; // setup → release → follow_through
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  let firstRepStarted = prevState.firstRepStarted || false;
  const formIssues = { ...(prevState.formIssues || {}) };

  const elbowAngle = angle(shoulder, elbow, wrist);
  const wristAboveShoulder = wrist.y < shoulder.y;
  const wristHighAbove = wrist.y < shoulder.y - 0.1;

  // Knee flexion
  let kneeAngle = null;
  if (vis(rHip) && vis(rKnee) && vis(rAnkle)) {
    kneeAngle = angle(rHip, rKnee, rAnkle);
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    // Phase detection
    if (phase === 'setup' && wristAboveShoulder && elbowAngle < 120) {
      newPhase = 'release';
    } else if (phase === 'release' && wristHighAbove) {
      newPhase = 'follow_through';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'follow_through' && !wristAboveShoulder) {
      newPhase = 'setup';
    }

    // Form checks (only during setup/release)
    if (newPhase === 'setup' || newPhase === 'release') {
      if (elbowAngle > 110) {
        feedback = { type: 'warning', text: 'המרפק רחוק מדי! שמור על זווית 90 מעלות' };
        formIssues.elbowTooWide = (formIssues.elbowTooWide || 0) + 1;
      } else if (elbowAngle >= 70 && elbowAngle <= 90) {
        if (!feedback) feedback = { type: 'good', text: 'זווית מרפק מצוינת!' };
      }

      if (kneeAngle !== null && kneeAngle > 170) {
        feedback = { type: 'warning', text: 'כופף ברכיים! כח מגיע מהרגליים' };
        formIssues.noKneeBend = (formIssues.noKneeBend || 0) + 1;
      }
    }

    // Follow-through check
    if (newPhase === 'follow_through') {
      if (!wristHighAbove) {
        formIssues.noFollowThrough = (formIssues.noFollowThrough || 0) + 1;
      }
    }

    // Ball-aware feedback
    if (ballData?.detected && newPhase === 'setup') {
      if (ballData.distanceEstimate > 200) {
        feedback = { type: 'info', text: 'הכדור רחוק, תקרב אותו אליך' };
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Hand Dribbling
// ============================================
// Tracks wrist Y oscillation (bouncing pattern), hand height, head position
export function analyzeHandDribbling(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lHip = landmarks[LM.LEFT_HIP];

  // Track dominant hand wrist oscillation
  const wrist = vis(rWrist) ? rWrist : (vis(lWrist) ? lWrist : null);
  const hipY = vis(rHip) && vis(lHip) ? (rHip.y + lHip.y) / 2 : null;

  if (!wrist || hipY === null) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  const wristHistory = prevState._wristHistory || [];
  wristHistory.push(wrist.y);
  if (wristHistory.length > 30) wristHistory.shift();

  let feedback = null;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'up';
  let newPhase = phase;
  let newReps = reps;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  if (moving) firstRepStarted = true;

  if (firstRepStarted && wristHistory.length >= 10) {
    const recent = wristHistory.slice(-10);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const amplitude = max - min;

    // Detect bounce reps via wrist oscillation
    if (amplitude > 0.03) {
      const current = recent[recent.length - 1];
      if (phase === 'up' && current > min + amplitude * 0.7) {
        newPhase = 'down';
      } else if (phase === 'down' && current < min + amplitude * 0.3) {
        newPhase = 'up';
        newReps = reps + 1;
        lastRepTime = Date.now();
        feedback = { type: 'count', text: `${newReps}!`, count: newReps };
      }
    }

    // Form: dribbling too high (wrist above hip)
    if (wrist.y < hipY - 0.05) {
      feedback = { type: 'warning', text: 'כדרור נמוך יותר! שמור את היד מתחת למותניים' };
      formIssues.dribblingTooHigh = (formIssues.dribblingTooHigh || 0) + 1;
    } else if (moving && amplitude > 0.03 && !feedback) {
      feedback = { type: 'good', text: 'כדרור מצוין! שמור על הקצב' };
    }

    // Head down warning
    if (headDown) {
      formIssues.headDown = (formIssues.headDown || 0) + 1;
    }
  }

  // Ball-aware: check ball height relative to hand
  if (ballData?.detected && firstRepStarted) {
    if (ballData.y < 0.3) { // ball too high in frame
      feedback = { type: 'warning', text: 'הכדור גבוה מדי! כדרר נמוך יותר' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _wristHistory: wristHistory, _prevLandmarks: landmarks
  };
}

// ============================================
// TENNIS: Stroke (Forehand/Backhand/Wall Hits)
// ============================================
// Tracks shoulder-hip rotation, wrist speed, follow-through
export function analyzeStroke(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lWrist = landmarks[LM.LEFT_WRIST];

  if (!vis(lShoulder) || !vis(rShoulder) || !vis(lHip) || !vis(rHip)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready'; // ready → backswing → strike → follow_through
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Shoulder-hip rotation: difference in X between shoulders vs hips
  const shoulderDiffX = rShoulder.x - lShoulder.x;
  const hipDiffX = rHip.x - lHip.x;
  const rotation = Math.abs(shoulderDiffX - hipDiffX);
  const rotationDeg = rotation * 180; // approximate degrees

  // Wrist speed tracking
  const wristSpeedHistory = prevState._wristSpeedHistory || [];
  const dominantWrist = vis(rWrist) ? rWrist : (vis(lWrist) ? lWrist : null);
  if (dominantWrist && prevState._prevWristPos) {
    const speed = Math.sqrt(
      Math.pow(dominantWrist.x - prevState._prevWristPos.x, 2) +
      Math.pow(dominantWrist.y - prevState._prevWristPos.y, 2)
    );
    wristSpeedHistory.push(speed);
    if (wristSpeedHistory.length > 20) wristSpeedHistory.shift();
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    const maxSpeed = wristSpeedHistory.length > 0 ? Math.max(...wristSpeedHistory) : 0;

    // Phase detection based on wrist speed + rotation
    if (phase === 'ready' && maxSpeed > 0.02) {
      newPhase = 'backswing';
    } else if (phase === 'backswing' && maxSpeed > 0.05) {
      newPhase = 'strike';
    } else if (phase === 'strike' && maxSpeed < 0.02) {
      newPhase = 'follow_through';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'follow_through' && maxSpeed < 0.01) {
      newPhase = 'ready';
    }

    // Form checks during strike
    if (moving && (newPhase === 'strike' || newPhase === 'backswing')) {
      if (rotationDeg < 20) {
        feedback = { type: 'warning', text: 'סובב את הכתפיים יותר! סיבוב גוף חשוב לכוח' };
        formIssues.insufficientRotation = (formIssues.insufficientRotation || 0) + 1;
      } else if (rotationDeg > 45) {
        if (!feedback) feedback = { type: 'good', text: 'סיבוב מעולה! כוח מהגוף!' };
      }

      if (maxSpeed < 0.03 && newPhase === 'strike') {
        formIssues.noWristSnap = (formIssues.noWristSnap || 0) + 1;
      }
    }

    // Follow-through: wrist should end high
    if (newPhase === 'follow_through' && dominantWrist) {
      const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
      if (dominantWrist.y > shoulderMidY) {
        if (!feedback) feedback = { type: 'warning', text: 'סיים את התנועה למעלה! פולו-ת\'רו גבוה' };
        formIssues.lowFollowThrough = (formIssues.lowFollowThrough || 0) + 1;
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _wristSpeedHistory: wristSpeedHistory,
    _prevWristPos: dominantWrist ? { x: dominantWrist.x, y: dominantWrist.y } : prevState._prevWristPos,
    _prevLandmarks: landmarks
  };
}

// ============================================
// TENNIS: Serve
// ============================================
// Tracks toss (wrist above head), trophy position, downward snap
export function analyzeServe(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const rWrist = landmarks[LM.RIGHT_WRIST];
  const lWrist = landmarks[LM.LEFT_WRIST];
  const nose = landmarks[LM.NOSE];

  if (!vis(rShoulder) || !vis(rElbow) || !vis(rWrist) || !vis(nose)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready'; // ready → toss → trophy → snap → recovery
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Toss hand = left wrist above head
  const tossHandHigh = vis(lWrist) && lWrist.y < nose.y - 0.05;
  // Trophy: right elbow back, right wrist high
  const elbowAngle = angle(rShoulder, rElbow, rWrist);
  const wristAboveHead = rWrist.y < nose.y;
  const trophyPosition = elbowAngle < 110 && wristAboveHead;
  // Snap: wrist drops fast below shoulder
  const wristBelowShoulder = rWrist.y > rShoulder.y;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && tossHandHigh) {
      newPhase = 'toss';
    } else if (phase === 'toss' && trophyPosition) {
      newPhase = 'trophy';
    } else if (phase === 'trophy' && wristBelowShoulder) {
      newPhase = 'snap';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'snap' && !wristBelowShoulder) {
      newPhase = 'ready';
    }

    // Form checks
    if (newPhase === 'toss' && tossHandHigh) {
      if (vis(lWrist) && lWrist.y > nose.y - 0.02) {
        feedback = { type: 'warning', text: 'הזריקה נמוכה! זרוק את הכדור גבוה יותר' };
        formIssues.lowToss = (formIssues.lowToss || 0) + 1;
      }
    }

    if (newPhase === 'toss' && !trophyPosition && moving) {
      const timeSinceToss = Date.now() - (prevState._tossTime || Date.now());
      if (timeSinceToss > 500) {
        formIssues.noTrophyPosition = (formIssues.noTrophyPosition || 0) + 1;
      }
    }

    if (moving && trophyPosition && !feedback) {
      feedback = { type: 'good', text: 'עמדת טרופי מצוינת!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving,
    headDown: false, lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _tossTime: newPhase === 'toss' && phase !== 'toss' ? Date.now() : (prevState._tossTime || null),
    _prevLandmarks: landmarks
  };
}

// ============================================
// TENNIS: Footwork
// ============================================
// Tracks lateral hip movement amplitude, step frequency
export function analyzeFootwork(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];

  if (!vis(lHip) || !vis(rHip)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks };
  }

  const hipCenterX = (lHip.x + rHip.x) / 2;
  const hipHistory = prevState._hipXHistory || [];
  hipHistory.push(hipCenterX);
  if (hipHistory.length > 60) hipHistory.shift(); // 1s window

  let firstRepStarted = prevState.firstRepStarted || false;
  let feedback = null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Step frequency: count direction changes in hip X
  const stepHistory = prevState._stepHistory || [];
  let steps = prevState._steps || 0;
  let lastDir = prevState._lastDir || 0;

  if (hipHistory.length >= 3) {
    const curr = hipHistory[hipHistory.length - 1];
    const prev = hipHistory[hipHistory.length - 2];
    const dir = curr - prev > 0.002 ? 1 : (curr - prev < -0.002 ? -1 : 0);
    if (dir !== 0 && dir !== lastDir && lastDir !== 0) {
      steps++;
      stepHistory.push(Date.now());
      if (stepHistory.length > 20) stepHistory.shift();
    }
    if (dir !== 0) lastDir = dir;
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted && hipHistory.length >= 30) {
    const amplitude = Math.max(...hipHistory.slice(-30)) - Math.min(...hipHistory.slice(-30));

    // Steps per second
    const recentSteps = stepHistory.filter(t => Date.now() - t < 3000).length;
    const stepsPerSec = recentSteps / 3;

    if (amplitude < 0.03) {
      feedback = { type: 'warning', text: 'זזי יותר לצדדים! עבודת רגליים פעילה!' };
      formIssues.flatFooted = (formIssues.flatFooted || 0) + 1;
    } else if (stepsPerSec < 1) {
      feedback = { type: 'warning', text: 'מהר יותר! צעדים קטנים ומהירים' };
      formIssues.slowSteps = (formIssues.slowSteps || 0) + 1;
    } else if (amplitude > 0.08 && stepsPerSec > 2) {
      feedback = { type: 'good', text: 'עבודת רגליים מעולה! קצב וטווח מצוינים!' };
    }

    // Check return to center
    if (vis(lAnkle) && vis(rAnkle)) {
      const ankleSpread = Math.abs(lAnkle.x - rAnkle.x);
      if (ankleSpread < 0.05 && moving) {
        formIssues.notReturningCenter = (formIssues.notReturningCenter || 0) + 1;
      }
    }
  }

  return {
    reps: steps, phase: 'active', feedback, moving,
    headDown: false, lastRepTime: moving ? Date.now() : prevState.lastRepTime,
    firstRepStarted, posture: 'standing', formIssues,
    _hipXHistory: hipHistory, _stepHistory: stepHistory, _steps: steps, _lastDir: lastDir,
    _prevLandmarks: landmarks
  };
}

// ============================================
// FOOTBALL: Kick Technique
// ============================================
// Tracks plant foot stability, kicking leg angle + follow-through, hip rotation
export function analyzeKickTechnique(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE];
  const rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER];

  if (!vis(lHip) || !vis(rHip) || !vis(lKnee) || !vis(rKnee)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready'; // ready → windup → strike → follow_through
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Detect kicking leg: the one with ankle moving up (Y decreasing)
  const ankleHistory = prevState._ankleHistory || { left: [], right: [] };
  if (vis(lAnkle)) { ankleHistory.left.push(lAnkle.y); if (ankleHistory.left.length > 15) ankleHistory.left.shift(); }
  if (vis(rAnkle)) { ankleHistory.right.push(rAnkle.y); if (ankleHistory.right.length > 15) ankleHistory.right.shift(); }

  // Which leg is kicking (more ankle Y variance)
  const lVariance = ankleHistory.left.length > 5 ? Math.max(...ankleHistory.left) - Math.min(...ankleHistory.left) : 0;
  const rVariance = ankleHistory.right.length > 5 ? Math.max(...ankleHistory.right) - Math.min(...ankleHistory.right) : 0;
  const kickLeg = lVariance > rVariance ? 'left' : 'right';
  const plantLeg = kickLeg === 'left' ? 'right' : 'left';

  const kickHip = kickLeg === 'left' ? lHip : rHip;
  const kickKnee = kickLeg === 'left' ? lKnee : rKnee;
  const kickAnkle = kickLeg === 'left' ? lAnkle : rAnkle;
  const plantAnkle = plantLeg === 'left' ? lAnkle : rAnkle;

  // Kick leg angle
  let kickAngleVal = null;
  if (vis(kickAnkle)) {
    kickAngleVal = angle(kickHip, kickKnee, kickAnkle);
  }

  // Hip rotation
  const shoulderDiffX = vis(rShoulder) && vis(lShoulder) ? rShoulder.x - lShoulder.x : 0;
  const hipDiffX = rHip.x - lHip.x;
  const rotation = Math.abs(shoulderDiffX - hipDiffX) * 180;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    // Detect kick phases via ankle position
    const kickAnkleHigh = vis(kickAnkle) && kickAnkle.y < kickHip.y;
    const kickAnkleBehind = vis(kickAnkle) && ((kickLeg === 'right' && kickAnkle.x < kickHip.x) || (kickLeg === 'left' && kickAnkle.x > kickHip.x));

    if (phase === 'ready' && kickAnkleBehind) {
      newPhase = 'windup';
    } else if (phase === 'windup' && kickAnkleHigh) {
      newPhase = 'strike';
    } else if (phase === 'strike' && !kickAnkleHigh) {
      newPhase = 'follow_through';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'follow_through' && !kickAnkleBehind && !kickAnkleHigh) {
      newPhase = 'ready';
    }

    // Plant foot stability
    if (vis(plantAnkle) && prevState._prevPlantAnkle) {
      const plantDrift = Math.abs(plantAnkle.x - prevState._prevPlantAnkle.x) + Math.abs(plantAnkle.y - prevState._prevPlantAnkle.y);
      if (plantDrift > 0.03 && (newPhase === 'windup' || newPhase === 'strike')) {
        feedback = { type: 'warning', text: 'רגל עמידה לא יציבה! נעל את הרגל לפני הבעיטה' };
        formIssues.plantFootUnstable = (formIssues.plantFootUnstable || 0) + 1;
      }
    }

    // Hip rotation check
    if ((newPhase === 'strike' || newPhase === 'windup') && rotation < 15) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'סובב את המותניים! כוח מגיע מסיבוב הגוף' };
        formIssues.noHipRotation = (formIssues.noHipRotation || 0) + 1;
      }
    }

    // Follow-through: kick leg should swing through
    if (newPhase === 'follow_through' && kickAngleVal !== null && kickAngleVal < 120) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'סיים את הבעיטה! רגל ממשיכה קדימה ולמעלה' };
        formIssues.noFollowThrough = (formIssues.noFollowThrough || 0) + 1;
      }
    }

    if (moving && !feedback && (newPhase === 'strike' || newPhase === 'follow_through') && rotation > 30) {
      feedback = { type: 'good', text: 'בעיטה חזקה! סיבוב גוף מעולה!' };
    }

    // Ball-aware: track ball after kick
    if (ballData?.detected && newPhase === 'follow_through') {
      if (ballData.distanceEstimate && ballData.distanceEstimate > 300) {
        if (!feedback) feedback = { type: 'good', text: 'בעיטה ארוכה! כוח מצוין!' };
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _ankleHistory: ankleHistory,
    _prevPlantAnkle: vis(plantAnkle) ? { x: plantAnkle.x, y: plantAnkle.y } : prevState._prevPlantAnkle,
    _prevLandmarks: landmarks
  };
}

// ============================================
// PARALYMPIC: Amputee Football — Crutch Kick
// ============================================
// Biomechanics: 175% body weight on upper extremities during kick.
// Crutch elbow ~150° (30° flexion). Hip-shoulder rotation > 30° for power.
// Phases: ready → windup → strike → follow_through
export function analyzeAmputeeCrutchKick(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE], rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Crutch elbow angles — both arms on crutches
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;

  // Standing leg detection (whichever ankle is visible and lower = standing)
  let standingKnee = null, standingHip = null, standingAnkle = null;
  let kickAnkle = null;
  if (vis(lAnkle) && vis(rAnkle)) {
    if (lAnkle.y > rAnkle.y) { standingKnee = lKnee; standingHip = lHip; standingAnkle = lAnkle; kickAnkle = rAnkle; }
    else { standingKnee = rKnee; standingHip = rHip; standingAnkle = rAnkle; kickAnkle = lAnkle; }
  } else if (vis(lAnkle)) { standingKnee = lKnee; standingHip = lHip; standingAnkle = lAnkle; }
  else if (vis(rAnkle)) { standingKnee = rKnee; standingHip = rHip; standingAnkle = rAnkle; }

  const rotation = getTrunkRotation(landmarks);
  const rotationThreshold = calThreshold(cal, 'trunkRotation', 0.5, 30);

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    // Detect kick via ankle movement
    const kickAnkleHigh = kickAnkle && vis(kickAnkle) && standingHip && kickAnkle.y < standingHip.y;
    const ankleHistory = prevState._ankleHistory || [];
    if (kickAnkle && vis(kickAnkle)) { ankleHistory.push(kickAnkle.y); if (ankleHistory.length > 15) ankleHistory.shift(); }
    const ankleRising = ankleHistory.length >= 3 && ankleHistory[ankleHistory.length - 1] < ankleHistory[ankleHistory.length - 3];

    if (phase === 'ready' && ankleRising) {
      newPhase = 'windup';
    } else if (phase === 'windup' && kickAnkleHigh) {
      newPhase = 'strike';
    } else if (phase === 'strike' && !kickAnkleHigh) {
      newPhase = 'follow_through';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'follow_through' && !ankleRising) {
      newPhase = 'ready';
    }

    // Crutch stability: elbow should stay ~150° (30° flexion), not collapse
    const crutchElbowMin = calThreshold(cal, 'leftElbow', 0.7, 130);
    if (lElbowAngle !== null && lElbowAngle < crutchElbowMin && (newPhase === 'windup' || newPhase === 'strike')) {
      feedback = { type: 'warning', text: 'שמור על המרפקים יציבים על הקביים! אל תכופף יותר מדי' };
      formIssues.crutchElbowCollapse = (formIssues.crutchElbowCollapse || 0) + 1;
    }
    if (rElbowAngle !== null && rElbowAngle < crutchElbowMin && (newPhase === 'windup' || newPhase === 'strike')) {
      if (!feedback) feedback = { type: 'warning', text: 'שמור על המרפקים יציבים על הקביים!' };
      formIssues.crutchElbowCollapse = (formIssues.crutchElbowCollapse || 0) + 1;
    }

    // Hip-shoulder rotation for power
    if ((newPhase === 'strike' || newPhase === 'windup') && rotation < rotationThreshold) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'סובב את הגוף! כוח הבעיטה מגיע מסיבוב מותניים-כתפיים' };
        formIssues.noRotation = (formIssues.noRotation || 0) + 1;
      }
    }

    // Good form feedback
    if (moving && !feedback && rotation > rotationThreshold && newPhase === 'strike') {
      feedback = { type: 'good', text: 'בעיטה חזקה! סיבוב גוף מעולה עם יציבות קביים!' };
    }

    return {
      reps: newReps, phase: newPhase, feedback, moving, headDown: false,
      lastRepTime, firstRepStarted, posture: 'standing', formIssues,
      _ankleHistory: ankleHistory, _prevLandmarks: landmarks, _calibration: cal
    };
  }

  return {
    reps, phase, feedback: null, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// PARALYMPIC: Amputee Football — Crutch Sprint
// ============================================
// Biomechanics: Forward pelvic tilt correlates with speed.
// Track elbow extension cycles as strides. Nose ahead of hips = good lean.
export function analyzeAmputeeCrutchSprint(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0; // strides
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Track elbow extension cycles as stride count
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  const avgElbow = lElbowAngle && rElbowAngle ? (lElbowAngle + rElbowAngle) / 2 : (lElbowAngle || rElbowAngle || 0);

  const elbowHistory = prevState._elbowHistory || [];
  elbowHistory.push(avgElbow);
  if (elbowHistory.length > 30) elbowHistory.shift();

  // Forward lean: nose X ahead of hip center X
  const hipMidX = vis(lHip) && vis(rHip) ? (lHip.x + rHip.x) / 2 : null;
  const hipMidY = vis(lHip) && vis(rHip) ? (lHip.y + rHip.y) / 2 : null;
  const forwardLean = vis(nose) && hipMidY !== null ? (hipMidY - nose.y) : 0; // positive = nose above hips (good)

  if (moving) firstRepStarted = true;

  // Count stride cycles from elbow extension oscillation
  let stridePhase = prevState._stridePhase || 'extend';
  let newReps = reps;

  if (firstRepStarted && elbowHistory.length >= 5) {
    const recent = elbowHistory.slice(-5);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const extendThreshold = calThreshold(cal, 'leftElbow', 0.7, 150);
    const flexThreshold = calThreshold(cal, 'leftElbow', 0.3, 110);

    if (stridePhase === 'extend' && avg < flexThreshold) {
      stridePhase = 'flex';
    } else if (stridePhase === 'flex' && avg > extendThreshold) {
      stridePhase = 'extend';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    // Tempo check: strides per second
    const strideHistory = prevState._strideHistory || [];
    if (newReps > reps) { strideHistory.push(Date.now()); if (strideHistory.length > 10) strideHistory.shift(); }
    const recentStrides = strideHistory.filter(t => Date.now() - t < 3000).length;
    const stridesPerSec = recentStrides / 3;

    // Forward lean check
    if (forwardLean < 0.05 && moving) {
      if (!feedback) feedback = { type: 'warning', text: 'הטה את הגוף קדימה! הטיית אגן קדימה מגבירה מהירות' };
      formIssues.notLeaningForward = (formIssues.notLeaningForward || 0) + 1;
    }

    // Good feedback
    if (moving && !feedback && forwardLean > 0.08 && stridesPerSec > 1.5) {
      feedback = { type: 'good', text: 'ספרינט מעולה! הטיה קדימה וקצב חזק!' };
    }

    return {
      reps: newReps, phase: 'active', feedback, moving, headDown: false,
      lastRepTime, firstRepStarted, posture: 'standing', formIssues,
      _elbowHistory: elbowHistory, _stridePhase: stridePhase, _strideHistory: strideHistory,
      _prevLandmarks: landmarks, _calibration: cal
    };
  }

  return {
    reps, phase: 'active', feedback: null, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _elbowHistory: elbowHistory, _stridePhase: stridePhase,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// PARALYMPIC: Wheelchair Basketball — Shooting
// ============================================
// Biomechanics: Elbow 75-90° at set point. Wrist above shoulder at release.
// Trunk lean forward for power compensation. NO legs required.
export function analyzeWheelchairBasketballShooting(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rElbow = landmarks[LM.RIGHT_ELBOW], lElbow = landmarks[LM.LEFT_ELBOW];
  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  // Pick shooting arm (whichever wrist is higher)
  let shoulder, elbow, wrist, elbowSide;
  if (vis(rWrist) && vis(lWrist)) {
    if (rWrist.y < lWrist.y) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; elbowSide = 'rightElbow'; }
    else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; elbowSide = 'leftElbow'; }
  } else if (vis(rWrist)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; elbowSide = 'rightElbow'; }
  else if (vis(lWrist)) { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; elbowSide = 'leftElbow'; }
  else { return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks, _calibration: cal }; }

  if (!vis(shoulder) || !vis(elbow)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks, _calibration: cal };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'setup';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const elbowAngle = angle(shoulder, elbow, wrist);
  const wristAboveShoulder = wrist.y < shoulder.y;
  const wristHighAbove = wrist.y < shoulder.y - 0.08;

  // Trunk lean: shoulders ahead of hips (forward lean for power)
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const hipMidY = (lHip.y + rHip.y) / 2;
  const trunkLean = hipMidY - shoulderMidY; // positive = leaning forward

  // Calibrated thresholds
  const setPointMax = calThreshold(cal, elbowSide, 0.4, 90);
  const setPointIdealMin = calThreshold(cal, elbowSide, 0.2, 75);

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    if (phase === 'setup' && wristAboveShoulder && elbowAngle < setPointMax + 30) {
      newPhase = 'release';
    } else if (phase === 'release' && wristHighAbove) {
      newPhase = 'follow_through';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'follow_through' && !wristAboveShoulder) {
      newPhase = 'setup';
    }

    // Elbow angle check at set point
    if (newPhase === 'setup' || newPhase === 'release') {
      if (elbowAngle > setPointMax + 20) {
        feedback = { type: 'warning', text: 'כווץ את המרפק יותר! שמור זווית 75-90 מעלות' };
        formIssues.elbowTooWide = (formIssues.elbowTooWide || 0) + 1;
      } else if (elbowAngle >= setPointIdealMin && elbowAngle <= setPointMax) {
        if (!feedback) feedback = { type: 'good', text: 'זווית מרפק מצוינת! סט-פוינט מושלם!' };
      }
    }

    // Trunk lean for wheelchair power compensation
    if (newPhase === 'release' && trunkLean < 0.02) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'הטה את הגוף קדימה! בכיסא גלגלים הכוח מגיע מהטיית הגוף' };
        formIssues.noTrunkLean = (formIssues.noTrunkLean || 0) + 1;
      }
    }

    // Follow-through check
    if (newPhase === 'follow_through' && !wristHighAbove) {
      formIssues.noFollowThrough = (formIssues.noFollowThrough || 0) + 1;
    }

    if (moving && !feedback && newPhase === 'follow_through' && wristHighAbove && trunkLean > 0.03) {
      feedback = { type: 'good', text: 'זריקה מעולה! פולו-ת\'רו גבוה עם הטיית גוף!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'wheelchair', formIssues,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// PARALYMPIC: Wheelchair Basketball — Dribbling
// ============================================
// Biomechanics: Wrist oscillation below shoulder level. Bounce tempo tracking.
// Push rim between bounces. NO legs required.
export function analyzeWheelchairBasketballDribbling(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;

  const wrist = vis(rWrist) ? rWrist : (vis(lWrist) ? lWrist : null);
  if (!wrist) return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks, _calibration: prevState._calibration };

  let firstRepStarted = prevState.firstRepStarted || false;
  const wristHistory = prevState._wristHistory || [];
  wristHistory.push(wrist.y);
  if (wristHistory.length > 30) wristHistory.shift();

  let feedback = null;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'up';
  let newPhase = phase;
  let newReps = reps;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  if (moving) firstRepStarted = true;

  if (firstRepStarted && wristHistory.length >= 10) {
    const recent = wristHistory.slice(-10);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const amplitude = max - min;

    if (amplitude > 0.03) {
      const current = recent[recent.length - 1];
      if (phase === 'up' && current > min + amplitude * 0.7) {
        newPhase = 'down';
      } else if (phase === 'down' && current < min + amplitude * 0.3) {
        newPhase = 'up';
        newReps = reps + 1;
        lastRepTime = Date.now();
        feedback = { type: 'count', text: `${newReps}!`, count: newReps };
      }
    }

    // Wheelchair: dribble must be below shoulder level (lower than standing)
    if (wrist.y < shoulderMidY) {
      feedback = { type: 'warning', text: 'כדרור נמוך יותר! בכיסא גלגלים הכדרור חייב להיות מתחת לכתפיים' };
      formIssues.dribblingTooHigh = (formIssues.dribblingTooHigh || 0) + 1;
    } else if (moving && amplitude > 0.03 && !feedback) {
      feedback = { type: 'good', text: 'כדרור מצוין! קצב נהדר!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'wheelchair', formIssues,
    _wristHistory: wristHistory, _prevLandmarks: landmarks, _calibration: prevState._calibration
  };
}

// ============================================
// PARALYMPIC: Wheelchair Basketball — Chest Pass
// ============================================
// Biomechanics: Full arm extension + trunk rotation for power.
// Phases: retract → extend. NO legs required.
export function analyzeWheelchairBasketballChestPass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'retract';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Arm extension: both elbows
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  const avgElbow = lElbowAngle && rElbowAngle ? (lElbowAngle + rElbowAngle) / 2 : (lElbowAngle || rElbowAngle || 0);

  const rotation = getTrunkRotation(landmarks);
  const extendThreshold = calThreshold(cal, 'leftElbow', 0.8, 150);
  const retractThreshold = calThreshold(cal, 'leftElbow', 0.3, 90);

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'retract' && avgElbow > extendThreshold) {
      newPhase = 'extend';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'extend' && avgElbow < retractThreshold) {
      newPhase = 'retract';
    }

    // Trunk rotation check — key for wheelchair power
    if (newPhase === 'extend' && rotation < 20) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'סובב את הגוף! סיבוב פלג עליון מוסיף כוח למסירה' };
        formIssues.noRotation = (formIssues.noRotation || 0) + 1;
      }
    }

    // Full extension check
    if (newPhase === 'extend' && avgElbow < 140) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'יישר את הידיים עד הסוף! מסירה חזקה = זרועות ישרות' };
        formIssues.incompleteExtension = (formIssues.incompleteExtension || 0) + 1;
      }
    }

    if (moving && !feedback && newPhase === 'extend' && rotation > 30 && avgElbow > 150) {
      feedback = { type: 'good', text: 'מסירה מושלמת! סיבוב + יישור מלא!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'wheelchair', formIssues,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// PARALYMPIC: Wheelchair Tennis — Stroke
// ============================================
// Biomechanics: LARGER trunk rotation than standing tennis (30°+ good, 60°+ excellent).
// Higher shoulder angular velocity. Full arm extension. NO legs required.
export function analyzeWheelchairTennisStroke(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const rotation = getTrunkRotation(landmarks);
  const rotationGood = calThreshold(cal, 'trunkRotation', 0.4, 30);
  const rotationExcellent = calThreshold(cal, 'trunkRotation', 0.7, 60);

  // Wrist speed tracking
  const wristSpeedHistory = prevState._wristSpeedHistory || [];
  const dominantWrist = vis(rWrist) ? rWrist : (vis(lWrist) ? lWrist : null);
  if (dominantWrist && prevState._prevWristPos) {
    const speed = Math.sqrt(
      Math.pow(dominantWrist.x - prevState._prevWristPos.x, 2) +
      Math.pow(dominantWrist.y - prevState._prevWristPos.y, 2)
    );
    wristSpeedHistory.push(speed);
    if (wristSpeedHistory.length > 20) wristSpeedHistory.shift();
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    const maxSpeed = wristSpeedHistory.length > 0 ? Math.max(...wristSpeedHistory) : 0;

    if (phase === 'ready' && maxSpeed > 0.02) {
      newPhase = 'backswing';
    } else if (phase === 'backswing' && maxSpeed > 0.05) {
      newPhase = 'strike';
    } else if (phase === 'strike' && maxSpeed < 0.02) {
      newPhase = 'follow_through';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'follow_through' && maxSpeed < 0.01) {
      newPhase = 'ready';
    }

    // Wheelchair tennis needs MORE rotation than standing
    if (moving && (newPhase === 'strike' || newPhase === 'backswing')) {
      if (rotation < rotationGood) {
        feedback = { type: 'warning', text: 'סובב יותר! בכיסא גלגלים סיבוב הגוף חשוב אפילו יותר!' };
        formIssues.insufficientRotation = (formIssues.insufficientRotation || 0) + 1;
      } else if (rotation > rotationExcellent) {
        if (!feedback) feedback = { type: 'good', text: 'סיבוב מדהים! כוח מלא מפלג גוף עליון!' };
      }
    }

    // Follow-through: wrist should end high (above shoulders)
    if (newPhase === 'follow_through' && dominantWrist) {
      const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
      if (dominantWrist.y > shoulderMidY) {
        if (!feedback) feedback = { type: 'warning', text: 'סיים למעלה! פולו-ת\'רו גבוה מעל הכתפיים' };
        formIssues.lowFollowThrough = (formIssues.lowFollowThrough || 0) + 1;
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'wheelchair', formIssues,
    _wristSpeedHistory: wristSpeedHistory,
    _prevWristPos: dominantWrist ? { x: dominantWrist.x, y: dominantWrist.y } : prevState._prevWristPos,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// PARALYMPIC: Wheelchair Tennis — Serve
// ============================================
// Biomechanics: Lower toss point (seated). Trunk lean critical for power.
// Trophy position with forward lean. NO legs required.
export function analyzeWheelchairTennisServe(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const nose = landmarks[LM.NOSE];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  if (!vis(rShoulder) || !vis(rElbow) || !vis(rWrist) || !vis(nose)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks, _calibration: cal };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Toss: left wrist above nose (lower threshold for wheelchair — seated toss)
  const tossHandHigh = vis(lWrist) && lWrist.y < nose.y;
  // Trophy position: elbow bent, wrist above head
  const elbowAngle = angle(rShoulder, rElbow, rWrist);
  const wristAboveHead = rWrist.y < nose.y;
  const trophyPosition = elbowAngle < 120 && wristAboveHead;
  // Snap: wrist drops below shoulder
  const wristBelowShoulder = rWrist.y > rShoulder.y;

  // Trunk lean for power
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const hipMidY = (lHip.y + rHip.y) / 2;
  const trunkLean = hipMidY - shoulderMidY;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && tossHandHigh) {
      newPhase = 'toss';
    } else if (phase === 'toss' && trophyPosition) {
      newPhase = 'trophy';
    } else if (phase === 'trophy' && wristBelowShoulder) {
      newPhase = 'snap';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'snap' && !wristBelowShoulder) {
      newPhase = 'ready';
    }

    // Trunk lean check during trophy/snap
    if ((newPhase === 'trophy' || newPhase === 'snap') && trunkLean < 0.03) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'הטה קדימה! בכיסא גלגלים הטיית הגוף קריטית לכוח ההגשה' };
        formIssues.noTrunkLean = (formIssues.noTrunkLean || 0) + 1;
      }
    }

    // Elbow angle at trophy
    const trophyElbowMax = calThreshold(cal, 'rightElbow', 0.5, 110);
    if (newPhase === 'trophy' && elbowAngle > trophyElbowMax + 10) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'כופף את המרפק יותר בעמדת הטרופי!' };
        formIssues.trophyElbowWide = (formIssues.trophyElbowWide || 0) + 1;
      }
    }

    if (moving && trophyPosition && !feedback && trunkLean > 0.04) {
      feedback = { type: 'good', text: 'עמדת טרופי מצוינת עם הטיה קדימה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'wheelchair', formIssues,
    _tossTime: newPhase === 'toss' && phase !== 'toss' ? Date.now() : (prevState._tossTime || null),
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// BASKETBALL: Layup
// ============================================
// Tracks two-step gather, knee drive, arm extension
export function analyzeLayup(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rElbow = landmarks[LM.RIGHT_ELBOW];
  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];
  const rHip = landmarks[LM.RIGHT_HIP], lHip = landmarks[LM.LEFT_HIP];
  const rKnee = landmarks[LM.RIGHT_KNEE], lKnee = landmarks[LM.LEFT_KNEE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE], lAnkle = landmarks[LM.LEFT_ANKLE];

  // Pick shooting arm (higher wrist)
  let shoulder, elbow, wrist;
  if (vis(rWrist) && vis(lWrist)) {
    if (rWrist.y < lWrist.y) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
    else { shoulder = lShoulder; elbow = landmarks[LM.LEFT_ELBOW]; wrist = lWrist; }
  } else if (vis(rWrist)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
  else if (vis(lWrist)) { shoulder = lShoulder; elbow = landmarks[LM.LEFT_ELBOW]; wrist = lWrist; }
  else { return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks }; }

  if (!vis(shoulder) || !vis(elbow)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'approach';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const elbowAngle = angle(shoulder, elbow, wrist);
  const wristAboveHead = vis(landmarks[LM.NOSE]) && wrist.y < landmarks[LM.NOSE].y;

  // Knee drive detection (opposite knee)
  let kneeAngle = null;
  const driveKnee = (wrist === rWrist) ? lKnee : rKnee;
  const driveHip = (wrist === rWrist) ? lHip : rHip;
  const driveAnkle = (wrist === rWrist) ? lAnkle : rAnkle;
  if (vis(driveHip) && vis(driveKnee) && vis(driveAnkle)) {
    kneeAngle = angle(driveHip, driveKnee, driveAnkle);
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    if (phase === 'approach' && kneeAngle !== null && kneeAngle < 100) {
      newPhase = 'knee_drive';
    } else if (phase === 'knee_drive' && wristAboveHead) {
      newPhase = 'release';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'release' && !wristAboveHead) {
      newPhase = 'approach';
    }

    if (newPhase === 'knee_drive' && kneeAngle !== null && kneeAngle > 110) {
      feedback = { type: 'warning', text: 'הרם את הברך גבוה יותר! כוח מגיע מדחיפת הברך' };
      formIssues.lowKneeDrive = (formIssues.lowKneeDrive || 0) + 1;
    }

    if (newPhase === 'release' && elbowAngle < 140) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'הארך את היד לגמרי! סיים למעלה' };
        formIssues.noFullExtension = (formIssues.noFullExtension || 0) + 1;
      }
    }

    if (!feedback && newPhase === 'release' && elbowAngle > 150 && kneeAngle !== null && kneeAngle < 90) {
      feedback = { type: 'good', text: 'עלייה לסל מעולה! ברך גבוהה ויד מלאה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Crossover Dribble
// ============================================
// Low stance, ball crosses body, head up
export function analyzeCrossover(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];
  const rHip = landmarks[LM.RIGHT_HIP], lHip = landmarks[LM.LEFT_HIP];
  const rKnee = landmarks[LM.RIGHT_KNEE], lKnee = landmarks[LM.LEFT_KNEE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE], lAnkle = landmarks[LM.LEFT_ANKLE];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];

  if (!vis(rHip) || !vis(lHip) || !vis(rKnee) || !vis(lKnee)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'right'; // right → cross → left → cross
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Knee angles for stance
  let kneeAngle = null;
  if (vis(rAnkle)) kneeAngle = angle(rHip, rKnee, rAnkle);

  // Wrist cross detection: track which side of body midline the active wrist is on
  const bodyMidX = (rHip.x + lHip.x) / 2;
  const rWristSide = vis(rWrist) ? (rWrist.x > bodyMidX ? 'right' : 'left') : null;
  const lWristSide = vis(lWrist) ? (lWrist.x > bodyMidX ? 'right' : 'left') : null;

  // Ball height: wrist Y relative to hip
  const hipMidY = (rHip.y + lHip.y) / 2;
  const activeWrist = vis(rWrist) ? rWrist : (vis(lWrist) ? lWrist : null);
  const ballHigh = activeWrist && activeWrist.y < hipMidY;

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    // Track crossover: wrist crosses body midline
    const prevSide = prevState._wristSide || 'right';
    const currentSide = rWristSide || lWristSide || prevSide;

    if (currentSide !== prevSide) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    // Low stance check
    if (kneeAngle !== null && kneeAngle > 150) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'תרד נמוך יותר! ברכיים כפופות לשליטה' };
        formIssues.stanceTooHigh = (formIssues.stanceTooHigh || 0) + 1;
      }
    }

    // Ball too high
    if (ballHigh) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'כדור נמוך! שמור מתחת למותניים' };
        formIssues.ballTooHigh = (formIssues.ballTooHigh || 0) + 1;
      }
    }

    if (headDown && !feedback) {
      feedback = { type: 'warning', text: 'ראש למעלה! תסתכל קדימה' };
      formIssues.headDown = (formIssues.headDown || 0) + 1;
    }

    if (!feedback && kneeAngle !== null && kneeAngle < 130) {
      feedback = { type: 'good', text: 'עמידה נמוכה מעולה! שליטה יציבה!' };
    }

    return {
      reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
      lastRepTime, firstRepStarted, posture: 'standing', formIssues,
      _wristSide: currentSide, _prevLandmarks: landmarks
    };
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _wristSide: prevState._wristSide || 'right', _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Defensive Slide
// ============================================
// Low stance, wide base, lateral movement, hands active
export function analyzeDefensiveSlide(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const rHip = landmarks[LM.RIGHT_HIP], lHip = landmarks[LM.LEFT_HIP];
  const rKnee = landmarks[LM.RIGHT_KNEE], lKnee = landmarks[LM.LEFT_KNEE];
  const rAnkle = landmarks[LM.RIGHT_ANKLE], lAnkle = landmarks[LM.LEFT_ANKLE];
  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];
  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];

  if (!vis(rHip) || !vis(lHip) || !vis(rKnee) || !vis(lKnee)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Knee angles
  let rKneeAngle = vis(rAnkle) ? angle(rHip, rKnee, rAnkle) : null;
  let lKneeAngle = vis(lAnkle) ? angle(lHip, lKnee, lAnkle) : null;
  const avgKnee = (rKneeAngle !== null && lKneeAngle !== null) ? (rKneeAngle + lKneeAngle) / 2 : (rKneeAngle || lKneeAngle);

  // Base width (ankle-to-ankle distance)
  const baseWidth = (vis(rAnkle) && vis(lAnkle)) ? Math.abs(rAnkle.x - lAnkle.x) : 0;
  const shoulderWidth = (vis(rShoulder) && vis(lShoulder)) ? Math.abs(rShoulder.x - lShoulder.x) : 0.2;

  // Lateral movement tracking
  const hipMidX = (rHip.x + lHip.x) / 2;
  const prevHipMidX = prevState._prevHipMidX || hipMidX;
  const lateralDelta = Math.abs(hipMidX - prevHipMidX);

  // Direction change = 1 rep
  const direction = hipMidX > prevHipMidX ? 'right' : 'left';
  const prevDir = prevState._slideDir || direction;

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    if (direction !== prevDir && lateralDelta > 0.005) {
      reps++;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${reps}!`, count: reps };
    }

    if (avgKnee !== null && avgKnee > 150) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'תרד נמוך! ברכיים כפופות, ישבן למטה' };
        formIssues.stanceTooHigh = (formIssues.stanceTooHigh || 0) + 1;
      }
    }

    if (baseWidth < shoulderWidth * 0.8) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'הרחב את הבסיס! רגליים רחבות מכתפיים' };
        formIssues.narrowBase = (formIssues.narrowBase || 0) + 1;
      }
    }

    // Hands should be up
    const handsUp = (vis(rWrist) && rWrist.y < rHip.y) || (vis(lWrist) && lWrist.y < lHip.y);
    if (!handsUp && !feedback) {
      feedback = { type: 'warning', text: 'ידיים למעלה! ידיים פעילות' };
      formIssues.handsDown = (formIssues.handsDown || 0) + 1;
    }

    if (!feedback && avgKnee !== null && avgKnee < 130) {
      feedback = { type: 'good', text: 'עמידת הגנה מצוינת! נמוך ורחב!' };
    }
  }

  return {
    reps, phase: 'sliding', feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevHipMidX: hipMidX, _slideDir: direction, _prevLandmarks: landmarks
  };
}

// ============================================
// TENNIS: Volley
// ============================================
// Short compact swing, firm wrist, punch through ball
export function analyzeVolley(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const rShoulder = landmarks[LM.RIGHT_SHOULDER], lShoulder = landmarks[LM.LEFT_SHOULDER];
  const rElbow = landmarks[LM.RIGHT_ELBOW], lElbow = landmarks[LM.LEFT_ELBOW];
  const rWrist = landmarks[LM.RIGHT_WRIST], lWrist = landmarks[LM.LEFT_WRIST];

  // Pick active arm (more forward wrist)
  let shoulder, elbow, wrist;
  if (vis(rWrist) && vis(lWrist)) {
    // In a volley, the forward arm is the one closer to camera (lower Z or more movement)
    if (vis(rElbow) && vis(rShoulder)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
    else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  } else if (vis(rWrist) && vis(rElbow)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
  else if (vis(lWrist) && vis(lElbow)) { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  else { return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks }; }

  if (!vis(shoulder) || !vis(elbow)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const elbowAngle = angle(shoulder, elbow, wrist);
  const wristSpeed = prevState._prevWristPos
    ? Math.sqrt(Math.pow(wrist.x - prevState._prevWristPos.x, 2) + Math.pow(wrist.y - prevState._prevWristPos.y, 2))
    : 0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    if (phase === 'ready' && wristSpeed > 0.03) {
      newPhase = 'punch';
    } else if (phase === 'punch' && wristSpeed < 0.01) {
      newPhase = 'recover';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'recover' && wristSpeed < 0.005) {
      newPhase = 'ready';
    }

    // Volley should be compact: elbow NOT too open
    if (newPhase === 'punch' && elbowAngle > 140) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'תנועה קצרה! מרפק קומפקטי, בלי סווינג ארוך' };
        formIssues.backswingTooLong = (formIssues.backswingTooLong || 0) + 1;
      }
    }

    // Good compact punch
    if (!feedback && newPhase === 'punch' && elbowAngle >= 70 && elbowAngle <= 120) {
      feedback = { type: 'good', text: 'ווליי קומפקטי מעולה! פאנץ\' חד!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevWristPos: { x: wrist.x, y: wrist.y }, _prevLandmarks: landmarks
  };
}

// ============================================
// FOOTBALL: Pass
// ============================================
// Inside-foot pass: plant foot to target, controlled swing, follow-through
export function analyzeFootballPass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE], rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];

  if (!vis(lHip) || !vis(rHip) || !vis(lKnee) || !vis(rKnee)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Detect passing leg (ankle variance)
  const ankleHistory = prevState._ankleHistory || { left: [], right: [] };
  if (vis(lAnkle)) { ankleHistory.left.push(lAnkle.y); if (ankleHistory.left.length > 15) ankleHistory.left.shift(); }
  if (vis(rAnkle)) { ankleHistory.right.push(rAnkle.y); if (ankleHistory.right.length > 15) ankleHistory.right.shift(); }

  const lVar = ankleHistory.left.length > 5 ? Math.max(...ankleHistory.left) - Math.min(...ankleHistory.left) : 0;
  const rVar = ankleHistory.right.length > 5 ? Math.max(...ankleHistory.right) - Math.min(...ankleHistory.right) : 0;
  const passLeg = lVar > rVar ? 'left' : 'right';

  const passKnee = passLeg === 'left' ? lKnee : rKnee;
  const passHip = passLeg === 'left' ? lHip : rHip;
  const passAnkle = passLeg === 'left' ? lAnkle : rAnkle;

  let passKneeAngle = vis(passAnkle) ? angle(passHip, passKnee, passAnkle) : null;

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    const ankleForward = vis(passAnkle) && passAnkle.y < passHip.y;

    if (phase === 'ready' && passKneeAngle !== null && passKneeAngle < 140) {
      newPhase = 'swing';
    } else if (phase === 'swing' && ankleForward) {
      newPhase = 'contact';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'contact' && !ankleForward) {
      newPhase = 'ready';
    }

    // Body position: shoulders over ball
    const shoulderMidY = (vis(lShoulder) && vis(rShoulder)) ? (lShoulder.y + rShoulder.y) / 2 : null;
    const hipMidY = (lHip.y + rHip.y) / 2;
    if (shoulderMidY !== null && newPhase === 'contact' && shoulderMidY < hipMidY - 0.1) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'גוף מעל הכדור! אל תישען אחורה' };
        formIssues.leaningBack = (formIssues.leaningBack || 0) + 1;
      }
    }

    if (!feedback && newPhase === 'contact') {
      feedback = { type: 'good', text: 'מסירה נקייה! מגע פנימי מדויק!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _ankleHistory: ankleHistory, _prevLandmarks: landmarks
  };
}

// ============================================
// FOOTBALL: First Touch (Ball Control)
// ============================================
// Cushion the ball, body behind ball line, soft contact
export function analyzeFirstTouch(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE], rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  if (!vis(lHip) || !vis(rHip) || !vis(lKnee) || !vis(rKnee)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Detect receiving foot (ankle with sudden movement)
  const ankleHistory = prevState._ankleHistory || { left: [], right: [] };
  if (vis(lAnkle)) { ankleHistory.left.push(lAnkle.y); if (ankleHistory.left.length > 10) ankleHistory.left.shift(); }
  if (vis(rAnkle)) { ankleHistory.right.push(rAnkle.y); if (ankleHistory.right.length > 10) ankleHistory.right.shift(); }

  // Knee flexion for cushion
  let rKneeAngle = vis(rAnkle) ? angle(rHip, rKnee, rAnkle) : null;
  let lKneeAngle = vis(lAnkle) ? angle(lHip, lKnee, lAnkle) : null;
  const avgKnee = (rKneeAngle !== null && lKneeAngle !== null) ? (rKneeAngle + lKneeAngle) / 2 : (rKneeAngle || lKneeAngle);

  if (moving) firstRepStarted = true;

  if (firstRepStarted && moving) {
    // Phase: foot lifts slightly (cushion) then settles
    if (phase === 'ready' && avgKnee !== null && avgKnee < 150) {
      newPhase = 'cushion';
    } else if (phase === 'cushion' && avgKnee !== null && avgKnee > 155) {
      newPhase = 'settle';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'settle') {
      newPhase = 'ready';
    }

    // Stance too stiff
    if (avgKnee !== null && avgKnee > 165 && newPhase === 'ready') {
      if (!feedback) {
        feedback = { type: 'warning', text: 'כופף ברכיים! קלוט את הכדור ברכות' };
        formIssues.stiffLegs = (formIssues.stiffLegs || 0) + 1;
      }
    }

    if (!feedback && newPhase === 'cushion') {
      feedback = { type: 'good', text: 'שליטה ראשונית טובה! מגע רך!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _ankleHistory: ankleHistory, _prevLandmarks: landmarks
  };
}

// ============================================
// FOOTBALL: Juggling
// ============================================
// Track ankle oscillation (up/down pattern), consistency
export function analyzeJuggling(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE], rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  if (!vis(lHip) || !vis(rHip)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'down';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Track both ankles to detect juggle touches (any foot lifts = potential touch)
  const hipMidY = (lHip.y + rHip.y) / 2;
  const lAnkleHigh = vis(lAnkle) && lAnkle.y < hipMidY;
  const rAnkleHigh = vis(rAnkle) && rAnkle.y < hipMidY;
  const anyAnkleHigh = lAnkleHigh || rAnkleHigh;

  // Knee angle of lifting leg
  let kneeAngle = null;
  if (lAnkleHigh && vis(lAnkle)) kneeAngle = angle(lHip, lKnee, lAnkle);
  else if (rAnkleHigh && vis(rAnkle)) kneeAngle = angle(rHip, rKnee, rAnkle);

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'down' && anyAnkleHigh) {
      newPhase = 'up';
    } else if (phase === 'up' && !anyAnkleHigh) {
      newPhase = 'down';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    // Knee lock check
    if (kneeAngle !== null && kneeAngle > 160 && newPhase === 'up') {
      if (!feedback) {
        feedback = { type: 'warning', text: 'נעל קרסול! קשיחות ברגל, מגע עם גב כף הרגל' };
        formIssues.looseLeg = (formIssues.looseLeg || 0) + 1;
      }
    }

    if (headDown && !feedback) {
      feedback = { type: 'warning', text: 'ראש למעלה! תנסה להרגיש את הכדור' };
      formIssues.headDown = (formIssues.headDown || 0) + 1;
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Pass
// ============================================
// Stable crutch base, weight on crutches, controlled pass
export function analyzeAmputeeCrutchPass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  if (!vis(lShoulder) || !vis(rShoulder) || !vis(lHip) || !vis(rHip)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks, _calibration: cal };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Trunk stability: vertical alignment
  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const hipMidY = (lHip.y + rHip.y) / 2;
  const trunkUpright = (hipMidY - shoulderMidY) > 0.08;

  // Wrist speed for detecting pass swing
  const wristSpeed = prevState._prevWristPos
    ? Math.sqrt(Math.pow((vis(rWrist) ? rWrist.x : 0) - prevState._prevWristPos.x, 2) + Math.pow((vis(rWrist) ? rWrist.y : 0) - prevState._prevWristPos.y, 2))
    : 0;

  // Elbow angles (crutch arm stability)
  const lElbowAngle = (vis(lShoulder) && vis(lElbow) && vis(lWrist)) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = (vis(rShoulder) && vis(rElbow) && vis(rWrist)) ? angle(rShoulder, rElbow, rWrist) : null;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && wristSpeed > 0.02) {
      newPhase = 'swing';
    } else if (phase === 'swing' && wristSpeed > 0.04) {
      newPhase = 'contact';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'contact' && wristSpeed < 0.01) {
      newPhase = 'ready';
    }

    // Trunk stability check
    if (!trunkUpright && (newPhase === 'swing' || newPhase === 'contact')) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'שמור גוף זקוף! יציבות על הקביים לפני המסירה' };
        formIssues.trunkUnstable = (formIssues.trunkUnstable || 0) + 1;
      }
    }

    if (!feedback && trunkUpright && newPhase === 'contact') {
      feedback = { type: 'good', text: 'מסירה יציבה מעולה! בסיס קביים חזק!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevWristPos: vis(rWrist) ? { x: rWrist.x, y: rWrist.y } : prevState._prevWristPos,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Balance
// ============================================
// Triangular base, centered weight, micro-adjustments
export function analyzeAmputeeCrutchBalance(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  let firstRepStarted = prevState.firstRepStarted || false;
  let feedback = null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Trunk alignment
  const shoulderMidX = (vis(lShoulder) && vis(rShoulder)) ? (lShoulder.x + rShoulder.x) / 2 : null;
  const hipMidX = (vis(lHip) && vis(rHip)) ? (lHip.x + rHip.x) / 2 : null;
  const lateralSway = (shoulderMidX !== null && hipMidX !== null) ? Math.abs(shoulderMidX - hipMidX) : 0;

  // Shoulder level
  const shoulderTilt = (vis(lShoulder) && vis(rShoulder)) ? Math.abs(lShoulder.y - rShoulder.y) : 0;

  // Crutch width (wrist spread)
  const crutchWidth = (vis(lWrist) && vis(rWrist)) ? Math.abs(lWrist.x - rWrist.x) : 0;
  const shoulderWidth = (vis(lShoulder) && vis(rShoulder)) ? Math.abs(lShoulder.x - rShoulder.x) : 0.15;

  if (moving) firstRepStarted = true;

  // Hold exercise: continuous feedback
  if (firstRepStarted) {
    if (lateralSway > 0.04) {
      feedback = { type: 'warning', text: 'מרכז כובד! שמור גוף ישר מעל בסיס התמיכה' };
      formIssues.lateralSway = (formIssues.lateralSway || 0) + 1;
    } else if (shoulderTilt > 0.04) {
      feedback = { type: 'warning', text: 'ישר כתפיים! כתפיים באותו גובה' };
      formIssues.shoulderTilt = (formIssues.shoulderTilt || 0) + 1;
    } else if (crutchWidth < shoulderWidth * 0.9) {
      feedback = { type: 'warning', text: 'הרחב קביים! בסיס משולש רחב יותר' };
      formIssues.narrowBase = (formIssues.narrowBase || 0) + 1;
    } else {
      feedback = { type: 'good', text: 'איזון מעולה! בסיס משולש יציב!' };
    }
  }

  return {
    reps: prevState.reps || 0, phase: 'balancing', feedback, moving, headDown: false,
    lastRepTime: prevState.lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Pivot
// ============================================
// Rotation on standing foot while maintaining crutch base
export function analyzeAmputeeCrutchPivot(landmarks, prevState = {}) {
  if (!landmarks) return { ...prevState, feedback: null };

  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;
  const rotation = getTrunkRotation(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'centered';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'centered' && rotation > 20) {
      newPhase = 'rotating';
    } else if (phase === 'rotating' && rotation < 10) {
      newPhase = 'centered';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    // Trunk stability during rotation
    const shoulderMidY = (vis(lShoulder) && vis(rShoulder)) ? (lShoulder.y + rShoulder.y) / 2 : null;
    const hipMidY = (vis(lHip) && vis(rHip)) ? (lHip.y + rHip.y) / 2 : null;
    const trunkUpright = shoulderMidY !== null && hipMidY !== null && (hipMidY - shoulderMidY) > 0.08;

    if (newPhase === 'rotating' && !trunkUpright) {
      if (!feedback) {
        feedback = { type: 'warning', text: 'שמור גוף זקוף בפיבוט! ליבה מחזיקה' };
        formIssues.trunkCollapse = (formIssues.trunkCollapse || 0) + 1;
      }
    }

    if (!feedback && newPhase === 'rotating' && rotation > 25) {
      feedback = { type: 'good', text: 'פיבוט חד! סיבוב מבוקר על הקביים!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// BASKETBALL: Bounce Pass
// ============================================
export function analyzeBouncePass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  // Safe access: individual landmarks may still be null after group validation passes (70%)
  if (!vis(lHip) && !vis(rHip)) return { ...prevState, feedback: null, _prevLandmarks: landmarks };
  const hipMidY = vis(lHip) && vis(rHip) ? (lHip.y + rHip.y) / 2 : (lHip || rHip).y;
  const wristMidY = vis(lWrist) && vis(rWrist) ? (lWrist.y + rWrist.y) / 2 : vis(lWrist) ? lWrist.y : vis(rWrist) ? rWrist.y : hipMidY;
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  if (lElbowAngle === null && rElbowAngle === null) return { ...prevState, feedback: null, _prevLandmarks: landmarks };
  const avgElbow = lElbowAngle !== null && rElbowAngle !== null ? (lElbowAngle + rElbowAngle) / 2 : (lElbowAngle ?? rElbowAngle);

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && wristMidY > hipMidY && avgElbow > 130) {
      newPhase = 'push';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'push' && wristMidY < hipMidY) {
      newPhase = 'ready';
    }

    if (!feedback && newPhase === 'push' && avgElbow < 120) {
      feedback = { type: 'warning', text: 'כופף יותר! מסירה מהמותניים' };
      formIssues.elbowNotExtended = (formIssues.elbowNotExtended || 0) + 1;
    }
    if (!feedback && newPhase === 'push' && avgElbow >= 130) {
      feedback = { type: 'good', text: 'כיוון טוב!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Chest Pass
// ============================================
export function analyzeChestPass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  // Safe angle computation — individual landmarks may be null after group validation
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  if (lElbowAngle === null && rElbowAngle === null) return { ...prevState, feedback: null, _prevLandmarks: landmarks };
  const avgElbow = lElbowAngle !== null && rElbowAngle !== null ? (lElbowAngle + rElbowAngle) / 2 : (lElbowAngle ?? rElbowAngle);

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'loaded';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'loaded' && avgElbow > 160) {
      newPhase = 'push';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'push' && avgElbow < 100) {
      newPhase = 'loaded';
    }

    if (!feedback && newPhase === 'loaded' && avgElbow > 120 && avgElbow < 160) {
      feedback = { type: 'warning', text: 'ישר את המרפקים לגמרי' };
      formIssues.incompleteExtension = (formIssues.incompleteExtension || 0) + 1;
    }
    if (!feedback && newPhase === 'push') {
      feedback = { type: 'good', text: 'מסירה חזקה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Overhead Pass
// ============================================
export function analyzeOverheadPass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  // Safe angle computation — individual landmarks may be null after group validation
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  if (lElbowAngle === null && rElbowAngle === null) return { ...prevState, feedback: null, _prevLandmarks: landmarks };
  const avgElbow = lElbowAngle !== null && rElbowAngle !== null ? (lElbowAngle + rElbowAngle) / 2 : (lElbowAngle ?? rElbowAngle);
  const wristMidY = vis(lWrist) && vis(rWrist) ? (lWrist.y + rWrist.y) / 2 : vis(lWrist) ? lWrist.y : vis(rWrist) ? rWrist.y : 0;
  const wristsAboveNose = vis(nose) ? wristMidY < nose.y : false;

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'up';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'up' && wristsAboveNose && avgElbow > 140) {
      newPhase = 'throw';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'throw' && !wristsAboveNose) {
      newPhase = 'up';
    }

    if (!feedback && newPhase === 'up' && wristsAboveNose && avgElbow < 130) {
      feedback = { type: 'warning', text: 'פתח מרפקים! זרוק מעל הראש' };
      formIssues.elbowsClosed = (formIssues.elbowsClosed || 0) + 1;
    }
    if (!feedback && newPhase === 'throw') {
      feedback = { type: 'good', text: 'מסירה גבוהה מעולה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Spin Move
// ============================================
export function analyzeSpinMove(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);
  const rotation = getTrunkRotation(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'facing';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };
  let peakRotation = prevState._peakRotation || 0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (rotation > peakRotation) peakRotation = rotation;

    if (phase === 'facing' && rotation > 30) {
      newPhase = 'spinning';
    } else if (phase === 'spinning' && peakRotation > 50 && rotation < 15) {
      newPhase = 'complete';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
      peakRotation = 0;
    } else if (phase === 'complete' && rotation < 10) {
      newPhase = 'facing';
    }

    const shoulderWidth = Math.abs(rShoulder.x - lShoulder.x);
    const hipWidth = Math.abs(rHip.x - lHip.x);
    if (!feedback && newPhase === 'spinning' && shoulderWidth < hipWidth * 0.5) {
      feedback = { type: 'warning', text: 'שמור על איזון! אל תאבד יציבות' };
      formIssues.unstable = (formIssues.unstable || 0) + 1;
    }
    if (!feedback && newPhase === 'complete') {
      feedback = { type: 'good', text: 'סיבוב חד! ספין מצוין!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _peakRotation: peakRotation
  };
}

// ============================================
// BASKETBALL: Hook Shot
// ============================================
export function analyzeHookShot(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  // Pick dominant arm (higher wrist)
  let shoulder, elbow, wrist;
  if (vis(rWrist) && vis(lWrist)) {
    if (rWrist.y < lWrist.y) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
    else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  } else if (vis(rWrist)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
  else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }

  if (!vis(shoulder) || !vis(elbow) || !vis(wrist)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'load';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const elbowAngle = angle(shoulder, elbow, wrist);
  const wristAboveHead = wrist.y < nose.y - 0.05;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'load' && wristAboveHead && elbowAngle > 120) {
      newPhase = 'release';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'release' && wrist.y > shoulder.y) {
      newPhase = 'load';
    }

    if (!feedback && newPhase === 'load' && wristAboveHead && elbowAngle < 100) {
      feedback = { type: 'warning', text: 'פתח יד! קשת רחבה יותר' };
      formIssues.tightArc = (formIssues.tightArc || 0) + 1;
    }
    if (!feedback && newPhase === 'release') {
      feedback = { type: 'good', text: 'הוק שוט מדויק!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// BASKETBALL: Post Moves
// ============================================
export function analyzePostMoves(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);
  const rotation = getTrunkRotation(landmarks);

  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'set';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };
  const prevHipMidX = prevState._hipMidX || null;

  const hipMidX = (lHip.x + rHip.x) / 2;
  const lateralShift = prevHipMidX !== null ? Math.abs(hipMidX - prevHipMidX) : 0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'set' && (lateralShift > 0.02 || rotation > 15)) {
      newPhase = 'move';
    } else if (phase === 'move' && lateralShift > 0.04 && rotation > 20) {
      newPhase = 'finish';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'finish' && lateralShift < 0.01) {
      newPhase = 'set';
    }

    const stanceWidth = vis(lAnkle) && vis(rAnkle) ? Math.abs(lAnkle.x - rAnkle.x) : 0;
    if (!feedback && stanceWidth < 0.1) {
      feedback = { type: 'warning', text: 'הרחב רגליים! בסיס רחב לפוסט' };
      formIssues.narrowStance = (formIssues.narrowStance || 0) + 1;
    }
    if (!feedback && newPhase === 'finish') {
      feedback = { type: 'good', text: 'מהלך פוסט חזק!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _hipMidX: hipMidX
  };
}

// ============================================
// TENNIS: Overhead Smash
// ============================================
export function analyzeOverheadSmash(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  // Dominant arm
  let shoulder, elbow, wrist;
  if (vis(rWrist) && vis(lWrist)) {
    if (rWrist.y < lWrist.y) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
    else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  } else if (vis(rWrist)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
  else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }

  if (!vis(shoulder) || !vis(elbow) || !vis(wrist)) {
    return { ...prevState, feedback: null, moving, headDown, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'prep';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const wristAboveNose = wrist.y < nose.y;
  const wristBelowShoulder = wrist.y > shoulder.y;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'prep' && wristAboveNose) {
      newPhase = 'swing';
    } else if (phase === 'swing' && wristBelowShoulder) {
      newPhase = 'prep';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    const elbowAngle = angle(shoulder, elbow, wrist);
    if (!feedback && newPhase === 'swing' && elbowAngle < 140) {
      feedback = { type: 'warning', text: 'ישר מרפק! חבוט מלמעלה בכוח' };
      formIssues.bentElbow = (formIssues.bentElbow || 0) + 1;
    }
    if (!feedback && newPhase === 'prep' && newReps > reps) {
      feedback = { type: 'good', text: 'סמאש חזק! נהדר!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// TENNIS: Split Step
// ============================================
export function analyzeSplitStep(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];
  if (!vis(lAnkle) || !vis(rAnkle)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const ankleMidY = (lAnkle.y + rAnkle.y) / 2;
  const ankleSpread = Math.abs(lAnkle.x - rAnkle.x);
  const baselineY = prevState._baselineY || ankleMidY;
  const baselineSpread = prevState._baselineSpread || ankleSpread;
  const jumped = ankleMidY < baselineY - 0.02;
  const landed = ankleSpread > baselineSpread + 0.03;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && jumped) {
      newPhase = 'jump';
    } else if (phase === 'jump' && landed) {
      newPhase = 'land';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'land' && !jumped && ankleSpread < baselineSpread + 0.02) {
      newPhase = 'ready';
    }

    if (!feedback && newPhase === 'land' && ankleSpread < baselineSpread + 0.05) {
      feedback = { type: 'warning', text: 'נחיתה רחבה יותר! פתח רגליים' };
      formIssues.narrowLanding = (formIssues.narrowLanding || 0) + 1;
    }
    if (!feedback && newPhase === 'land') {
      feedback = { type: 'good', text: 'ספליט סטפ מצוין!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _baselineY: baselineY, _baselineSpread: baselineSpread
  };
}

// ============================================
// FOOTBALL: Headers
// ============================================
export function analyzeHeaders(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.HEAD, ...LANDMARKS.UPPER_BODY, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ground';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const baselineNoseY = prevState._baselineNoseY || nose.y;
  const noseRise = baselineNoseY - nose.y;
  const shouldersLevel = Math.abs(lShoulder.y - rShoulder.y) < 0.04;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ground' && noseRise > 0.03) {
      newPhase = 'jump';
    } else if (phase === 'jump' && noseRise > 0.05 && shouldersLevel) {
      newPhase = 'contact';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'contact' && noseRise < 0.02) {
      newPhase = 'ground';
    }

    if (!feedback && newPhase === 'jump' && !shouldersLevel) {
      feedback = { type: 'warning', text: 'שמור כתפיים ישרות! יציבות בנגיחה' };
      formIssues.unevenShoulders = (formIssues.unevenShoulders || 0) + 1;
    }
    if (!feedback && newPhase === 'contact') {
      feedback = { type: 'good', text: 'נגיחה חזקה! עיניים פקוחות!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _baselineNoseY: baselineNoseY
  };
}

// ============================================
// FOOTBALL: Chest Control
// ============================================
export function analyzeChestControl(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE], rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const prevShoulderY = prevState._prevShoulderY || shoulderMidY;
  const shoulderDrop = shoulderMidY - prevShoulderY;

  let kneeAngle = null;
  if (vis(lHip) && vis(lKnee) && vis(lAnkle)) {
    kneeAngle = angle(lHip, lKnee, lAnkle);
  } else if (vis(rHip) && vis(rKnee) && vis(rAnkle)) {
    kneeAngle = angle(rHip, rKnee, rAnkle);
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && shoulderDrop > 0.005 && kneeAngle !== null && kneeAngle < 160) {
      newPhase = 'cushion';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'cushion' && shoulderDrop < 0.001) {
      newPhase = 'ready';
    }

    if (!feedback && newPhase === 'cushion' && (kneeAngle === null || kneeAngle > 165)) {
      feedback = { type: 'warning', text: 'כופף ברכיים! ספוג עם הגוף' };
      formIssues.stiffLegs = (formIssues.stiffLegs || 0) + 1;
    }
    if (!feedback && newPhase === 'cushion') {
      feedback = { type: 'good', text: 'קבלת חזה מעולה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevShoulderY: shoulderMidY
  };
}

// ============================================
// FOOTBALL: Cone Drill
// ============================================
export function analyzeConeDrill(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];
  if (!vis(lAnkle) || !vis(rAnkle)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'left';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const ankleMidX = (lAnkle.x + rAnkle.x) / 2;
  const prevAnkleX = prevState._prevAnkleX || ankleMidX;
  const lateralDelta = ankleMidX - prevAnkleX;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'left' && lateralDelta > 0.05) {
      newPhase = 'right';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'right' && lateralDelta < -0.05) {
      newPhase = 'left';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    if (!feedback && moving && Math.abs(lateralDelta) > 0.03 && Math.abs(lateralDelta) < 0.05) {
      feedback = { type: 'warning', text: 'מהר יותר! שינוי כיוון חד' };
      formIssues.slowChange = (formIssues.slowChange || 0) + 1;
    }
    if (!feedback && Math.abs(lateralDelta) >= 0.05) {
      feedback = { type: 'good', text: 'שינוי כיוון מעולה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevAnkleX: ankleMidX
  };
}

// ============================================
// FOOTBALL: Quick Turns
// ============================================
export function analyzeQuickTurns(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);
  const rotation = getTrunkRotation(landmarks);

  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'running';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const ankleMidX = (vis(lAnkle) && vis(rAnkle)) ? (lAnkle.x + rAnkle.x) / 2 : null;
  const prevAnkleX = prevState._prevAnkleX || ankleMidX;
  const ankleSpeed = ankleMidX !== null && prevAnkleX !== null ? Math.abs(ankleMidX - prevAnkleX) : 0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'running' && ankleSpeed < 0.005 && rotation > 10) {
      newPhase = 'braking';
    } else if (phase === 'braking' && rotation > 20) {
      newPhase = 'turned';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'turned' && rotation < 10 && ankleSpeed > 0.005) {
      newPhase = 'running';
    }

    if (!feedback && newPhase === 'braking' && rotation < 15) {
      feedback = { type: 'warning', text: 'סובב גוף! פנייה חדה יותר' };
      formIssues.shallowTurn = (formIssues.shallowTurn || 0) + 1;
    }
    if (!feedback && newPhase === 'turned') {
      feedback = { type: 'good', text: 'פנייה חדה! מהירות תגובה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevAnkleX: ankleMidX
  };
}

// ============================================
// FOOTBALL: Shield Ball
// ============================================
export function analyzeShieldBall(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'open';
  let newPhase = phase;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const shoulderWidth = vis(lShoulder) && vis(rShoulder) ? Math.abs(lShoulder.x - rShoulder.x) : 0;
  const wristSpread = vis(lWrist) && vis(rWrist) ? Math.abs(lWrist.x - rWrist.x) : 0;
  const stanceWidth = vis(lAnkle) && vis(rAnkle) ? Math.abs(lAnkle.x - rAnkle.x) : 0;
  const wideStance = stanceWidth > shoulderWidth * 1.2;
  const armsOut = wristSpread > shoulderWidth * 1.3;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'open' && wideStance && armsOut) {
      newPhase = 'shield';
      reps = (prevState.reps || 0) + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${reps}!`, count: reps };
    } else if (phase === 'shield' && (!wideStance || !armsOut)) {
      newPhase = 'open';
    }

    if (!feedback && newPhase === 'shield') {
      feedback = { type: 'good', text: 'הגנה מעולה! גוף חוסם!' };
    }
    if (!feedback && newPhase === 'open' && !wideStance) {
      feedback = { type: 'warning', text: 'הרחב רגליים! בסיס יציב' };
      formIssues.narrowStance = (formIssues.narrowStance || 0) + 1;
    }
    if (!feedback && newPhase === 'open' && !armsOut) {
      feedback = { type: 'warning', text: 'פרוש ידיים! הגדל שטח הגנה' };
      formIssues.armsIn = (formIssues.armsIn || 0) + 1;
    }
  }

  return {
    reps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Dribbling
// ============================================
export function analyzeCrutchDribbling(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const headDown = detectHeadDown(landmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'stable';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };
  const cal = prevState._calibration;

  const wristSpread = vis(lWrist) && vis(rWrist) ? Math.abs(lWrist.x - rWrist.x) : 0;
  const shoulderWidth = vis(lShoulder) && vis(rShoulder) ? Math.abs(lShoulder.x - rShoulder.x) : 0;
  const hipStable = vis(lHip) && vis(rHip) ? Math.abs(lHip.y - rHip.y) < 0.04 : false;

  // Track wrist Y oscillation for dribble detection
  const wristMidY = vis(lWrist) && vis(rWrist) ? Math.min(lWrist.y, rWrist.y) : 0;
  const prevWristY = prevState._prevWristY || wristMidY;
  const wristDelta = wristMidY - prevWristY;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'stable' && wristDelta > 0.02) {
      newPhase = 'dribble';
    } else if (phase === 'dribble' && wristDelta < -0.01) {
      newPhase = 'stable';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    if (!feedback && !hipStable) {
      feedback = { type: 'warning', text: 'שמור יציבות אגן! שליטה עם הקביים' };
      formIssues.hipUnstable = (formIssues.hipUnstable || 0) + 1;
    }
    if (!feedback && wristSpread < shoulderWidth * 0.8) {
      feedback = { type: 'warning', text: 'קביים רחוקות! בסיס רחב יותר' };
      formIssues.narrowCrutch = (formIssues.narrowCrutch || 0) + 1;
    }
    if (!feedback && newPhase === 'stable' && newReps > reps) {
      feedback = { type: 'good', text: 'כדרור עם קביים מצוין!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: firstRepStarted ? headDown : false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevWristY: wristMidY, _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Agility
// ============================================
export function analyzeCrutchAgility(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'set';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const hipMidX = (lHip.x + rHip.x) / 2;
  const wristMidX = vis(lWrist) && vis(rWrist) ? (lWrist.x + rWrist.x) / 2 : hipMidX;
  const prevHipX = prevState._prevHipX || hipMidX;
  const lateralDelta = hipMidX - prevHipX;
  const prevDir = prevState._prevDir || 0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    const dirChanged = (prevDir > 0 && lateralDelta < -0.02) || (prevDir < 0 && lateralDelta > 0.02);

    if (phase === 'set' && Math.abs(lateralDelta) > 0.02) {
      newPhase = 'move';
    } else if (phase === 'move' && dirChanged) {
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    const wristHipSync = Math.abs(wristMidX - hipMidX) < 0.1;
    if (!feedback && !wristHipSync) {
      feedback = { type: 'warning', text: 'סנכרן קביים עם תנועת הגוף!' };
      formIssues.unsyncedCrutch = (formIssues.unsyncedCrutch || 0) + 1;
    }
    if (!feedback && newReps > reps) {
      feedback = { type: 'good', text: 'שינוי כיוון חד! זריזות מעולה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevHipX: hipMidX,
    _prevDir: Math.abs(lateralDelta) > 0.01 ? lateralDelta : prevDir,
    _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Shield
// ============================================
export function analyzeCrutchShield(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'open';
  let newPhase = phase;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const shoulderWidth = vis(lShoulder) && vis(rShoulder) ? Math.abs(lShoulder.x - rShoulder.x) : 0;
  const wristSpread = vis(lWrist) && vis(rWrist) ? Math.abs(lWrist.x - rWrist.x) : 0;
  const trunkStable = vis(lHip) && vis(rHip) ? Math.abs(lHip.y - rHip.y) < 0.03 : false;
  const wideCrutch = wristSpread > shoulderWidth * 2.0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'open' && wideCrutch && trunkStable) {
      newPhase = 'shield';
      reps = (prevState.reps || 0) + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${reps}!`, count: reps };
    } else if (phase === 'shield' && (!wideCrutch || !trunkStable)) {
      newPhase = 'open';
    }

    if (!feedback && newPhase === 'shield') {
      feedback = { type: 'good', text: 'הגנה עם קביים מעולה!' };
    }
    if (!feedback && !wideCrutch) {
      feedback = { type: 'warning', text: 'הרחב קביים! בסיס הגנה רחב' };
      formIssues.narrowCrutch = (formIssues.narrowCrutch || 0) + 1;
    }
    if (!feedback && !trunkStable) {
      feedback = { type: 'warning', text: 'ייצב גו! ליבה חזקה' };
      formIssues.trunkUnstable = (formIssues.trunkUnstable || 0) + 1;
    }
  }

  return {
    reps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Header
// ============================================
export function analyzeCrutchHeader(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.HEAD, ...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ground';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const baselineNoseY = prevState._baselineNoseY || nose.y;
  const noseRise = baselineNoseY - nose.y;
  const shoulderTilt = Math.abs(lShoulder.y - rShoulder.y);
  const trunkStable = shoulderTilt < 0.05;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ground' && noseRise > 0.02) {
      newPhase = 'up';
    } else if (phase === 'up' && noseRise > 0.04 && trunkStable) {
      newPhase = 'contact';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'contact' && noseRise < 0.01) {
      newPhase = 'ground';
    }

    if (!feedback && newPhase === 'up' && !trunkStable) {
      feedback = { type: 'warning', text: 'ייצב גוף! קביים תומכות בנגיחה' };
      formIssues.trunkTilt = (formIssues.trunkTilt || 0) + 1;
    }
    if (!feedback && newPhase === 'contact') {
      feedback = { type: 'good', text: 'נגיחה יציבה על קביים!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _baselineNoseY: baselineNoseY, _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL: Crutch Chest Control
// ============================================
export function analyzeCrutchChestControl(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);
  const cal = prevState._calibration;

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const prevShoulderY = prevState._prevShoulderY || shoulderMidY;
  const shoulderDrop = shoulderMidY - prevShoulderY;

  // Crutch stability: wrists should stay relatively still
  const wristMidY = vis(lWrist) && vis(rWrist) ? (lWrist.y + rWrist.y) / 2 : 0;
  const prevWristY = prevState._prevWristY || wristMidY;
  const wristStable = Math.abs(wristMidY - prevWristY) < 0.02;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && shoulderDrop > 0.005) {
      newPhase = 'cushion';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'cushion' && shoulderDrop < 0.001) {
      newPhase = 'ready';
    }

    if (!feedback && !wristStable) {
      feedback = { type: 'warning', text: 'קביים יציבות! ספוג רק עם החזה' };
      formIssues.crutchMovement = (formIssues.crutchMovement || 0) + 1;
    }
    if (!feedback && newPhase === 'cushion') {
      feedback = { type: 'good', text: 'קבלת חזה עם קביים יציבות!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevShoulderY: shoulderMidY,
    _prevWristY: wristMidY, _calibration: cal
  };
}

// ============================================
// AMPUTEE FOOTBALL GK: Dive
// ============================================
export function analyzeGKDive(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'ready';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
  const hipMidX = (lHip.x + rHip.x) / 2;
  const prevShoulderX = prevState._prevShoulderX || shoulderMidX;
  const lateralDisp = Math.abs(shoulderMidX - prevShoulderX);
  const totalDisp = prevState._totalDisp || 0;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'ready' && lateralDisp > 0.03) {
      newPhase = 'diving';
    } else if (phase === 'diving' && (totalDisp + lateralDisp) > 0.15) {
      newPhase = 'recovery';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'recovery' && lateralDisp < 0.01) {
      newPhase = 'ready';
    }

    if (!feedback && newPhase === 'diving') {
      const bodyExtended = Math.abs(shoulderMidX - hipMidX) > 0.05;
      if (!bodyExtended) {
        feedback = { type: 'warning', text: 'מתח גוף! צלילה מלאה לצד' };
        formIssues.compactDive = (formIssues.compactDive || 0) + 1;
      }
    }
    if (!feedback && newPhase === 'recovery') {
      feedback = { type: 'good', text: 'צלילה מעולה! קום מהר!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevShoulderX: shoulderMidX,
    _totalDisp: phase === 'diving' ? totalDisp + lateralDisp : 0
  };
}

// ============================================
// AMPUTEE FOOTBALL GK: Distribution
// ============================================
export function analyzeGKDistribution(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'set';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Check for arm extension (throw)
  let armExtended = false;
  if (vis(rShoulder) && vis(rElbow) && vis(rWrist)) {
    const rArmAngle = angle(rShoulder, rElbow, rWrist);
    if (rArmAngle > 155) armExtended = true;
  }
  if (!armExtended && vis(lShoulder) && vis(lElbow) && vis(lWrist)) {
    const lArmAngle = angle(lShoulder, lElbow, lWrist);
    if (lArmAngle > 155) armExtended = true;
  }

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'set' && armExtended) {
      newPhase = 'release';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'release' && !armExtended) {
      newPhase = 'set';
    }

    if (!feedback && newPhase === 'release') {
      const rotation = getTrunkRotation(landmarks);
      if (rotation < 10) {
        feedback = { type: 'warning', text: 'סובב גוף! כוח מהסיבוב' };
        formIssues.noRotation = (formIssues.noRotation || 0) + 1;
      } else {
        feedback = { type: 'good', text: 'חלוקה חזקה! דיוק מעולה!' };
      }
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// AMPUTEE FOOTBALL GK: Positioning (Hold)
// ============================================
export function analyzeGKPositioning(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HIPS, ...LANDMARKS.LEGS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];
  const lKnee = landmarks[LM.LEFT_KNEE], rKnee = landmarks[LM.RIGHT_KNEE];
  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'idle';
  let newPhase = phase;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Check knee bend (140-160 degrees = ready)
  let kneeAngle = null;
  if (vis(lHip) && vis(lKnee) && vis(lAnkle)) {
    kneeAngle = angle(lHip, lKnee, lAnkle);
  } else if (vis(rHip) && vis(rKnee) && vis(rAnkle)) {
    kneeAngle = angle(rHip, rKnee, rAnkle);
  }
  const kneesBent = kneeAngle !== null && kneeAngle >= 140 && kneeAngle <= 160;

  // Weight forward: shoulder X slightly ahead of hip X
  const shoulderMidX = (lShoulder.x + rShoulder.x) / 2;
  const hipMidX = (lHip.x + rHip.x) / 2;
  const weightForward = true; // X axis varies with camera angle, be lenient

  // Arms ready: wrists near hip height
  const hipMidY = (lHip.y + rHip.y) / 2;
  const wristMidY = vis(lWrist) && vis(rWrist) ? (lWrist.y + rWrist.y) / 2 : null;
  const armsReady = wristMidY !== null && Math.abs(wristMidY - hipMidY) < 0.15;

  const isActive = kneesBent && armsReady && weightForward;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'idle' && isActive) {
      newPhase = 'ready';
      reps = (prevState.reps || 0) + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${reps}!`, count: reps };
    } else if (phase === 'ready' && !isActive) {
      newPhase = 'idle';
    }

    if (!feedback && newPhase === 'ready') {
      feedback = { type: 'good', text: 'עמדת שוער מצוינת!' };
    }
    if (!feedback && !kneesBent) {
      feedback = { type: 'warning', text: 'כופף ברכיים! מוכנות לתגובה' };
      formIssues.straightKnees = (formIssues.straightKnees || 0) + 1;
    }
    if (!feedback && !armsReady) {
      feedback = { type: 'warning', text: 'ידיים לגובה המותן! מוכן לצלול' };
      formIssues.armsWrong = (formIssues.armsWrong || 0) + 1;
    }
  }

  return {
    reps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// AMPUTEE FOOTBALL GK: Reaction
// ============================================
export function analyzeGKReaction(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.LEGS, ...LANDMARKS.HIPS];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lAnkle = landmarks[LM.LEFT_ANKLE], rAnkle = landmarks[LM.RIGHT_ANKLE];
  const lHip = landmarks[LM.LEFT_HIP], rHip = landmarks[LM.RIGHT_HIP];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'set';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const ankleMidX = vis(lAnkle) && vis(rAnkle) ? (lAnkle.x + rAnkle.x) / 2 : null;
  const ankleMidY = vis(lAnkle) && vis(rAnkle) ? (lAnkle.y + rAnkle.y) / 2 : null;

  // Track stillness history (last 5 frames)
  const stillHistory = prevState._stillHistory || [];
  const prevAnkleX = prevState._prevAnkleX;
  const prevAnkleY = prevState._prevAnkleY;

  let frameDelta = 0;
  if (ankleMidX !== null && prevAnkleX !== null) {
    frameDelta = Math.abs(ankleMidX - prevAnkleX) + Math.abs(ankleMidY - prevAnkleY);
  }
  stillHistory.push(frameDelta);
  if (stillHistory.length > 5) stillHistory.shift();

  const wasStill = stillHistory.length >= 3 && stillHistory.slice(0, -1).every(d => d < 0.005);
  const currentBurst = frameDelta > 0.08;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'set' && wasStill && currentBurst) {
      newPhase = 'explode';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'explode' && frameDelta < 0.01) {
      newPhase = 'set';
    }

    if (!feedback && newPhase === 'explode') {
      feedback = { type: 'good', text: 'תגובה מהירה! צעד ראשון נפיץ!' };
    }
    if (!feedback && phase === 'set' && stillHistory.length >= 3 && !wasStill) {
      feedback = { type: 'warning', text: 'עמוד יציב! חכה לרגע הנכון' };
      formIssues.fidgeting = (formIssues.fidgeting || 0) + 1;
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'standing', formIssues,
    _prevLandmarks: landmarks, _prevAnkleX: ankleMidX, _prevAnkleY: ankleMidY,
    _stillHistory: stillHistory
  };
}

// ============================================
// WHEELCHAIR: Bounce Pass (Seated)
// ============================================
export function analyzeWCBouncePass(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  // Safe angle computation — individual landmarks may be null after group validation
  const lElbowAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rElbowAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  if (lElbowAngle === null && rElbowAngle === null) return { ...prevState, feedback: null, _prevLandmarks: landmarks };
  const avgElbow = lElbowAngle !== null && rElbowAngle !== null ? (lElbowAngle + rElbowAngle) / 2 : (lElbowAngle ?? rElbowAngle);
  const wristMidY = vis(lWrist) && vis(rWrist) ? (lWrist.y + rWrist.y) / 2 : vis(lWrist) ? lWrist.y : vis(rWrist) ? rWrist.y : 0;
  const shoulderMidY = vis(lShoulder) && vis(rShoulder) ? (lShoulder.y + rShoulder.y) / 2 : vis(lShoulder) ? lShoulder.y : vis(rShoulder) ? rShoulder.y : 0;

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'loaded';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Wrists pushing down past shoulder level
  const wristsBelowShoulders = wristMidY > shoulderMidY + 0.1;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'loaded' && wristsBelowShoulders && avgElbow > 130) {
      newPhase = 'push';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    } else if (phase === 'push' && !wristsBelowShoulders) {
      newPhase = 'loaded';
    }

    if (!feedback && newPhase === 'push' && avgElbow < 120) {
      feedback = { type: 'warning', text: 'ישר מרפקים! דחוף למטה בכוח' };
      formIssues.bentElbows = (formIssues.bentElbows || 0) + 1;
    }
    if (!feedback && newPhase === 'push') {
      feedback = { type: 'good', text: 'מסירת הקפצה מהכיסא מעולה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'seated', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// WHEELCHAIR: Push Sprint
// ============================================
export function analyzeWCPushSprint(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'push';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  // Track shoulder angle oscillation (forward push = shoulders rotate forward)
  const shoulderMidY = vis(lShoulder) && vis(rShoulder) ? (lShoulder.y + rShoulder.y) / 2 : vis(lShoulder) ? lShoulder.y : vis(rShoulder) ? rShoulder.y : 0;
  const wristMidY = vis(lWrist) && vis(rWrist) ? (lWrist.y + rWrist.y) / 2 : vis(lWrist) ? lWrist.y : vis(rWrist) ? rWrist.y : 0;
  const lArmAngle = vis(lShoulder) && vis(lElbow) && vis(lWrist) ? angle(lShoulder, lElbow, lWrist) : null;
  const rArmAngle = vis(rShoulder) && vis(rElbow) && vis(rWrist) ? angle(rShoulder, rElbow, rWrist) : null;
  if (lArmAngle === null && rArmAngle === null) return { ...prevState, feedback: null, _prevLandmarks: landmarks };
  const avgArmAngle = lArmAngle !== null && rArmAngle !== null ? (lArmAngle + rArmAngle) / 2 : (lArmAngle ?? rArmAngle);

  // Push: wrists go forward/down, Recovery: wrists come back up
  const wristsBelowShoulders = wristMidY > shoulderMidY;
  const wristsAboveShoulders = wristMidY < shoulderMidY - 0.02;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'push' && wristsBelowShoulders && avgArmAngle > 140) {
      newPhase = 'recovery';
    } else if (phase === 'recovery' && wristsAboveShoulders) {
      newPhase = 'push';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    if (!feedback && newPhase === 'push' && avgArmAngle < 100) {
      feedback = { type: 'warning', text: 'מתח זרועות! דחיפה ארוכה יותר' };
      formIssues.shortPush = (formIssues.shortPush || 0) + 1;
    }
    if (!feedback && newReps > 0 && newPhase === 'push') {
      feedback = { type: 'good', text: 'קצב דחיפה מעולה!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'seated', formIssues,
    _prevLandmarks: landmarks
  };
}

// ============================================
// WHEELCHAIR: Smash (Seated Overhead)
// ============================================
export function analyzeWCSmash(landmarks, prevState = {}, ballData = null) {
  if (!landmarks) return { ...prevState, feedback: null };
  const required = [...LANDMARKS.UPPER_BODY, ...LANDMARKS.HEAD];
  const validation = validateLandmarks(landmarks, required);
  if (!validation.valid) {
    return { ...prevState, feedback: { type: 'visibility', missingParts: validation.missingParts }, _prevLandmarks: landmarks };
  }

  const moving = detectMovement(landmarks, prevState._prevLandmarks);

  const nose = landmarks[LM.NOSE];
  const lShoulder = landmarks[LM.LEFT_SHOULDER], rShoulder = landmarks[LM.RIGHT_SHOULDER];
  const lElbow = landmarks[LM.LEFT_ELBOW], rElbow = landmarks[LM.RIGHT_ELBOW];
  const lWrist = landmarks[LM.LEFT_WRIST], rWrist = landmarks[LM.RIGHT_WRIST];

  // Dominant arm
  let shoulder, elbow, wrist;
  if (vis(rWrist) && vis(lWrist)) {
    if (rWrist.y < lWrist.y) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
    else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }
  } else if (vis(rWrist)) { shoulder = rShoulder; elbow = rElbow; wrist = rWrist; }
  else { shoulder = lShoulder; elbow = lElbow; wrist = lWrist; }

  if (!vis(shoulder) || !vis(elbow) || !vis(wrist)) {
    return { ...prevState, feedback: null, moving, _prevLandmarks: landmarks };
  }

  let firstRepStarted = prevState.firstRepStarted || false;
  let reps = prevState.reps || 0;
  let phase = prevState.phase || 'prep';
  let newPhase = phase;
  let newReps = reps;
  let feedback = null;
  let lastRepTime = prevState.lastRepTime || null;
  const formIssues = { ...(prevState.formIssues || {}) };

  const wristAboveNose = wrist.y < nose.y;
  const wristBelowShoulder = wrist.y > shoulder.y;

  if (moving) firstRepStarted = true;

  if (firstRepStarted) {
    if (phase === 'prep' && wristAboveNose) {
      newPhase = 'swing';
    } else if (phase === 'swing' && wristBelowShoulder) {
      newPhase = 'prep';
      newReps = reps + 1;
      lastRepTime = Date.now();
      feedback = { type: 'count', text: `${newReps}!`, count: newReps };
    }

    const elbowAngle = angle(shoulder, elbow, wrist);
    if (!feedback && newPhase === 'swing' && elbowAngle < 130) {
      feedback = { type: 'warning', text: 'ישר מרפק! חבוט מלמעלה בכוח' };
      formIssues.bentElbow = (formIssues.bentElbow || 0) + 1;
    }
    if (!feedback && newPhase === 'prep' && newReps > reps) {
      feedback = { type: 'good', text: 'סמאש מהכיסא! כוח עליון!' };
    }
  }

  return {
    reps: newReps, phase: newPhase, feedback, moving, headDown: false,
    lastRepTime, firstRepStarted, posture: 'seated', formIssues,
    _prevLandmarks: landmarks
  };
}
