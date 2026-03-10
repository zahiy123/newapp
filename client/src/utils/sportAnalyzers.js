// Sport-specific drill analyzers for basketball, tennis, and football
// Each analyzer follows the standard return format:
// { reps, phase, feedback: {type, text}, moving, posture, headDown, firstRepStarted, lastRepTime, formIssues }
// All accept optional ballData third param for ball-aware feedback

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
