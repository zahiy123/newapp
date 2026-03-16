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
