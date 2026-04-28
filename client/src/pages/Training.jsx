import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useCamera } from '../hooks/useCamera';
import { usePose } from '../hooks/usePose';
import { useSpeech } from '../hooks/useSpeech';
import { useObjectDetection, classifyDetectedObjects } from '../hooks/useObjectDetection';
import { useBallDetection } from '../hooks/useBallDetection';
import { useAICoach } from '../hooks/useAICoach';
import { useHaikuVision } from '../hooks/useHaikuVision';
import { useGhostSkeleton } from '../hooks/useGhostSkeleton';
import { getAnalyzer, getLocationProps, getWarmUpExercises, getDisabilityContext, getCalibrationAngles, checkOrientation, checkPerspective, checkMovementQuality, ORIENTATION } from '../utils/exerciseAnalysis';
import { LandmarkStabilizer, computeJointAngles, computeSymmetryScore, computeStabilityScore, detectMovementPhase, buildPerformanceReport, evaluateSetPerformance, getSportProfile, runSafetyCheck, generateCoachFeedback } from '../utils/motionEngine';

import { estimateCalories } from '../utils/calorieEstimator';
import ROMGauge from '../components/ROMGauge';
import WorkoutSummary from '../components/WorkoutSummary';
import { db } from '../services/firebase';
import { doc, getDoc, addDoc, updateDoc, collection, Timestamp } from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../utils/api';
import { markDayCompleted, sanitizePlan, saveActiveWorkout, loadActiveWorkout, clearActiveWorkout } from '../utils/workoutStorage';
import { incrementWeeklySession } from '../utils/weeklyGoals';
import { saveSessionAvg, checkLevelUpEligibility } from '../utils/sessionScoring';

const PHASE = {
  IDLE: 'idle',
  ENVIRONMENT_SCAN: 'environment_scan',
  BRIEFING: 'briefing',
  CHECKING_EQUIPMENT: 'checking_equipment',
  WARM_UP: 'warm_up',
  EXERCISING: 'exercising',
  RESTING: 'resting',
  EXERCISE_DONE: 'exercise_done',
  PAUSED: 'paused',
  CALIBRATING: 'calibrating',
};

const OPTIMIZATION_TIPS = {
  he: {
    squat: 'לרדת עמוק יותר ולהחזיק שנייה למטה',
    dip: 'להאט את הירידה ולהוסיף שנייה בתחתית',
    plank: 'להוסיף 10 שניות לזמן ההחזקה',
    push: 'להאט את הירידה ולשמור על גב ישר',
    lunge: 'לרדת עמוק יותר ולהחליף רגליים מהר יותר',
    shoulder: 'להאט את הירידה ולדחוף חזק למעלה',
    bicep: 'להאט את הירידה ולכווץ חזק למעלה',
    tricep: 'להאט את הירידה ולשמור מרפקים צמודים',
    row: 'לסחוט את הגב למעלה ולהחזיק שנייה',
    lateral: 'להחזיק שנייה למעלה ולרדת לאט',
    bridge: 'לסחוט את הישבן למעלה ולהחזיק שנייה',
    wallsit: 'להוסיף 10 שניות לזמן ההחזקה',
    mountain: 'להגביר את הקצב תוך שמירה על יציבות',
    crunch: 'להחזיק שנייה למעלה ולרדת לאט',
    sideplank: 'להוסיף 10 שניות לזמן ההחזקה',
    pullApart: 'להחזיק שנייה במתיחה המלאה',
    default: 'לנסות לבצע מהר יותר תוך שמירה על טכניקה',
  },
  en: {
    squat: 'go lower and hold for a second at the bottom',
    dip: 'slow down the descent and add a pause at the bottom',
    plank: 'add 10 more seconds to your hold time',
    push: 'slow down the descent and keep your back straight',
    lunge: 'go deeper and switch legs faster',
    shoulder: 'slow down the descent and push strong at the top',
    bicep: 'slow down the descent and squeeze hard at the top',
    tricep: 'slow down the descent and keep elbows tight',
    row: 'squeeze your back at the top and hold for a second',
    lateral: 'hold for a second at the top and lower slowly',
    bridge: 'squeeze your glutes at the top and hold for a second',
    wallsit: 'add 10 more seconds to your hold time',
    mountain: 'increase the pace while maintaining stability',
    crunch: 'hold for a second at the top and lower slowly',
    sideplank: 'add 10 more seconds to your hold time',
    pullApart: 'hold for a second at full stretch',
    default: 'move faster while maintaining technique',
  }
};

const LOCATION_ICONS = { home: '\uD83C\uDFE0', yard: '\uD83C\uDF33', field: '\u26BD', gym: '\uD83C\uDFCB\uFE0F' };

export default function Training() {
  const { t } = useTranslation();
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canvasRef = useRef(null);

  const lang = userProfile?.lang === 'en' ? 'en-US' : 'he-IL';
  const isHe = lang.startsWith('he');
  const playerName = userProfile?.name || '';
  const currentLocation = userProfile?.trainingLocation || userProfile?.currentLocation || 'field';
  const locationProps = getLocationProps(currentLocation, isHe, userProfile?.sport);

  const beforeDrawRef = useRef(null);
  const amputationProfile = useMemo(() => ({
    disability: userProfile?.disability || 'none',
    amputationSide: userProfile?.amputationSide || 'none',
    amputationLevel: userProfile?.amputationLevel || '',
  }), [userProfile?.disability, userProfile?.amputationSide, userProfile?.amputationLevel]);
  const { videoRef, active: cameraActive, error: cameraError, start: startCamera, stop: stopCamera } = useCamera();
  const { ready: poseReady, landmarks, startLoop, stopLoop } = usePose(canvasRef, beforeDrawRef, amputationProfile);
  const { drawGhost, toggle: toggleGhost, isEnabled: ghostEnabled } = useGhostSkeleton();
  const { ready: objReady, detectedObjects, startLoop: startObjLoop, stopLoop: stopObjLoop, hasEquipment, scanEnvironment, captureFrame } = useObjectDetection();
  const { ready: ballReady, getBallData, startLoop: startBallLoop, stopLoop: stopBallLoop } = useBallDetection(userProfile?.sport);

  // Equipment check state
  const [equipmentFound, setEquipmentFound] = useState(false);
  const [equipmentLabel, setEquipmentLabel] = useState('');
  const equipCheckTimerRef = useRef(null);
  const {
    speak, speakPriority, speakIfIdle, speakQueued, speakBriefing, speakEncouragement, speakCorrection,
    speakOptimization, speakRestTip, speakSetStart, speakCount,
    speakPostBriefingNudge, speakMidSetQuit, speakHeadUp,
    speakHowToStart, speakSitting, speakReadyWhenYouAre, speakActiveProd,
    speakQuickReExplain, speakEquipmentFound,
    speakWarmUpIntro, speakWarmUpExercise, speakWarmUpNudge, speakWarmUpInactivityNudge, speakWarmUpReExplain,
    speakWarmUpCorrection, speakWarmUpComplete,
    speakDisabilityTip, speakMindMuscleCue, speakAICoaching, speakEnvironmentScan,
    speakNotVisible, speakPositiveReinforcement,
    speakMissingBodyParts, speakSideCamera, speakResumeWelcome, speakCalibrationStart, speakCalibrationDone,
    speakLevelUpPrompt, speakCritical, unlockAudio,
    stop: stopSpeech, isSpeaking
  } = useSpeech(lang, userProfile?.age);

  // Strip player name from AI-generated text if it was spoken recently (60s cooldown)
  const nameSpokenRef = useRef(0);
  const NAME_COOLDOWN = 60000;
  const stripName = useCallback((text) => {
    const name = playerName;
    if (!name || !text) return text;
    const now = Date.now();
    if (now - nameSpokenRef.current < NAME_COOLDOWN) {
      // Remove name + optional comma/space from start or anywhere in text
      return text.replace(new RegExp(`^${name}[,،]?\\s*`, 'u'), '').replace(new RegExp(`\\s*${name}[,،]?`, 'gu'), '').trim();
    }
    nameSpokenRef.current = now;
    return text;
  }, [playerName]);

  // Ref to track current exercise for use in callbacks (avoids TDZ issues)
  const currentExerciseRef = useRef(null);

  // === COMMAND COACHING HELPERS ===
  // Get Hebrew command text for the next rep
  function getCommandText(repNum, cueKey, type) {
    if (type === 'hold') return null;
    if (['kick', 'amputeeKick'].includes(cueKey))                           return `בצע בעיטה ${repNum}`;
    if (['shooting', 'wheelchairShooting'].includes(cueKey))                 return `בצע זריקה ${repNum}`;
    if (['running', 'amputeeSprint', 'footwork'].includes(cueKey))           return `צא לסיבוב ${repNum}`;
    if (['dribbling', 'handDribble', 'wheelchairDribble'].includes(cueKey))  return `בצע כדרור ${repNum}`;
    return `רד לחזרה ${repNum}`;
  }

  // Poll until speech finishes, then call callback (safety: 10s max)
  function pollSpeechEnd(callback) {
    const poll = setInterval(() => {
      if (!isSpeaking()) {
        clearInterval(poll);
        callback();
      }
    }, 200);
    setTimeout(() => clearInterval(poll), 10000);
  }

  // Speak the initial command for a rep, then transition to WAITING_FOR_REP
  function speakCommandAndWait(repNum) {
    const cueKey = analyzerRef.current?.cueKey;
    const type = analyzerRef.current?.type;
    const text = getCommandText(repNum, cueKey, type);
    if (!text) return;
    commandPhaseRef.current = 'COMMANDING';
    speakPriority(text, { rate: 1.25 });
    pollSpeechEnd(() => {
      if (commandPhaseRef.current === 'COMMANDING') {
        commandPhaseRef.current = 'WAITING_FOR_REP';
      }
    });
  }

  // AI Coach hook — periodic Claude-powered feedback
  const onAICoaching = useCallback((text, isUrgent) => {
    speakAICoaching(stripName(text), userProfile?.age, isUrgent);
  }, [speakAICoaching, userProfile?.age, stripName]);

  const { startAICoaching, stopAICoaching, feedPoseData } = useAICoach({ onCoaching: onAICoaching });

  // Haiku Vision — per-rep visual form analysis
  // Confirmed rep TTS: "חזרה X. [feedback]. עכשיו רד לחזרה Y"
  // Partial rep TTS:   "החזרה לא נספרה. [feedback]. נסה שוב את חזרה X"
  const onVisionFeedback = useCallback((result) => {
    // Instant UI feedback: show "analyzing" spinner while server processes
    if (result._analyzing) {
      setAiAnalyzing(true);
      return;
    }
    setAiAnalyzing(false);

    const cmdPhase = commandPhaseRef.current;
    const curRep = commandRepRef.current;
    const aiFeedback = result.feedback ? stripName(result.feedback) : 'המשך ככה';
    const repConfirmed = result.repConfirmed === true;
    const repNumber = result.repNumber;
    console.log(`[CMD] onVisionFeedback: cmdPhase=${cmdPhase}, rep=${curRep}, repNumber=${repNumber}, confirmed=${repConfirmed}, score=${result.score}, fb="${aiFeedback}"`);

    // Track AI score for adaptive coaching (per-exercise averaging)
    if (result.score > 0) {
      repScoresRef.current.push(result.score);
    }

    // === AI-DRIVEN REP COUNTER: update displayReps immediately when AI confirms ===
    if (repConfirmed) {
      setDisplayReps(prev => {
        const newCount = Math.max(prev, repNumber);
        console.log(`[CMD] AI confirmed rep #${repNumber} → displayReps: ${prev} → ${newCount}`);
        return newCount;
      });
    }

    if (cmdPhase === 'IDLE') {
      // Hold exercises or no command coaching — short rep count + technical feedback only
      if (repConfirmed) {
        speakCritical(`${repNumber}. ${aiFeedback}`, { rate: 1.3 });
      } else {
        speakCritical(`${aiFeedback}. נסה שוב`, { rate: 1.3 });
      }
      return;
    }

    // Active command coaching — speakCritical to hard-cancel any nudges/commands
    clearTimeout(analyzeTimeoutRef.current);
    commandPhaseRef.current = 'SPEAKING_FEEDBACK';

    const targetReps = parseInt(currentExerciseRef.current?.reps) || 10;
    const cueKey = analyzerRef.current?.cueKey;
    const cueType = analyzerRef.current?.type;

    let fullSpeech;
    if (repConfirmed) {
      // Confirmed rep: short count + feedback + next command
      const nextRep = repNumber + 1;
      const isLastRep = nextRep > targetReps;
      const nextCmd = isLastRep ? '' : `. ${getCommandText(nextRep, cueKey, cueType) || `חזרה ${nextRep}`}`;
      fullSpeech = `${repNumber}. ${aiFeedback}${nextCmd}`;
    } else {
      // Partial rep: feedback + retry
      fullSpeech = `${aiFeedback}. נסה שוב`;
    }

    console.log(`[CMD] Speaking: "${fullSpeech}"`);
    speakCritical(fullSpeech, { rate: 1.25 });

    pollSpeechEnd(() => {
      if (repConfirmed) {
        const nextRep = repNumber + 1;
        if (nextRep > targetReps) {
          commandPhaseRef.current = 'IDLE';
          return;
        }
        commandRepRef.current = nextRep;
      }
      // Both confirmed and partial: go back to waiting for the (next or same) rep
      commandPhaseRef.current = 'WAITING_FOR_REP';
    });
  }, [speakCritical, stripName]);

  const { feedPhaseData, startVision, stopVision, resetSession: resetVisionSession, performWarmUpCalibration } = useHaikuVision({ onVisionFeedback });

  // Environment scan state
  const [environmentScan, setEnvironmentScan] = useState(null);
  const environmentScannedRef = useRef(false);

  // Workout adaptation
  const lastAdaptationRef = useRef(0);

  // Mobile detection
  const [isMobile] = useState(() => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // Fullscreen toggle
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Pause/Resume state snapshot
  const pausedStateRef = useRef(null);
  const pausedWarmUpRef = useRef(null); // for warm-up pause

  // Not-visible tracking
  const notVisibleWarnedRef = useRef(false);

  // Visibility feedback throttle
  const visibilityWarningTimeRef = useRef(0);

  // Perspective feedback throttle
  const perspectiveWarningTimeRef = useRef(0);

  // Calibration state
  const calibrationDataRef = useRef(null);
  const [calibrationCountdown, setCalibrationCountdown] = useState(5);

  const [exercises, setExercises] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const exerciseStateRef = useRef({});
  const [displayReps, setDisplayReps] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [timer, setTimer] = useState(0);
  const [activeTimer, setActiveTimer] = useState(0);
  const [workoutDone, setWorkoutDone] = useState(false);

  // Set management
  const [currentSet, setCurrentSet] = useState(1);
  const [totalSets, setTotalSets] = useState(3);
  const [restTime, setRestTime] = useState(0);
  const [restDuration, setRestDuration] = useState(60);
  const [setsPerformance, setSetsPerformance] = useState([]);

  // Warm-up state
  const [warmUpIdx, setWarmUpIdx] = useState(0);
  const [warmUpTimer, setWarmUpTimer] = useState(0);
  const [warmUpDone, setWarmUpDone] = useState(false);
  const warmUpStateRef = useRef({});
  const warmUpTimerRef = useRef(null);
  const lastWarmUpNudgeRef = useRef(0);
  const lastWarmUpCorrectionRef = useRef(0);

  // Adaptive warm-up list based on profile limitations
  const warmUpExercises = useMemo(() => getWarmUpExercises(userProfile), [userProfile]);
  const disabilityCtx = useMemo(() => getDisabilityContext(userProfile), [userProfile]);

  // Warm-up pause state
  const warmUpPausedRef = useRef(false);
  const [warmUpPaused, setWarmUpPaused] = useState(false);
  const warmUpReExplainedRef = useRef(false);
  const warmUpInactivityStartRef = useRef(0);

  // Per-rep AI score tracking for adaptive coaching
  const repScoresRef = useRef([]);

  // Feedback tracking
  const lastSpokenRef = useRef('');
  const timerRef = useRef(null);
  const analyzerRef = useRef(null);
  const badFormCountRef = useRef(0);
  const goodFormCountRef = useRef(0);
  const lastEncouragementRef = useRef(0);
  const formStoppedRef = useRef(false);

  // Inactivity tracking
  const lastActivityRef = useRef(Date.now());
  const exerciseStartTimeRef = useRef(null);

  // Nudge state machine: tracks what we've already said to avoid noise
  const lastNudgeTimeRef = useRef(0);
  const lastCoachingTimeRef = useRef(0);
  const sittingWarnedRef = useRef(false);

  // Head-down tracking
  const headDownCountRef = useRef(0);
  const lastHeadUpWarningRef = useRef(0);

  // Active prodding rotation index
  const prodIndexRef = useRef(0);

  // Mind-muscle cue timing
  const lastMindMuscleCueRef = useRef(0);

  // Kalman Filter landmark stabilizer
  const stabilizerRef = useRef(new LandmarkStabilizer());
  const prevLandmarksRef = useRef(null);       // Previous frame landmarks for movement gate
  const movementSufficientRef = useRef(false); // Movement >= 15% body height (gates server calls)
  const anglesHistoryRef = useRef([]);
  const romGaugeRef = useRef(null);
  const prevAnglesRef = useRef(null);
  const performanceReportRef = useRef(null);
  const frameCountRef = useRef(0);
  const coachFeedbackRef = useRef(null);

  // Level-Up tracking for longevity (51+) athletes
  const levelUpSetsRef = useRef(0);
  const levelUpPromptShownRef = useRef(false);
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);

  // Command coaching state machine (IDLE | COMMANDING | WAITING_FOR_REP | ANALYZING | SPEAKING_FEEDBACK)
  const commandPhaseRef = useRef('IDLE');
  const commandRepRef = useRef(1);
  const analyzeTimeoutRef = useRef(null);

  // Session tracking for stats
  const sessionDataRef = useRef({
    exerciseResults: [],
    startTime: null,
    warmUpCompleted: false,
  });
  const sessionSavedRef = useRef(false);

  // Load exercises
  useEffect(() => {
    async function load() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (!profileDoc.exists()) return;
      const data = profileDoc.data();
      const plan = data.trainingPlan;
      if (!plan?.weeks) return;

      const weekIdx = parseInt(searchParams.get('week') || '0');
      const dayIdx = parseInt(searchParams.get('day') || '0');
      const week = plan.weeks[weekIdx];
      if (!week?.days?.[dayIdx]) return;

      // Sanitize exercises in-place before displaying (last-mile defense)
      const sport = data.sport || plan.sport || 'fitness';
      const sanitized = sanitizePlan({ weeks: [{ days: [{ exercises: week.days[dayIdx].exercises || [] }] }] }, sport, data.age || userProfile?.age);
      const loadedExercises = sanitized.weeks[0].days[0].exercises || [];
      setExercises(loadedExercises);
      resetVisionSession();

      // Resume detection
      if (searchParams.get('resume') === 'true') {
        const saved = loadActiveWorkout();
        if (saved && saved.week === weekIdx && saved.day === dayIdx) {
          // Restore state
          setCurrentIdx(Math.min(saved.exerciseIndex || 0, loadedExercises.length - 1));
          setCurrentSet(saved.currentSet || 1);
          setDisplayReps(saved.displayReps || 0);
          setTimer(saved.timer || 0);
          if (saved.exerciseResults) {
            sessionDataRef.current.exerciseResults = saved.exerciseResults;
          }
          if (saved.warmUpCompleted) {
            sessionDataRef.current.warmUpCompleted = true;
            setWarmUpDone(true);
          }
          if (saved.startTime) {
            sessionDataRef.current.startTime = saved.startTime;
          }
          clearActiveWorkout();
          // Welcome back speech will be triggered after camera starts
          setTimeout(() => speakResumeWelcome(playerName), 2000);
        }
      }
    }
    load();
  }, [user, searchParams]);

  // Save active workout on page unload (browser close / navigate away)
  useEffect(() => {
    function handleBeforeUnload() {
      if (phase === PHASE.EXERCISING || phase === PHASE.RESTING || phase === PHASE.WARM_UP) {
        saveActiveWorkout({
          week: parseInt(searchParams.get('week') || '0'),
          day: parseInt(searchParams.get('day') || '0'),
          exerciseIndex: currentIdx,
          currentSet,
          displayReps,
          timer,
          exerciseResults: sessionDataRef.current.exerciseResults,
          warmUpCompleted: sessionDataRef.current.warmUpCompleted,
          startTime: sessionDataRef.current.startTime,
        });
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [phase, currentIdx, currentSet, displayReps, timer, searchParams]);

  const currentExercise = exercises[currentIdx];
  currentExerciseRef.current = currentExercise;

  // Set up analyzer when exercise changes
  useEffect(() => {
    if (currentExercise) {
      const { analyze, type, cueKey, ballAware } = getAnalyzer(currentExercise.name);
      analyzerRef.current = { analyze, type, cueKey, ballAware };
      exerciseStateRef.current = { _userProfile: userProfile };
      setDisplayReps(0);
      setFeedback(null);
      setCurrentSet(1);
      setTotalSets(parseInt(currentExercise.sets) || 3);
      setRestDuration(parseInt(currentExercise.restSeconds) || 60);
      setSetsPerformance([]);
      setActiveTimer(0);
      badFormCountRef.current = 0;
      goodFormCountRef.current = 0;
      formStoppedRef.current = false;
      headDownCountRef.current = 0;
      lastMindMuscleCueRef.current = 0;
    }
  }, [currentIdx, currentExercise]);

  // Ghost skeleton: set beforeDrawRef during EXERCISING phase
  useEffect(() => {
    if (phase === PHASE.EXERCISING && ghostEnabled && analyzerRef.current) {
      const cueKey = analyzerRef.current.cueKey;
      const sportKey = userProfile?.sport || 'fitness';
      beforeDrawRef.current = (ctx, lm, w, h) => {
        drawGhost(ctx, sportKey, cueKey, lm, w, h);
      };
    } else {
      beforeDrawRef.current = null;
    }
  }, [phase, ghostEnabled, drawGhost, userProfile?.sport]);

  // === CALIBRATION PHASE — 5-second ROM measurement ===
  const calibrationIntervalRef = useRef(null);

  useEffect(() => {
    if (phase !== PHASE.CALIBRATING) {
      // Clean up interval if phase changes away
      if (calibrationIntervalRef.current) {
        clearInterval(calibrationIntervalRef.current);
        calibrationIntervalRef.current = null;
      }
      return;
    }

    // Initialize calibration data
    calibrationDataRef.current = {
      startTime: Date.now(),
      minAngles: {},
      maxAngles: {},
      frames: 0,
    };
    setCalibrationCountdown(5);
    speakCalibrationStart(playerName);

    // Countdown timer — updates every second, transitions to EXERCISING after 5s
    calibrationIntervalRef.current = setInterval(() => {
      const cal = calibrationDataRef.current;
      if (!cal) return;
      const elapsed = (Date.now() - cal.startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(5 - elapsed));
      setCalibrationCountdown(remaining);

      if (elapsed >= 5) {
        clearInterval(calibrationIntervalRef.current);
        calibrationIntervalRef.current = null;

        // Build baseline from collected angles
        const baseline = {};
        for (const joint of Object.keys(cal.maxAngles)) {
          baseline[joint] = {
            min: cal.minAngles[joint],
            max: cal.maxAngles[joint],
            range: cal.maxAngles[joint] - cal.minAngles[joint],
          };
        }
        if (Object.keys(baseline).length > 0) {
          // Store shoulder/head height averages for orientation verification
          if (baseline._shoulderY) {
            baseline._calShoulderY = (baseline._shoulderY.min + baseline._shoulderY.max) / 2;
          }
          if (baseline._headY) {
            baseline._calHeadY = (baseline._headY.min + baseline._headY.max) / 2;
          }
          exerciseStateRef.current._calibration = baseline;
        }

        speakCalibrationDone(playerName);
        calibrationDataRef.current = null;
        setPhase(PHASE.EXERCISING);
        setTimer(0);
        lastActivityRef.current = Date.now();
        exerciseStartTimeRef.current = Date.now();
        lastNudgeTimeRef.current = 0;
        speakSetStart(currentSet, totalSets);

        // Start command coaching for rep-based exercises
        if (analyzerRef.current?.type !== 'hold') {
          commandPhaseRef.current = 'COMMANDING';
          commandRepRef.current = 1;
          setTimeout(() => speakCommandAndWait(1), 1500);
        }
      }
    }, 1000);

    return () => {
      if (calibrationIntervalRef.current) {
        clearInterval(calibrationIntervalRef.current);
        calibrationIntervalRef.current = null;
      }
    };
  }, [phase]);

  // Collect angle data from landmarks during calibration (runs at ~60fps)
  useEffect(() => {
    if (phase !== PHASE.CALIBRATING || !landmarks || !calibrationDataRef.current) return;
    // Use stabilized landmarks for calibration too
    const stableLm = stabilizerRef.current.stabilize(landmarks);
    if (!stableLm) return;
    const cal = calibrationDataRef.current;
    // Fire server warm-up on first skeleton detection during calibration
    if (cal.frames === 0) {
      performWarmUpCalibration(captureFrame, videoRef.current);
    }
    cal.frames++;
    const cueKey = analyzerRef.current?.cueKey;
    const anglesToTrack = getCalibrationAngles(stableLm, cueKey);
    for (const [joint, value] of Object.entries(anglesToTrack)) {
      cal.minAngles[joint] = Math.min(cal.minAngles[joint] ?? 999, value);
      cal.maxAngles[joint] = Math.max(cal.maxAngles[joint] ?? 0, value);
    }
  }, [phase, landmarks]);

  // Core pose analysis - with posture gating (uses ref to avoid render loops)
  useEffect(() => {
    if (phase !== PHASE.EXERCISING || !landmarks || !analyzerRef.current) return;

    // === KALMAN FILTER STABILIZATION ===
    // Smooth raw MediaPipe landmarks before any analysis
    const stableLandmarks = stabilizerRef.current.stabilize(landmarks);
    if (!stableLandmarks) return;

    // === CONFIDENCE + MOVEMENT GATE ===
    // Skip all analysis/speech/server calls unless pose is trustworthy and athlete is moving
    const keyIndices = [11, 12, 13, 14, 23, 24, 25, 26]; // shoulders, elbows, hips, knees
    const avgConfidence = keyIndices.reduce((sum, i) => sum + (stableLandmarks[i]?.visibility || 0), 0) / keyIndices.length;
    if (avgConfidence < 0.5) return; // Pose not reliable enough

    // Body height = shoulder midpoint Y to ankle midpoint Y (normalized coords)
    const shoulderY = ((stableLandmarks[11]?.y || 0) + (stableLandmarks[12]?.y || 0)) / 2;
    const ankleY = ((stableLandmarks[27]?.y || 0) + (stableLandmarks[28]?.y || 0)) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY) || 0.001;

    // Movement magnitude: max displacement of key joints from previous frame
    const prevLm = prevLandmarksRef.current;
    if (prevLm) {
      const maxDisplacement = keyIndices.reduce((max, i) => {
        const dx = (stableLandmarks[i]?.x || 0) - (prevLm[i]?.x || 0);
        const dy = (stableLandmarks[i]?.y || 0) - (prevLm[i]?.y || 0);
        return Math.max(max, Math.sqrt(dx * dx + dy * dy));
      }, 0);
      const movementPct = maxDisplacement / bodyHeight;

      // Skeleton jump filter: if body center moved > 30% body height in one frame,
      // it's likely a different person crossing — reject this frame entirely
      if (movementPct > 0.30) {
        prevLandmarksRef.current = stableLandmarks;
        return; // Skeleton jumped — ignore (probably someone walked past)
      }

      // Truly static — skip everything
      if (movementPct < 0.001) {
        prevLandmarksRef.current = stableLandmarks;
        return;
      }
      // Store movement flag for vision hook gating
      movementSufficientRef.current = movementPct >= 0.10;
    }
    prevLandmarksRef.current = stableLandmarks;

    const { analyze, ballAware, orientation } = analyzerRef.current;
    const prevState = exerciseStateRef.current;
    // Pass ball data to ball-aware sport drill analyzers
    const ballData = ballAware ? getBallData() : null;
    const newState = analyze(stableLandmarks, prevState, ballData);
    const posture = newState.posture;
    const isMoving = newState.moving;
    const firstRepStarted = newState.firstRepStarted || false;

    // === DEBUG: Log phase transitions ===
    if (newState.phase !== prevState.phase) {
      console.log(`[PHASE] ${prevState.phase || 'none'} → ${newState.phase} | reps=${newState.reps} | elbow=${newState.elbowAngle || newState.kneeAngle || '?'}° | moving=${isMoving} | confidence=${avgConfidence.toFixed(2)}`);
    }

    // === BIOMECHANICS: Compute joint angles + performance report ===
    frameCountRef.current++;
    if (frameCountRef.current % 3 === 0) { // Every 3rd frame (~20fps) for efficiency
      const angles = computeJointAngles(stableLandmarks);
      anglesHistoryRef.current.push(angles);
      if (anglesHistoryRef.current.length > 30) anglesHistoryRef.current.shift();

      // === ROM GAUGE: Update every 3rd frame ===
      const primaryAngle = newState.kneeAngle ?? newState.elbowAngle ?? null;
      const phaseStart = newState._phaseStartAngle;
      if (primaryAngle != null && phaseStart != null && romGaugeRef.current) {
        const delta = Math.abs(primaryAngle - phaseStart);
        const range = newState._calibration?.range || 90;
        const romPct = Math.min(delta / range, 1.0);
        romGaugeRef.current.updateGauge(romPct);
      }

      // Build performance report every ~1 second (every 20th computed frame)
      if (frameCountRef.current % 60 === 0) {
        const primaryJoint = analyzerRef.current?.cueKey === 'squat' || analyzerRef.current?.cueKey === 'lunge' ? 'leftKnee' : 'leftElbow';
        performanceReportRef.current = buildPerformanceReport(
          angles,
          detectMovementPhase(angles, prevAnglesRef.current, primaryJoint),
          computeStabilityScore(anglesHistoryRef.current),
          computeSymmetryScore(angles),
          { reps: newState.reps, romPct: newState._romPct, formIssues: newState._formIssues }
        );
      }
      prevAnglesRef.current = angles;

      // === SPORT PROFILE COACH FEEDBACK (every ~10s) ===
      if (frameCountRef.current % 600 === 0 && performanceReportRef.current) {
        const sportProfile = getSportProfile(userProfile?.sport);
        const safetyResult = runSafetyCheck(detectedObjects || [], sportProfile, stableLandmarks);
        const coachRequest = generateCoachFeedback(
          performanceReportRef.current,
          { ...sportProfile, calibration: exerciseStateRef.current._calibration, cueKey: analyzerRef.current?.cueKey },
          safetyResult
        );
        if (coachRequest?.shouldSend) {
          coachFeedbackRef.current = coachRequest;
        }
      }
    }

    // === VISIBILITY FEEDBACK (from analyzer validateLandmarks) ===
    // Muted during ANALYZING — don't interrupt AI coaching feedback
    if (newState.feedback?.type === 'visibility') {
      const now = Date.now();
      const isAnalyzing = commandPhaseRef.current === 'ANALYZING' || commandPhaseRef.current === 'SPEAKING_FEEDBACK';
      if (!isAnalyzing && now - visibilityWarningTimeRef.current > 10000) {
        speakMissingBodyParts(newState.feedback.missingParts, playerName, newState.feedback.direction);
        visibilityWarningTimeRef.current = now;
        setFeedback({
          type: 'info',
          text: isHe ? 'תכוון את המצלמה כדי שאוכל לראות אותך' : 'Adjust camera so I can see you'
        });
      }
      exerciseStateRef.current = newState;
      return; // Don't give wrong technique feedback
    }

    // === POSTURE GATE ===
    // Not visible — gentle guidance (blame yourself, not user)
    // Muted during ANALYZING — don't interrupt AI coaching feedback
    if (posture === 'unknown') {
      const now = Date.now();
      const isAnalyzing = commandPhaseRef.current === 'ANALYZING' || commandPhaseRef.current === 'SPEAKING_FEEDBACK';
      if (!isAnalyzing && (!notVisibleWarnedRef.current || now - lastNudgeTimeRef.current > 8000)) {
        notVisibleWarnedRef.current = true;
        lastNudgeTimeRef.current = now;
        speakNotVisible(playerName);
        setFeedback({
          type: 'info',
          text: isHe
            ? `${playerName}, אני לא רואה אותך טוב. תתקרב למצלמה.`
            : `${playerName}, I can't see you well. Move closer to the camera.`
        });
      }
      exerciseStateRef.current = newState;
      return;
    }

    // === ORIENTATION GATE — exercise-specific body position verification ===
    const orientCheck = checkOrientation(landmarks, orientation, prevState);
    if (!orientCheck.valid) {
      const now = Date.now();
      if (now - lastNudgeTimeRef.current > 4000) {
        lastNudgeTimeRef.current = now;
        const msg = isHe ? orientCheck.feedback.text : orientCheck.feedback.textEn;
        speakPriority(msg, { rate: 1.3, pitch: 1.05 });
        setFeedback({ type: 'warning', text: msg });
      }
      // Block rep counting — keep previous reps, don't update count
      exerciseStateRef.current = { ...newState, reps: prevState.reps || 0, lastRepTime: prevState.lastRepTime };
      return;
    }

    // Orientation valid — clear warnings and proceed
    sittingWarnedRef.current = false;
    notVisibleWarnedRef.current = false;

    // === PERSPECTIVE GATE — suggest side camera for lying exercises (non-blocking) ===
    // Muted during ANALYZING — don't interrupt AI coaching feedback
    const perspCheck = checkPerspective(landmarks, orientation);
    if (!perspCheck.valid) {
      const now = Date.now();
      const isAnalyzing = commandPhaseRef.current === 'ANALYZING' || commandPhaseRef.current === 'SPEAKING_FEEDBACK';
      if (!isAnalyzing && now - perspectiveWarningTimeRef.current > 15000) {
        perspectiveWarningTimeRef.current = now;
        speakSideCamera();
      }
    }

    // Update activity timestamp when movement or new rep detected
    if (isMoving || (newState.lastRepTime && newState.lastRepTime !== prevState.lastRepTime)) {
      lastActivityRef.current = Date.now();
      lastNudgeTimeRef.current = 0;
    }

    // === HEAD-DOWN: Only for ball sports (football, basketball, tennis) — NOT fitness ===
    const isBallSport = analyzerRef.current?.ballAware || ['football', 'footballAmputee', 'basketball', 'tennis'].includes(userProfile?.sport);
    if (isBallSport && firstRepStarted && newState.headDown) {
      headDownCountRef.current++;
      const now = Date.now();
      if (headDownCountRef.current >= 5 && now - lastHeadUpWarningRef.current > 10000) {
        speakHeadUp();
        lastHeadUpWarningRef.current = now;
        headDownCountRef.current = 0;
        setFeedback({
          type: 'warning',
          text: isHe ? 'ראש למעלה! תסתכל על המגרש!' : 'Eyes up! Look at the field!'
        });
      }
    } else {
      headDownCountRef.current = 0;
    }

    // === MOVEMENT QUALITY CHECK (calibration-aware ROM) ===
    // If a rep was just counted, check if ROM was deep enough relative to calibration
    if (newState.feedback?.type === 'count' && prevState._calibration && newState._phaseStartAngle != null) {
      const joint = analyzerRef.current?.cueKey === 'squat' || analyzerRef.current?.cueKey === 'lunge' ? 'knee'
        : analyzerRef.current?.cueKey === 'shoulder' ? 'shoulder' : 'elbow';
      const currentAngle = newState.elbowAngle || newState.kneeAngle || 0;
      const quality = checkMovementQuality(prevState, joint, currentAngle, newState._phaseStartAngle);
      if (quality.feedback) {
        const now = Date.now();
        if (now - lastNudgeTimeRef.current > 6000) {
          lastNudgeTimeRef.current = now;
          const msg = isHe ? quality.feedback.text : quality.feedback.textEn;
          speakPriority(msg, { rate: 1.3, pitch: 1.05 });
          setFeedback({ type: 'warning', text: msg });
        }
      }
    }

    // === TECHNIQUE FEEDBACK: Only if firstRepStarted ===
    // Track whether a NEW rep just happened in this frame
    const isNewRep = newState.feedback?.type === 'count' && newState.reps > (prevState.reps || 0);

    if (newState.feedback && firstRepStarted) {
      const fb = newState.feedback;

      // Good/warning form tracking — only accumulate counters, don't speak yet
      if (fb.type === 'good' && isMoving) {
        goodFormCountRef.current++;
      } else if (fb.type === 'warning' && isMoving) {
        badFormCountRef.current++;
      } else if (fb.type !== 'good' && fb.type !== 'warning') {
        badFormCountRef.current = 0;
      }

      // === SPEECH: Only trigger encouragement/correction AFTER a confirmed new rep ===
      if (isNewRep) {
        // Encouragement: speak after rep if form was mostly good
        if (goodFormCountRef.current >= 5) {
          const now = Date.now();
          const isAnalyzing = commandPhaseRef.current === 'ANALYZING' || commandPhaseRef.current === 'SPEAKING_FEEDBACK';
          if (!isAnalyzing && now - lastEncouragementRef.current > 8000) {
            speakPositiveReinforcement(playerName);
            lastEncouragementRef.current = now;
          }
        }
        // Correction: speak after rep if bad form accumulated
        if (badFormCountRef.current >= 5 && !formStoppedRef.current) {
          formStoppedRef.current = true;
          speakCorrection(currentExercise?.tips);
          setFeedback({ type: 'info', text: isHe ? 'כיוון טוב! בוא נשפר קצת.' : 'Good direction! Let\'s refine.' });
          setTimeout(() => {
            formStoppedRef.current = false;
            badFormCountRef.current = 0;
          }, 3000);
        }
        // Reset form counters after each rep
        goodFormCountRef.current = 0;
        badFormCountRef.current = 0;
      }

      // Suppress good/warning feedback when NOT moving
      if (!isMoving && (fb.type === 'good' || fb.type === 'warning')) {
        // Silence — don't speak or update UI for continuous form feedback
      } else if (fb.text !== lastSpokenRef.current) {
        // Show coaching text if available, otherwise show default text
        const coachingText = fb.coaching ? (isHe ? fb.coaching.he : fb.coaching.en) : null;
        setFeedback(coachingText ? { ...fb, text: coachingText } : fb);

        if (fb.type === 'count') {
          const cmdPhase = commandPhaseRef.current;
          const isHoldExercise = analyzerRef.current?.type === 'hold';
          console.log(`[CMD] Rep detected count=${fb.count}, cmdPhase=${cmdPhase}, isHold=${isHoldExercise}`);

          // Always update display immediately so user sees counter change
          setDisplayReps(fb.count);
          lastSpokenRef.current = fb.text;

          if (cmdPhase === 'IDLE' || isHoldExercise) {
            // Non-command mode: speak count only if not currently speaking server feedback
            if (!isSpeaking()) {
              speakCount(fb.count);
            }
            if (coachingText) {
              const now = Date.now();
              if (now - lastCoachingTimeRef.current > 10000) {
                lastCoachingTimeRef.current = now;
                // 150ms delay so user hears the count before technique instruction
                setTimeout(() => {
                  if (!isSpeaking()) speakIfIdle(coachingText, { rate: 1.2 });
                }, 150);
              }
            }
          } else if (cmdPhase === 'WAITING_FOR_REP') {
            // Command mode: rep accepted — sync ref, wait for server feedback
            // (onVisionFeedback will speak: [count] + [feedback] + [next command])
            console.log(`[CMD] Rep accepted, switching to ANALYZING for rep #${fb.count}`);
            commandRepRef.current = fb.count;
            commandPhaseRef.current = 'ANALYZING';

            // 5s fallback if server doesn't respond
            analyzeTimeoutRef.current = setTimeout(() => {
              if (commandPhaseRef.current !== 'ANALYZING') return;
              // Speak count + generic + next command as fallback
              const nextRep = fb.count + 1;
              const targetReps2 = parseInt(currentExercise?.reps) || 10;
              const fallbackCmd = nextRep <= targetReps2
                ? `. עכשיו ${getCommandText(nextRep, analyzerRef.current?.cueKey, analyzerRef.current?.type) || `רד לחזרה ${nextRep}`}`
                : '';
              speakPriority(`חזרה ${fb.count}. המשך ככה${fallbackCmd}`, { rate: 1.25 });
              if (nextRep <= targetReps2) {
                commandRepRef.current = nextRep;
                commandPhaseRef.current = 'COMMANDING';
                pollSpeechEnd(() => {
                  if (commandPhaseRef.current === 'COMMANDING') {
                    commandPhaseRef.current = 'WAITING_FOR_REP';
                  }
                });
              } else {
                commandPhaseRef.current = 'IDLE';
              }
            }, 5000);
          } else {
            // COMMANDING / ANALYZING / SPEAKING_FEEDBACK — display only, don't interrupt
            console.log(`[CMD] Rep counted (display only) — cmdPhase=${cmdPhase}`);
          }

          const targetReps = parseInt(currentExercise?.reps) || 10;
          if (fb.count >= targetReps) {
            exerciseStateRef.current = newState;
            handleSetComplete();
            return;
          }
        } else if (fb.type === 'warning' && coachingText && isNewRep && !isSpeaking()) {
          // For warnings, speak coaching text ONLY on new rep and not during server feedback
          speakPriority(coachingText, { rate: 1.2, pitch: 1.05 });
          lastSpokenRef.current = fb.text;
        }
        // Removed: generic speakIfIdle for non-count feedback — was causing loops
      }
    }

    // Mind-muscle cue: every 20s during good-form movement (was 15s, increased to reduce noise)
    if (firstRepStarted && isMoving && newState.feedback?.type !== 'warning') {
      const now = Date.now();
      if (now - lastMindMuscleCueRef.current > 20000) {
        lastMindMuscleCueRef.current = now;
        speakMindMuscleCue(analyzerRef.current?.cueKey || 'default', newState.phase || 'up', playerName);
      }
    }

    // === PARTIAL REP DETECTION ===
    // If phase went down→up but no rep was counted, the movement was too shallow.
    // The early-send in useHaikuVision already sent frames to the server — the server
    // will respond via onVisionFeedback with repConfirmed=false, which speaks:
    // "החזרה לא נספרה. [server feedback]. נסה שוב את חזרה X"
    // As a fast local fallback (in case server is slow), show a UI warning:
    if (firstRepStarted && prevState.phase === 'down' && newState.phase === 'up' && newState.reps === prevState.reps) {
      const now = Date.now();
      if (now - lastNudgeTimeRef.current > 4000) {
        lastNudgeTimeRef.current = now;
        setFeedback({ type: 'warning', text: 'תנועה קטנה מדי — רד נמוך יותר' });
        console.log('[CMD] Partial rep detected — waiting for server feedback');
      }
    }

    // Feed data to AI coach accumulator (O(1), no re-renders)
    feedPoseData({
      moving: isMoving,
      headDown: newState.headDown,
      feedback: newState.feedback,
      formIssues: newState._formIssues,
      jointAngles: prevAnglesRef.current,
      ballDetected: ballData?.detected,
    });

    exerciseStateRef.current = newState;
    // Always feed phase data — the hook handles its own gating
    const repAngles = computeJointAngles(stableLandmarks);
    feedPhaseData(newState, repAngles, stableLandmarks);
  }, [landmarks, phase]);

  // === INACTIVITY NUDGES: AGGRESSIVE & FAST ===
  // Nudge cooldown ref for re-explain (only once per exercise start)
  const reExplainedRef = useRef(false);

  useEffect(() => {
    if (phase !== PHASE.EXERCISING) return;
    reExplainedRef.current = false;

    const inactivityCheck = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastActivityRef.current) / 1000;
      const state = exerciseStateRef.current;
      const currentReps = state.reps || 0;
      const firstRepStarted = state.firstRepStarted || false;
      const posture = state.posture;
      const timeSinceLastNudge = (now - lastNudgeTimeRef.current) / 1000;

      // User is sitting or unknown → handled in pose loop, skip here
      if (posture === 'sitting' || posture === 'unknown') return;

      // === PRIORITY 1: Mid-set encouragement - started reps but paused 8s+ ===
      if (currentReps > 0 && elapsed >= 8 && timeSinceLastNudge >= 8) {
        const targetReps = parseInt(currentExercise?.reps) || 10;
        const repsRemaining = targetReps - currentReps;
        if (repsRemaining > 0) {
          lastNudgeTimeRef.current = now;
          speakMidSetQuit(playerName, repsRemaining);
          setFeedback({
            type: 'info',
            text: isHe
              ? `אתה עושה מעולה! רק עוד ${repsRemaining} חזרות!`
              : `You're doing great! Just ${repsRemaining} more reps!`
          });
          return;
        }
      }

      // === Already started reps but idle ===
      if (firstRepStarted) {
        if (elapsed >= 10 && timeSinceLastNudge >= 10) {
          lastNudgeTimeRef.current = now;
          const prodText = speakActiveProd(playerName, prodIndexRef.current, locationProps, currentExercise?.description);
          prodIndexRef.current++;
          setFeedback({ type: 'info', text: prodText });
        }
        return;
      }

      // === PRIORITY 2: Quick re-explain at 25s (once) ===
      if (elapsed >= 25 && !reExplainedRef.current) {
        reExplainedRef.current = true;
        lastNudgeTimeRef.current = now;
        prodIndexRef.current = 0;
        speakQuickReExplain(playerName, currentExercise?.name, currentExercise?.description, locationProps);
        setFeedback({
          type: 'info',
          text: isHe
            ? `${playerName}, בוא נסביר שוב מה לעשות...`
            : `${playerName}, let me explain what to do...`
        });
        return;
      }

      // === PRIORITY 3: First nudge at 8s (silence before), then every 10s ===
      const nudgeCooldown = lastNudgeTimeRef.current === 0 ? 8 : 10;
      if (elapsed >= 8 && timeSinceLastNudge >= nudgeCooldown) {
        lastNudgeTimeRef.current = now;
        const prodText = speakActiveProd(playerName, prodIndexRef.current, locationProps, currentExercise?.description);
        prodIndexRef.current++;
        setFeedback({ type: 'info', text: prodText });
      }
    }, 1000);

    return () => clearInterval(inactivityCheck);
  }, [phase, currentExercise, isHe, playerName, locationProps, speakActiveProd, speakQuickReExplain]);

  // Exercise timer + active timer (movement-locked)
  useEffect(() => {
    if (phase === PHASE.EXERCISING) {
      timerRef.current = setInterval(() => {
        setTimer(prev => prev + 1);
        // Active timer: only increment when moving with good form
        const state = exerciseStateRef.current;
        if (state.moving && state.firstRepStarted) {
          setActiveTimer(prev => prev + 1);
        }
      }, 1000);
    } else if (phase === PHASE.RESTING) {
      timerRef.current = setInterval(() => {
        setRestTime(prev => {
          if (prev <= 1) { clearInterval(timerRef.current); startNextSet(); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  // Ball detection + AI coaching lifecycle
  useEffect(() => {
    if (phase === PHASE.EXERCISING) {
      // Start ball detection for ball-aware sport drills
      if (analyzerRef.current?.ballAware && ballReady && videoRef.current) {
        startBallLoop(videoRef.current);
      }
      // Start AI coaching
      const targetReps = parseInt(currentExercise?.reps) || 10;
      startAICoaching({
        exerciseName: currentExercise?.name || '',
        sport: userProfile?.sport || 'fitness',
        targetReps,
        targetSets: totalSets,
        currentSet,
        age: userProfile?.age || 25,
        disability: userProfile?.disability || 'none',
        playerName,
        skillLevel: userProfile?.skillLevel || 'intermediate',
      });
      // Start Haiku Vision per-rep analysis (pass calibration baseline for relative thresholding)
      startVision({
        sport: userProfile?.sport,
        exerciseName: currentExercise?.name,
        playerProfile: userProfile,
        playerName
      }, captureFrame, videoRef.current, exerciseStateRef.current?._calibration || null);
    } else {
      stopBallLoop();
      stopAICoaching();
      stopVision();
    }
    return () => { stopBallLoop(); stopAICoaching(); stopVision(); };
  }, [phase]);

  // Environment scan effect
  useEffect(() => {
    if (phase !== PHASE.ENVIRONMENT_SCAN) return;

    let cancelled = false;
    let autoAdvanceTimer;

    async function runScan() {
      if (!videoRef.current || !objReady) {
        // Skip scan if camera/detector not ready
        setPhase(PHASE.BRIEFING);
        speakBriefing(currentExercise?.name, currentExercise?.voicePrompt || currentExercise?.description, currentExercise?.tips, locationProps, playerName);
        return;
      }

      // Collect detections for 3 seconds
      const allDetections = [];
      const scanStart = Date.now();

      const collectLoop = setInterval(() => {
        if (cancelled) { clearInterval(collectLoop); return; }
        const objects = scanEnvironment(videoRef.current);
        allDetections.push(...objects);

        if (Date.now() - scanStart > 3000) {
          clearInterval(collectLoop);
          processResults();
        }
      }, 200);

      async function processResults() {
        if (cancelled) return;

        // Deduplicate by label (keep highest confidence)
        const seen = new Map();
        for (const obj of allDetections) {
          if (!seen.has(obj.label) || seen.get(obj.label).score < obj.score) {
            seen.set(obj.label, obj);
          }
        }
        const uniqueObjects = [...seen.values()];

        // Capture camera frame for Claude Vision
        const frame = captureFrame(videoRef.current);

        // Send to server for Claude Vision analysis
        try {
          const resp = await fetch(apiUrl('/api/coach/analyze-environment'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frame,
              cocoDetections: uniqueObjects,
              profile: { name: userProfile?.name, age: userProfile?.age, disability: userProfile?.disability, mobilityAid: userProfile?.mobilityAid, sport: userProfile?.sport },
              location: currentLocation,
            }),
          });
          if (resp.ok && !cancelled) {
            const analysis = await resp.json();
            setEnvironmentScan(analysis);
            speakEnvironmentScan(analysis);
          }
        } catch (err) {
          console.warn('[EnvScan] Failed:', err.message);
        }

        // Run sport-profile safety check on scan results
        const sportProfile = getSportProfile(userProfile?.sport);
        const safetyResult = runSafetyCheck(uniqueObjects, sportProfile, landmarks);
        if (!safetyResult.safe) {
          for (const issue of safetyResult.issues) {
            speakPriority(isHe ? issue.message_he : issue.message_en);
          }
        }

        environmentScannedRef.current = true;

        // Auto-advance to briefing after 4s
        if (!cancelled) {
          autoAdvanceTimer = setTimeout(() => {
            if (!cancelled) {
              setPhase(PHASE.BRIEFING);
              speakBriefing(currentExercise?.name, currentExercise?.voicePrompt || currentExercise?.description, currentExercise?.tips, locationProps, playerName);
            }
          }, 4000);
        }
      }
    }

    runScan();
    return () => { cancelled = true; clearTimeout(autoAdvanceTimer); };
  }, [phase]);

  // Equipment detection during CHECKING_EQUIPMENT phase
  useEffect(() => {
    if (phase !== PHASE.CHECKING_EQUIPMENT) return;

    // Start object detection loop
    if (videoRef.current && objReady) {
      startObjLoop(videoRef.current);
    }

    // Auto-proceed after 5 seconds regardless
    equipCheckTimerRef.current = setTimeout(() => {
      if (!equipmentFound) {
        if (!warmUpDone && currentIdx === 0) {
          // First exercise: do warm-up first
          setWarmUpIdx(0);
          speakWarmUpIntro(playerName);
          setPhase(PHASE.WARM_UP);
        } else {
          calibrationDataRef.current = null;
          setPhase(PHASE.CALIBRATING);
        }
      }
    }, 5000);

    return () => {
      stopObjLoop();
      clearTimeout(equipCheckTimerRef.current);
    };
  }, [phase, objReady]);

  // Watch for equipment detection results
  useEffect(() => {
    if (phase !== PHASE.CHECKING_EQUIPMENT || equipmentFound) return;
    if (detectedObjects.length > 0) {
      const obj = detectedObjects[0];
      const labelMap = { chair: isHe ? 'כיסא' : 'chair', bottle: isHe ? 'בקבוק' : 'bottle', cup: isHe ? 'כוס' : 'cup', 'sports ball': isHe ? 'כדור' : 'ball' };
      const localLabel = labelMap[obj.label] || obj.label;
      setEquipmentFound(true);
      setEquipmentLabel(localLabel);
      speakEquipmentFound(localLabel);
      stopObjLoop();
      clearTimeout(equipCheckTimerRef.current);

      // Auto-proceed after 2s to let user see the result
      setTimeout(() => {
        if (!warmUpDone && currentIdx === 0) {
          setWarmUpIdx(0);
          speakWarmUpIntro(playerName);
          setPhase(PHASE.WARM_UP);
        } else {
          calibrationDataRef.current = null;
          setPhase(PHASE.CALIBRATING);
        }
      }, 2000);
    }
  }, [detectedObjects, phase, equipmentFound]);

  // === WARM-UP PHASE LOGIC ===
  const currentWarmUp = warmUpExercises[warmUpIdx];

  // Warm-up countdown timer — movement-locked, with aggressive vocal coaching
  useEffect(() => {
    if (phase !== PHASE.WARM_UP) return;

    setWarmUpTimer(currentWarmUp.duration);
    warmUpStateRef.current = {};
    lastWarmUpNudgeRef.current = 0;
    lastWarmUpCorrectionRef.current = 0;
    warmUpReExplainedRef.current = false;
    warmUpInactivityStartRef.current = Date.now();
    lastActivityRef.current = Date.now();

    // Server wake-up: send first frame on first warm-up exercise to eliminate cold-start
    if (warmUpIdx === 0 && captureFrame && videoRef.current) {
      performWarmUpCalibration(captureFrame, videoRef.current);
    }

    // 1) Audible Instructions: use voicePrompt if available, fallback to description
    const exName = isHe ? currentWarmUp.name.he : currentWarmUp.name.en;
    const vp = currentWarmUp.voicePrompt
      ? (isHe ? currentWarmUp.voicePrompt.he : currentWarmUp.voicePrompt.en)
      : null;
    const exDesc = vp || (isHe ? currentWarmUp.description.he : currentWarmUp.description.en);
    speakWarmUpExercise(exName, exDesc, playerName);

    // Disability-specific safety tip after announcement (only if no voicePrompt already covers it)
    if (!vp) {
      if (disabilityCtx.usesCrutches) {
        setTimeout(() => speakDisabilityTip('crutchStable', playerName), 3500);
      }
      if (disabilityCtx.type === 'one_arm') {
        setTimeout(() => speakDisabilityTip('useRemainingArm', playerName), 3500);
      }
    }

    warmUpPausedRef.current = false;
    setWarmUpPaused(false);

    warmUpTimerRef.current = setInterval(() => {
      const now = Date.now();
      const state = warmUpStateRef.current;
      const isMoving = state.moving || false;

      // 3) Movement Lock: timer ONLY counts down when moving
      if (!isMoving) {
        // Track continuous inactivity duration
        const inactiveSeconds = (now - lastActivityRef.current) / 1000;

        if (!warmUpPausedRef.current) {
          warmUpPausedRef.current = true;
          setWarmUpPaused(true);
        }

        // 2) Gentle nudge: 8s of no movement (forgiving timing)
        if (inactiveSeconds >= 8 && (now - lastWarmUpNudgeRef.current) / 1000 >= 8) {
          lastWarmUpNudgeRef.current = now;

          // Re-explain at 20s (once per exercise)
          if (inactiveSeconds >= 20 && !warmUpReExplainedRef.current) {
            warmUpReExplainedRef.current = true;
            const eName = isHe ? currentWarmUp.name.he : currentWarmUp.name.en;
            const eDesc = isHe ? currentWarmUp.description.he : currentWarmUp.description.en;
            speakWarmUpReExplain(eName, eDesc, playerName);
            setFeedback({
              type: 'info',
              text: isHe ? 'בוא נסביר שוב...' : "Let me explain again..."
            });
          } else {
            const eName = isHe ? currentWarmUp.name.he : currentWarmUp.name.en;
            speakWarmUpInactivityNudge(eName, playerName);
            setFeedback({
              type: 'info',
              text: isHe ? `${playerName}, אני פה. התחל את ה${eName} כשאתה מוכן.` : `${playerName}, I'm here. Start the ${eName} when you're ready.`
            });
          }
        }

        return; // Timer stays frozen
      }

      // User is moving — resume timer
      if (warmUpPausedRef.current) {
        warmUpPausedRef.current = false;
        setWarmUpPaused(false);
      }

      setWarmUpTimer(prev => {
        if (prev <= 1) {
          clearInterval(warmUpTimerRef.current);
          // Move to next warm-up exercise or finish
          if (warmUpIdx < warmUpExercises.length - 1) {
            setWarmUpIdx(warmUpIdx + 1);
          } else {
            // All warm-up done → transition to first exercise briefing
            setWarmUpDone(true);
            sessionDataRef.current.warmUpCompleted = true;
            speakWarmUpComplete(playerName);
            setTimeout(() => {
              setPhase(PHASE.IDLE);
              setFeedback(null);
            }, 2500);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(warmUpTimerRef.current);
  }, [phase, warmUpIdx]);

  // Warm-up pose analysis
  useEffect(() => {
    if (phase !== PHASE.WARM_UP || !landmarks || !currentWarmUp) return;

    const stableLm = stabilizerRef.current.stabilize(landmarks);
    if (!stableLm) return;
    const analyze = currentWarmUp.analyze;
    const prevState = warmUpStateRef.current;
    const newState = analyze(stableLm, prevState);

    // Update activity tracking
    if (newState.moving) {
      lastActivityRef.current = Date.now();
    }

    const now = Date.now();
    const fb = newState.feedback;

    if (fb) {
      if (fb.type === 'good') {
        // Good movement - occasional encouragement
        if (now - lastWarmUpNudgeRef.current > 10000) {
          lastWarmUpNudgeRef.current = now;
          speakEncouragement();
        }
      } else if (fb.type === 'warning' && fb.text) {
        // 'notMoving' is handled by the timer loop (4s nudge / 15s re-explain) — skip here
        if (fb.text === 'notMoving') {
          // No-op: timer loop handles inactivity nudges
        } else if (now - lastWarmUpCorrectionRef.current > 8000) {
          // Specific correction (kneesHigher, armCirclesSmall, widerSteps)
          lastWarmUpCorrectionRef.current = now;
          speakWarmUpCorrection(fb.text, playerName);
          const correctionTexts = {
            kneesHigher: isHe ? 'הרם את הברכיים יותר גבוה!' : 'Bring your knees higher!',
            armCirclesSmall: isHe ? 'הגדל את המעגלים!' : 'Bigger circles!',
            widerSteps: isHe ? 'צעדים רחבים יותר!' : 'Wider steps!',
            armPunchesSmall: isHe ? 'תאגרף יותר רחוק!' : 'Punch further!',
            twistMore: isHe ? 'סובב יותר!' : 'Twist more!',
            kneeToChest: isHe ? 'הרם את הברך לכיוון החזה!' : 'Bring your knee to your chest!',
            kickHigher: isHe ? 'בעט יותר גבוה!' : 'Kick higher!',
            hopMore: isHe ? 'קפוץ יותר גבוה!' : 'Hop higher!',
            singleArmSmall: isHe ? 'הגדל את הסיבוב!' : 'Bigger rotation!',
          };
          setFeedback({
            type: 'warning',
            text: correctionTexts[fb.text] || fb.text
          });
        }
      } else if (fb.type === 'count') {
        // Rep count for high knees
        speakCount(fb.count);
        setFeedback(fb);
      }
    }

    warmUpStateRef.current = newState;
  }, [landmarks, phase, warmUpIdx]);

  const handleStartCamera = useCallback(async () => {
    unlockAudio(); // Unlock mobile audio on camera permission tap — this IS the user gesture
    setAudioUnlocked(true); // Hide manual audio button immediately
    await startCamera();
    // Re-unlock after camera resolves (Android sometimes re-suspends during permission dialog)
    unlockAudio();
    setTimeout(() => { if (videoRef.current) startLoop(videoRef.current); }, 500);
    // Start session timer
    if (!sessionDataRef.current.startTime) {
      sessionDataRef.current.startTime = Date.now();
      sessionSavedRef.current = false;
    }
  }, [startCamera, startLoop, videoRef, unlockAudio]);

  const handleStopCamera = useCallback(() => {
    stopLoop(); stopObjLoop(); stopBallLoop(); stopCamera(); stopSpeech(); stopAICoaching(); stopVision();
    clearInterval(warmUpTimerRef.current);
    setPhase(PHASE.IDLE);
  }, [stopLoop, stopObjLoop, stopBallLoop, stopCamera, stopSpeech, stopAICoaching]);

  function resetAllTracking() {
    lastSpokenRef.current = '';
    badFormCountRef.current = 0;
    goodFormCountRef.current = 0;
    formStoppedRef.current = false;
    lastActivityRef.current = Date.now();
    lastNudgeTimeRef.current = 0;
    lastCoachingTimeRef.current = 0;
    sittingWarnedRef.current = false;
    headDownCountRef.current = 0;
    prodIndexRef.current = 0;
    exerciseStartTimeRef.current = null;
    lastMindMuscleCueRef.current = 0;
    // Reset Kalman filters for new exercise
    stabilizerRef.current.reset();
    anglesHistoryRef.current = [];
    prevAnglesRef.current = null;
    romGaugeRef.current?.reset();
    performanceReportRef.current = null;
    frameCountRef.current = 0;
    repScoresRef.current = [];
  }

  // === SESSION TRACKING ===
  // Record exercise result when moving to next exercise or completing workout
  function recordExerciseResult() {
    if (!currentExercise) return;
    const duration = timer;
    const weight = userProfile?.weight || 70;
    const calories = estimateCalories(currentExercise.name, duration, weight);
    const bestQuality = setsPerformance.length > 0
      ? (setsPerformance.every(s => s.quality === 'perfect') ? 'perfect'
        : setsPerformance.some(s => s.quality === 'needs_work') ? 'needs_work' : 'good')
      : 'needs_work';

    // Compute exercise-level average score from all sets
    const exerciseAvg = setsPerformance.length > 0
      ? setsPerformance.reduce((s, sp) => s + (sp.avgScore || 0), 0) / setsPerformance.length
      : 0;

    // Adaptive coaching: suggest difficulty change based on average score
    if (exerciseAvg > 0 && exerciseAvg < 5) {
      setTimeout(() => {
        speakIfIdle(isHe
          ? `${playerName}, הציון הממוצע נמוך. אולי כדאי להוריד קושי או להתמקד בטכניקה`
          : `${playerName}, average score is low. Consider lowering difficulty or focusing on technique`,
          { rate: 1.2 });
      }, 1500);
    }

    sessionDataRef.current.exerciseResults.push({
      name: currentExercise.name,
      repsTarget: parseInt(currentExercise.reps) || 0,
      repsActual: displayReps,
      setsTarget: totalSets,
      setsCompleted: setsPerformance.length,
      duration,
      quality: bestQuality,
      calories,
      avgScore: Math.round(exerciseAvg * 10) / 10,
    });
  }

  async function saveSession(status) {
    if (!user || sessionSavedRef.current) return;
    if (sessionDataRef.current.exerciseResults.length === 0) return;
    sessionSavedRef.current = true;
    clearActiveWorkout();

    const data = {
      date: Timestamp.now(),
      weekNumber: parseInt(searchParams.get('week') || '0'),
      dayNumber: parseInt(searchParams.get('day') || '0'),
      sport: userProfile?.sport || '',
      status,
      totalDuration: sessionDataRef.current.startTime
        ? Math.floor((Date.now() - sessionDataRef.current.startTime) / 1000)
        : 0,
      totalCalories: sessionDataRef.current.exerciseResults.reduce((s, e) => s + (e.calories || 0), 0),
      warmUpCompleted: sessionDataRef.current.warmUpCompleted,
      exercises: sessionDataRef.current.exerciseResults,
      personalBests: [],
      aiSummary: null,
    };

    try {
      const ref = await addDoc(collection(db, 'users', user.uid, 'workouts'), data);
      // Mark day as completed in localStorage for Dashboard progress tracking
      if (status === 'completed') {
        const weekIdx = parseInt(searchParams.get('week') || '0');
        const dayIdx = parseInt(searchParams.get('day') || '0');
        markDayCompleted(weekIdx, dayIdx);
        incrementWeeklySession();

        // Save session average score and check for level-up eligibility
        const exercises = sessionDataRef.current.exerciseResults || [];
        const scoredExercises = exercises.filter(e => (e.avgScore || 0) > 0);
        if (scoredExercises.length > 0) {
          const sessionAvg = scoredExercises.reduce((s, e) => s + e.avgScore, 0) / scoredExercises.length;
          saveSessionAvg(Math.round(sessionAvg * 10) / 10);

          const levelUp = checkLevelUpEligibility();
          if (levelUp) {
            setTimeout(() => {
              speakIfIdle(isHe
                ? `${playerName}, שלושה אימונים ברמה גבוהה! הגיע הזמן לעלות רמה`
                : `${playerName}, three high-level sessions! Time to level up`,
                { rate: 1.2 });
            }, 3000);
          }
        }
      }
      // Fire-and-forget AI summary
      fetchAISummary(ref.id, data);
    } catch (err) {
      console.error('Failed to save session:', err);
      sessionSavedRef.current = false; // allow retry
    }
  }

  async function fetchAISummary(docId, sessionData) {
    try {
      const resp = await fetch(apiUrl('/api/coach/workout-summary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: {
            name: userProfile?.name,
            age: userProfile?.age,
            disability: userProfile?.disability,
          },
          sessionData,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.summary) {
          await updateDoc(doc(db, 'users', user.uid, 'workouts', docId), { aiSummary: data.summary });
        }
      }
    } catch (err) {
      // Fallback: generate local template summary
      const completedCount = sessionData.exercises.filter(e => e.setsCompleted >= e.setsTarget).length;
      const totalCount = sessionData.exercises.length;
      const fallback = isHe
        ? `${userProfile?.name || 'שחקן'}, סיימת ${completedCount} מתוך ${totalCount} תרגילים. ${sessionData.status === 'completed' ? 'כל הכבוד!' : 'בפעם הבאה ננסה לסיים הכל!'}`
        : `${userProfile?.name || 'Player'}, you completed ${completedCount} of ${totalCount} exercises. ${sessionData.status === 'completed' ? 'Great job!' : 'Next time let\'s try to finish them all!'}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'workouts', docId), { aiSummary: fallback });
      } catch {}
    }
  }

  // Determine if exercise needs equipment detection (skip for bodyweight/fitness exercises)
  function needsEquipmentCheck(exercise) {
    if (!exercise) return false;
    const sport = userProfile?.sport;
    // Fitness exercises never need equipment check
    if (sport === 'fitness') return false;
    // Known bodyweight exercise names (Hebrew) — no equipment needed
    const bodyweightNames = [
      'שכיבות סמיכה', 'סקוואט', 'פלאנק', 'לאנג\'ים', 'דיפס',
      'כפיפות מרפק', 'גשר ישבן', 'כפיפות בטן', 'מטפס הרים',
      'ישיבה על הקיר', 'פלאנק צידי', 'בורפיז',
      'כתפיים עם משקולות', 'גובלט סקוואט', 'הרמה צידית',
      'משיכת משקולת', 'הרחבת מרפק',
      'לחיצת כתפיים עם גומייה', 'סקוואט עם גומייה',
      'כפיפות מרפק עם גומייה', 'משיכת גומייה', 'מתיחת גומייה',
      'ריצת אינטרוולים', 'ספרינטים', 'אירובי ישיבה',
      'אגרוף ישיבה', 'סיבובי ידיים מהירים', 'סיבובי גוף עליון מהירים',
    ];
    const name = exercise.name || '';
    if (bodyweightNames.some(bw => name.includes(bw))) return false;
    // Ball/sport drills likely need equipment
    return true;
  }

  function handleStartBriefing() {
    unlockAudio(); // Ensure mobile audio is unlocked on every exercise start
    exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0);
    setTimer(0);
    setFeedback(null);
    resetAllTracking();

    // On first exercise, do environment scan before briefing
    if (currentIdx === 0 && !environmentScannedRef.current && objReady) {
      setPhase(PHASE.ENVIRONMENT_SCAN);
      return;
    }

    setPhase(PHASE.BRIEFING);
    // Use voicePrompt if available from AI, otherwise fall back to description
    const voiceText = currentExercise.voicePrompt || currentExercise.description;
    speakBriefing(currentExercise.name, voiceText, currentExercise.tips, locationProps, playerName);
  }

  function handleStartAfterBriefing() {
    unlockAudio(); // Re-unlock on user tap for iOS
    stopSpeech();
    sittingWarnedRef.current = false;

    if (!needsEquipmentCheck(currentExercise)) {
      // Skip equipment detection — go directly to warm-up or calibrating
      if (!warmUpDone && currentIdx === 0) {
        setWarmUpIdx(0);
        speakWarmUpIntro(playerName);
        setPhase(PHASE.WARM_UP);
      } else {
        calibrationDataRef.current = null;
        setPhase(PHASE.CALIBRATING);
      }
    } else {
      setEquipmentFound(false);
      setEquipmentLabel('');
      setPhase(PHASE.CHECKING_EQUIPMENT);
    }
  }

  function handleSetComplete() {
    clearInterval(timerRef.current);
    // Reset command coaching state
    commandPhaseRef.current = 'IDLE';
    commandRepRef.current = 1;
    clearTimeout(analyzeTimeoutRef.current);

    const wasGood = badFormCountRef.current < 3;
    const wasPerfect = badFormCountRef.current === 0 && goodFormCountRef.current > 3;

    // Compute set average from AI vision scores
    const setAvgScore = repScoresRef.current.length > 0
      ? repScoresRef.current.reduce((a, b) => a + b, 0) / repScoresRef.current.length
      : 0;

    setSetsPerformance(prev => [...prev, { set: currentSet, quality: wasPerfect ? 'perfect' : wasGood ? 'good' : 'needs_work', avgScore: Math.round(setAvgScore * 10) / 10 }]);

    if (wasPerfect) {
      const langKey = isHe ? 'he' : 'en';
      const exType = analyzerRef.current?.cueKey || 'default';
      speakOptimization(OPTIMIZATION_TIPS[langKey][exType] || OPTIMIZATION_TIPS[langKey].default);
    } else if (wasGood) {
      speakEncouragement();
    }

    // Level-Up check for 51+ longevity athletes
    const playerAge = userProfile?.age;
    if (playerAge >= 51 && !levelUpPromptShownRef.current && wasPerfect) {
      const avgRepTime = displayReps > 0 ? (timer * 1000) / displayReps : null;
      const report = performanceReportRef.current;
      if (report) {
        const evalResult = evaluateSetPerformance(
          report.stabilityScore, report.symmetryScore, report.romPercentage, avgRepTime
        );
        if (evalResult.qualifiesForLevelUp) {
          levelUpSetsRef.current++;
          if (levelUpSetsRef.current >= 2) {
            levelUpPromptShownRef.current = true;
            speakLevelUpPrompt(playerName);
            setShowLevelUpModal(true);
          }
        }
      }
    }

    if (currentSet >= totalSets) {
      setPhase(PHASE.EXERCISE_DONE);
      speak(t('training.allSetsComplete'));
    } else {
      setPhase(PHASE.RESTING);
      setRestTime(restDuration);
      speakRestTip(currentExercise?.tips || '');
    }
  }

  function startNextSet() {
    setCurrentSet(prev => prev + 1);
    const prevCal = exerciseStateRef.current._calibration;
    exerciseStateRef.current = { _userProfile: userProfile, _calibration: prevCal }; setDisplayReps(0);
    setFeedback(null);
    resetAllTracking();
    exerciseStartTimeRef.current = Date.now();
    setPhase(PHASE.EXERCISING);
    setTimer(0);
    setActiveTimer(0);
    speakSetStart(currentSet + 1, totalSets);

    // Start command coaching for rep-based exercises
    if (analyzerRef.current?.type !== 'hold') {
      commandPhaseRef.current = 'COMMANDING';
      commandRepRef.current = 1;
      setTimeout(() => speakCommandAndWait(1), 1500);
    }
  }

  function handleSkipRest() {
    clearInterval(timerRef.current);
    setRestTime(0);
    startNextSet();
  }

  function handlePauseExercise() {
    // Save for cross-session resume
    saveActiveWorkout({
      week: parseInt(searchParams.get('week') || '0'),
      day: parseInt(searchParams.get('day') || '0'),
      exerciseIndex: currentIdx,
      currentSet,
      displayReps,
      timer,
      exerciseResults: sessionDataRef.current.exerciseResults,
      warmUpCompleted: sessionDataRef.current.warmUpCompleted,
      startTime: sessionDataRef.current.startTime,
    });
    // Snapshot current state for resume
    pausedStateRef.current = {
      exerciseState: { ...exerciseStateRef.current },
      displayReps,
      currentSet,
      timer,
      activeTimer,
      setsPerformance: [...setsPerformance],
      feedback,
      wasPhase: phase, // track if we were in EXERCISING or WARM_UP
    };
    if (phase === PHASE.WARM_UP) {
      pausedWarmUpRef.current = {
        warmUpIdx,
        warmUpTimer: warmUpTimer,
        warmUpState: { ...warmUpStateRef.current },
      };
      clearInterval(warmUpTimerRef.current);
    }
    clearInterval(timerRef.current);
    // Pause command coaching
    commandPhaseRef.current = 'IDLE';
    clearTimeout(analyzeTimeoutRef.current);
    stopSpeech();
    stopAICoaching();
    stopBallLoop();
    setPhase(PHASE.PAUSED);
  }

  function handleResumeExercise() {
    const snap = pausedStateRef.current;
    if (!snap) return;

    // Restore warm-up if we were in warm-up
    if (snap.wasPhase === PHASE.WARM_UP && pausedWarmUpRef.current) {
      const wuSnap = pausedWarmUpRef.current;
      warmUpStateRef.current = wuSnap.warmUpState;
      setWarmUpIdx(wuSnap.warmUpIdx);
      setWarmUpTimer(wuSnap.warmUpTimer);
      pausedWarmUpRef.current = null;
      pausedStateRef.current = null;
      lastActivityRef.current = Date.now();
      setPhase(PHASE.WARM_UP);
      speakPriority(isHe ? 'ממשיכים!' : "Let's go!");
      return;
    }

    // Restore exercise state
    exerciseStateRef.current = snap.exerciseState;
    setDisplayReps(snap.displayReps);
    setCurrentSet(snap.currentSet);
    setTimer(snap.timer);
    setActiveTimer(snap.activeTimer);
    setSetsPerformance(snap.setsPerformance);
    setFeedback(snap.feedback);
    lastActivityRef.current = Date.now();
    lastNudgeTimeRef.current = 0;
    exerciseStartTimeRef.current = Date.now();
    pausedStateRef.current = null;
    setPhase(PHASE.EXERCISING);
    speakPriority(isHe ? 'ממשיכים!' : "Let's go!");

    // Resume command coaching for rep-based exercises
    if (analyzerRef.current?.type !== 'hold') {
      const nextRep = (snap.displayReps || 0) + 1;
      commandPhaseRef.current = 'COMMANDING';
      commandRepRef.current = nextRep;
      setTimeout(() => speakCommandAndWait(nextRep), 1500);
    }
  }

  async function handleNextExercise() {
    // Record this exercise's results before moving on
    recordExerciseResult();
    // Save progress for resume
    saveActiveWorkout({
      week: parseInt(searchParams.get('week') || '0'),
      day: parseInt(searchParams.get('day') || '0'),
      exerciseIndex: currentIdx + 1 < exercises.length ? currentIdx + 1 : currentIdx,
      currentSet: 1,
      displayReps: 0,
      timer: 0,
      exerciseResults: sessionDataRef.current.exerciseResults,
      warmUpCompleted: sessionDataRef.current.warmUpCompleted,
      startTime: sessionDataRef.current.startTime,
    });
    stopSpeech(); setPhase(PHASE.IDLE); setTimer(0); setFeedback(null);
    exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setCurrentSet(1); setSetsPerformance([]); resetAllTracking();

    if (currentIdx < exercises.length - 1) {
      // Try workout adaptation after 2+ exercises, max once per 2 min
      const now = Date.now();
      const completedCount = sessionDataRef.current.exerciseResults.length;
      const shouldAdapt = completedCount >= 2
        && (now - lastAdaptationRef.current) > 120000
        && currentIdx < exercises.length - 2;

      if (shouldAdapt) {
        try {
          const resp = await fetch(apiUrl('/api/coach/adapt-workout'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              profile: { name: userProfile?.name, age: userProfile?.age, disability: userProfile?.disability, sport: userProfile?.sport, skillLevel: userProfile?.skillLevel },
              completedExercises: sessionDataRef.current.exerciseResults,
              remainingPlan: exercises.slice(currentIdx + 1),
              environmentContext: environmentScan,
            }),
          });
          if (resp.ok) {
            const result = await resp.json();
            if (result.adapted && result.plan?.length > 0) {
              const sport = userProfile?.sport || 'fitness';
              const sanitizedAdapt = sanitizePlan({ weeks: [{ days: [{ exercises: result.plan }] }] }, sport, userProfile?.age);
              const cleanPlan = sanitizedAdapt.weeks[0].days[0].exercises || [];
              const newExercises = [...exercises.slice(0, currentIdx + 1), ...cleanPlan];
              setExercises(newExercises);
              lastAdaptationRef.current = now;
              if (result.reasoning) {
                speakPriority(isHe ? `שיניתי את התוכנית: ${result.reasoning}` : `Plan adapted: ${result.reasoning}`);
              }
            }
          }
        } catch (err) {
          console.warn('[Adaptation] Failed:', err.message);
        }
      }

      setCurrentIdx(currentIdx + 1); speak(t('training.nextExercise'));
    } else {
      setWorkoutDone(true); speak(t('training.workoutComplete')); saveSession('completed');
    }
  }

  function handlePrevExercise() {
    if (currentIdx > 0) {
      stopSpeech(); setPhase(PHASE.IDLE); setTimer(0); setFeedback(null);
      exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setCurrentSet(1); setSetsPerformance([]); resetAllTracking();
      setCurrentIdx(currentIdx - 1);
    }
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  const feedbackColor = { good: 'bg-green-500', count: 'bg-blue-600', info: 'bg-blue-500', warning: 'bg-orange-500' };

  if (workoutDone) {
    return (
      <WorkoutSummary
        sessionData={sessionDataRef.current}
        profile={userProfile}
        sport={userProfile?.sport}
        isHe={isHe}
        onBackToPlan={() => navigate('/')}
      />
    );
  }

  return (
    <div className={isFullscreen ? 'fixed inset-0 bg-black z-40' : isMobile ? 'fixed inset-0 flex flex-col bg-black' : 'max-w-4xl mx-auto space-y-4'}>
      {!isFullscreen && !isMobile && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold text-gray-800">{t('training.title')}</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm bg-gray-100 px-3 py-1 rounded-full text-gray-600">
              {LOCATION_ICONS[currentLocation] || '\u26BD'} {t(`dashboard.location${currentLocation.charAt(0).toUpperCase() + currentLocation.slice(1)}`)}
            </span>
            <button onClick={() => { recordExerciseResult(); saveSession('partial'); handleStopCamera(); navigate('/'); }} className="text-sm text-gray-500 hover:text-red-500">
              {t('training.finishWorkout')}
            </button>
          </div>
        </div>
      )}

      {/* Camera + Pose Overlay */}
      <div className={isFullscreen
        ? 'relative w-full h-full bg-black overflow-hidden'
        : isMobile ? 'relative w-full bg-black overflow-hidden flex-shrink-0'
        : 'relative bg-black rounded-xl overflow-hidden'}
        style={isFullscreen ? undefined : isMobile ? { height: '40vh' } : { aspectRatio: '4/3' }}>
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted style={{ transform: 'scaleX(-1)' }} />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ transform: 'scaleX(-1)' }} />

        {/* Fullscreen toggle button */}
        {cameraActive && (
          <button
            onClick={() => setIsFullscreen(f => !f)}
            className="absolute top-2 left-2 z-30 bg-black/50 text-white p-2 rounded-lg hover:bg-black/70 transition text-sm"
          >
            {isFullscreen ? (isHe ? '\u2199 \u05E6\u05DE\u05E6\u05DD' : '\u2199 Exit') : (isHe ? '\u2197 \u05DE\u05E1\u05DA \u05DE\u05DC\u05D0' : '\u2197 Fullscreen')}
          </button>
        )}

        {/* Fullscreen: finish workout button */}
        {isFullscreen && cameraActive && (
          <button
            onClick={() => { recordExerciseResult(); saveSession('partial'); handleStopCamera(); navigate('/'); }}
            className="absolute top-2 right-2 z-30 bg-red-500/70 text-white px-3 py-1.5 rounded-lg hover:bg-red-600/80 transition text-xs"
          >
            {isHe ? '\u2716 \u05E1\u05D9\u05D9\u05DD' : '\u2716 End'}
          </button>
        )}

        {/* ROM Gauge overlay */}
        {phase === PHASE.EXERCISING && cameraActive && (
          <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
            <ROMGauge ref={romGaugeRef} isHe={isHe} />
          </div>
        )}

        {!poseReady && cameraActive && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-white text-center space-y-2">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-white border-t-transparent rounded-full"></div>
              <p>{t('training.loadingPose')}</p>
            </div>
          </div>
        )}

        {/* Mobile audio unlock button */}
        {isMobile && cameraActive && !audioUnlocked && (
          <button
            onClick={() => { unlockAudio(); setAudioUnlocked(true); }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-green-500 text-white rounded-lg font-medium text-sm animate-pulse hover:bg-green-600 transition"
          >
            {isHe ? '\uD83D\uDD0A \u05D4\u05E4\u05E2\u05DC \u05E7\u05D5\u05DC / Start Voice' : '\uD83D\uDD0A Start Voice'}
          </button>
        )}

        {!cameraActive && (
          <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
            <button onClick={handleStartCamera} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium text-lg hover:bg-blue-700 transition">
              &#128247; {t('training.startCamera')}
            </button>
          </div>
        )}

        {/* Briefing overlay — bottom sheet on mobile so camera stays visible */}
        {phase === PHASE.BRIEFING && (() => {
          // Build instructions: use AI-generated array or fall back to description
          const steps = currentExercise?.instructions?.length > 0
            ? currentExercise.instructions
            : currentExercise?.description
              ? currentExercise.description.split(/[.,،]/).map(s => s.trim()).filter(Boolean)
              : [];
          return (
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/50 z-20">
            <div className="bg-white/95 backdrop-blur-sm rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-sm w-full space-y-3 max-h-[60vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl" dir={isHe ? 'rtl' : 'ltr'}>
              {/* Drag handle for mobile */}
              <div className="sm:hidden w-10 h-1 bg-gray-300 rounded-full mx-auto mb-1"></div>

              {/* Exercise name + meta */}
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-800">{currentExercise?.name}</h3>
                <div className="text-xs text-gray-400 mt-1">
                  {currentExercise?.sets} {t('training.set')} | {currentExercise?.reps} {t('training.reps')} | {currentExercise?.restSeconds}{t('dashboard.secRest')}
                </div>
              </div>

              {/* Step-by-step instructions */}
              {steps.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                    {isHe ? 'איך לבצע' : 'How to do it'}
                  </h4>
                  <ol className={`space-y-1.5 text-sm text-gray-700 ${isHe ? 'pr-1' : 'pl-1'}`}>
                    {steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Setup hint */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5 text-sm text-yellow-800">
                <span className="font-bold">{LOCATION_ICONS[currentLocation]} {isHe ? 'הכנה' : 'Setup'}:</span>{' '}
                {locationProps.setup}
              </div>

              {/* Safety tip */}
              {currentExercise?.tips && (
                <div className="bg-blue-50 rounded-lg p-2.5 text-xs text-blue-700 flex items-start gap-1.5">
                  <span className="flex-shrink-0">&#9888;&#65039;</span>
                  <span>{currentExercise.tips}</span>
                </div>
              )}

              {/* Start button */}
              <button onClick={handleStartAfterBriefing} className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-bold text-lg hover:opacity-90 transition shadow-lg">
                {isHe ? 'הבנתי, בואו נתחיל!' : "Got it, let's start!"}
              </button>
            </div>
          </div>
          );
        })()}

        {/* Environment scan overlay — bottom sheet on mobile */}
        {phase === PHASE.ENVIRONMENT_SCAN && (
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/50 z-20">
            <div className="bg-white/95 backdrop-blur-sm rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-md w-full text-center space-y-3 max-h-[55vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl" dir={isHe ? 'rtl' : 'ltr'}>
              {!environmentScan ? (
                <>
                  <div className="text-5xl animate-pulse">{'\uD83D\uDD0D'}</div>
                  <h3 className="text-lg font-bold text-gray-800">
                    {isHe ? 'סורק את הסביבה...' : 'Scanning environment...'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {isHe ? 'מחפש ציוד, מזהה סכנות ומתאים את התוכנית' : 'Looking for equipment, identifying hazards and adapting the plan'}
                  </p>
                  <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <button
                    onClick={() => { environmentScannedRef.current = true; setPhase(PHASE.BRIEFING); speakBriefing(currentExercise?.name, currentExercise?.voicePrompt || currentExercise?.description, currentExercise?.tips, locationProps, playerName); }}
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    {isHe ? 'דלג' : 'Skip'}
                  </button>
                </>
              ) : (
                <>
                  <div className="text-5xl">
                    {environmentScan.overallSafety === 'safe' ? '\u2705' : environmentScan.overallSafety === 'caution' ? '\u26A0\uFE0F' : '\u274C'}
                  </div>
                  <h3 className="text-lg font-bold text-gray-800">
                    {isHe ? 'סריקת סביבה הושלמה' : 'Environment scan complete'}
                  </h3>

                  {environmentScan.hazards?.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                      <div className="font-bold mb-1">{isHe ? 'אזהרות:' : 'Warnings:'}</div>
                      {environmentScan.hazards.map((h, i) => <div key={i}>{'• '}{h.warning}</div>)}
                    </div>
                  )}

                  {environmentScan.equipment?.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                      <div className="font-bold mb-1">{isHe ? 'ציוד זמין:' : 'Available equipment:'}</div>
                      {environmentScan.equipment.map((eq, i) => <div key={i}>{'• '}{eq.suggestion}</div>)}
                    </div>
                  )}

                  {environmentScan.assistiveDevices?.length > 0 && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
                      <div className="font-bold mb-1">{isHe ? 'עזרי נגישות:' : 'Assistive devices:'}</div>
                      {environmentScan.assistiveDevices.map((d, i) => <div key={i}>{'• '}{d}</div>)}
                    </div>
                  )}

                  <p className="text-xs text-gray-400">{isHe ? 'ממשיך לתדריך...' : 'Continuing to briefing...'}</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Equipment check overlay — bottom sheet on mobile */}
        {phase === PHASE.CHECKING_EQUIPMENT && (
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/50 z-20">
            <div className="bg-white/95 backdrop-blur-sm rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-sm w-full text-center space-y-3 shadow-2xl">
              <div className="text-5xl">{equipmentFound ? '\u2705' : '\uD83D\uDD0D'}</div>
              <h3 className="text-lg font-bold text-gray-800">
                {equipmentFound
                  ? (isHe ? `ציוד זוהה: ${equipmentLabel}!` : `Equipment found: ${equipmentLabel}!`)
                  : (isHe ? 'מחפש ציוד...' : 'Looking for equipment...')}
              </h3>
              {!equipmentFound && (
                <p className="text-sm text-gray-500">
                  {isHe ? 'כוון את המצלמה לכיוון הציוד (כיסא, בקבוק, כדור)' : 'Point the camera at your equipment (chair, bottle, ball)'}
                </p>
              )}
              {equipmentFound && (
                <div className="text-green-600 font-medium text-sm">
                  {isHe ? 'מתחילים עוד רגע...' : 'Starting soon...'}
                </div>
              )}
              {!equipmentFound && (
                <button
                  onClick={() => {
                    stopObjLoop();
                    clearTimeout(equipCheckTimerRef.current);
                    if (!warmUpDone && currentIdx === 0) {
                      setWarmUpIdx(0);
                      speakWarmUpIntro(playerName);
                      setPhase(PHASE.WARM_UP);
                    } else {
                      calibrationDataRef.current = null;
                      setPhase(PHASE.CALIBRATING);
                    }
                  }}
                  className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  {isHe ? 'התחל בכל זאת' : 'Start anyway'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Warm-up — minimal camera overlay (timer + feedback only) */}
        {phase === PHASE.WARM_UP && feedback && (
          <div className={`absolute top-4 left-4 right-4 ${feedbackColor[feedback.type] || 'bg-blue-500'} text-white px-4 py-3 rounded-xl text-center font-bold text-lg shadow-lg z-[5] pointer-events-none`}>
            {feedback.text}
          </div>
        )}

        {/* Rest timer overlay */}
        {phase === PHASE.RESTING && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="text-white text-lg font-medium">{t('training.restBetweenSets')}</div>
              <div className="text-7xl font-bold text-white">{restTime}</div>
              <div className="text-white/70 text-sm">{t('training.set')} {currentSet}/{totalSets} {t('training.setComplete')}</div>
              {currentExercise?.tips && (
                <div className="bg-white/10 rounded-xl px-4 py-3 text-white/90 text-sm max-w-xs mx-auto">{currentExercise.tips}</div>
              )}
              <button onClick={handleSkipRest} className="px-6 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition text-sm">
                {t('training.skipRest')} &#9654;
              </button>
            </div>
          </div>
        )}

        {/* Exercise done overlay */}
        {phase === PHASE.EXERCISE_DONE && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="text-6xl">&#127881;</div>
              <div className="text-white text-2xl font-bold">{t('training.allSetsComplete')}</div>
              <div className="flex gap-2 justify-center">
                {setsPerformance.map((sp, i) => (
                  <div key={i} className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                    sp.quality === 'perfect' ? 'bg-green-500' : sp.quality === 'good' ? 'bg-blue-500' : 'bg-orange-500'
                  }`}>
                    {sp.quality === 'perfect' ? '\u2605' : sp.quality === 'good' ? '\u2713' : '~'}
                  </div>
                ))}
              </div>
              <button onClick={handleNextExercise} className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition">
                {currentIdx < exercises.length - 1 ? t('training.nextExercise') : t('training.finishWorkout')}
              </button>
            </div>
          </div>
        )}

        {/* PAUSED overlay */}
        {phase === PHASE.PAUSED && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-30">
            <div className="text-center space-y-4 px-6">
              <div className="text-5xl">{'\u23F8\uFE0F'}</div>
              <div className="text-white text-xl font-bold">{isHe ? 'מושהה' : 'Paused'}</div>
              <div className="text-white/60 text-sm">
                {isHe
                  ? `${pausedStateRef.current?.wasPhase === PHASE.WARM_UP ? 'חימום' : `סט ${currentSet}/${totalSets}`} | ${displayReps} חזרות | ${formatTime(timer)}`
                  : `${pausedStateRef.current?.wasPhase === PHASE.WARM_UP ? 'Warm-up' : `Set ${currentSet}/${totalSets}`} | ${displayReps} reps | ${formatTime(timer)}`}
              </div>
              <button onClick={handleResumeExercise} className="px-8 py-3 bg-green-500 text-white rounded-xl font-bold text-lg hover:bg-green-600 transition">
                {isHe ? '\u25B6 \u05D4\u05DE\u05E9\u05DA' : '\u25B6 Resume'}
              </button>
              <button
                onClick={() => { pausedStateRef.current = null; pausedWarmUpRef.current = null; setPhase(PHASE.IDLE); }}
                className="block mx-auto text-white/50 text-sm underline hover:text-white/70"
              >
                {isHe ? '\u05D4\u05EA\u05D7\u05DC \u05DE\u05D7\u05D3\u05E9' : 'Restart exercise'}
              </button>
            </div>
          </div>
        )}

        {/* Calibration overlay — 5-second ROM measurement */}
        {phase === PHASE.CALIBRATING && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl p-6 text-center text-white">
              <div className="text-lg font-bold mb-2">
                {isHe ? 'כיול תנועה' : 'Calibrating'}
              </div>
              <div className="text-4xl font-bold text-yellow-400 mb-2">
                {calibrationCountdown}
              </div>
              <div className="text-sm opacity-80">
                {isHe ? 'בצע תנועה אחת מלאה' : 'Perform one full movement'}
              </div>
            </div>
          </div>
        )}

        {/* Not-in-frame indicator */}
        {(phase === PHASE.EXERCISING || phase === PHASE.WARM_UP || phase === PHASE.CALIBRATING) && !landmarks && cameraActive && poseReady && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="bg-yellow-500/80 backdrop-blur-sm text-white px-6 py-3 rounded-2xl text-center animate-pulse">
              <div className="text-lg font-bold">{isHe ? '\u05EA\u05EA\u05E7\u05E8\u05D1 \u05DC\u05DE\u05E6\u05DC\u05DE\u05D4' : 'Move closer to camera'}</div>
              <div className="text-sm opacity-80">{isHe ? '\u05D0\u05E0\u05D9 \u05DC\u05D0 \u05E8\u05D5\u05D0\u05D4 \u05D0\u05D5\u05EA\u05DA \u05D8\u05D5\u05D1' : 'I can\'t see you well'}</div>
            </div>
          </div>
        )}

        {/* Exercise name badge — top left during exercising */}
        {phase === PHASE.EXERCISING && currentExercise && (
          <div className="absolute top-14 left-4 bg-black/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-xl text-sm font-medium max-w-[55%] truncate z-10">
            {currentExercise.name} ({currentIdx + 1}/{exercises.length})
          </div>
        )}

        {/* Live feedback: rep count only on video overlay — text feedback moved to bottom area */}
        {feedback && feedback.type === 'count' && phase === PHASE.EXERCISING && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-green-500 text-white px-6 py-2 rounded-xl text-center font-bold shadow-lg z-[5] pointer-events-none">
            <span className="text-3xl sm:text-4xl">{feedback.count}</span>
          </div>
        )}

        {/* Set counter */}
        {phase === PHASE.EXERCISING && (
          <div className="absolute top-14 right-4 bg-purple-600/90 text-white px-3 py-2 rounded-xl text-sm font-bold z-10">
            {t('training.set')} {currentSet}/{totalSets}
          </div>
        )}

        {/* Ghost skeleton toggle */}
        {phase === PHASE.EXERCISING && (
          <button
            onClick={toggleGhost}
            className={`absolute top-14 left-4 px-3 py-2 rounded-xl text-sm font-bold z-10 transition ${
              ghostEnabled ? 'bg-blue-500/90 text-white' : 'bg-black/50 text-white/70'
            }`}
            title={isHe ? 'הצג/הסתר שלד מנחה' : 'Toggle ghost guide'}
          >
            {'\uD83D\uDC7B'}
          </button>
        )}

        {/* Rep counter + analyzing indicator */}
        {phase === PHASE.EXERCISING && displayReps != null && (
          <div className="absolute bottom-4 right-4 bg-black/70 text-white px-4 py-2 rounded-xl flex items-center gap-2">
            <div>
              <span className="text-sm">{t('training.reps')}: </span>
              <span className="text-2xl font-bold">{displayReps}</span>
              <span className="text-sm text-white/60">/{currentExercise?.reps || '?'}</span>
            </div>
            {aiAnalyzing && (
              <div className="animate-spin w-5 h-5 border-2 border-white/30 border-t-yellow-400 rounded-full" title={isHe ? 'מנתח...' : 'Analyzing...'} />
            )}
          </div>
        )}

        {/* Timer: wall-clock + active time */}
        {phase === PHASE.EXERCISING && (
          <div className="absolute bottom-4 left-4 bg-black/70 text-white px-4 py-2 rounded-xl">
            <span className="text-2xl font-bold">{formatTime(timer)}</span>
            {activeTimer > 0 && activeTimer !== timer && (
              <div className="text-xs text-green-400 mt-0.5">
                {isHe ? 'פעיל' : 'Active'}: {formatTime(activeTimer)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* === MOBILE LAYOUT: 3-zone split (action buttons + exercise list below video) === */}
      {isMobile && !isFullscreen && exercises.length > 0 && (
        <>
          {/* ZONE 2: Action buttons — fixed middle strip, always visible, z-50 */}
          <div className="flex-shrink-0 bg-gray-900 px-3 py-2 z-50 relative" style={{ minHeight: '20vh' }}>
            {/* Feedback badge — small floating tag, doesn't block buttons */}
            {feedback && (phase === PHASE.EXERCISING || phase === PHASE.WARM_UP) && (
              <div className={`${feedbackColor[feedback.type] || 'bg-blue-500'} text-white px-3 py-1 rounded-lg text-center text-sm font-bold mb-2 pointer-events-none`}>
                {feedback.type === 'count' && <span className="text-xl mr-1">{feedback.count}</span>}
                {feedback.text}
              </div>
            )}

            {/* Current exercise name + set info */}
            {currentExercise && phase !== PHASE.WARM_UP && (
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-white font-bold text-base truncate max-w-[60%]">{currentExercise.name}</h2>
                <span className="text-white/60 text-xs flex-shrink-0">
                  {t('training.set')} {currentSet}/{totalSets} | {displayReps}/{currentExercise.reps}
                </span>
              </div>
            )}

            {phase === PHASE.WARM_UP && currentWarmUp && (
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-white font-bold text-base truncate max-w-[60%]">
                  {isHe ? currentWarmUp.name.he : currentWarmUp.name.en}
                </h2>
                <span className="text-4xl font-bold text-white">{warmUpTimer}</span>
              </div>
            )}

            {/* Sets performance dots */}
            {setsPerformance.length > 0 && phase !== PHASE.WARM_UP && (
              <div className="flex items-center gap-1.5 mb-2">
                {setsPerformance.map((sp, i) => (
                  <div key={i} className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                    sp.quality === 'perfect' ? 'bg-green-500' : sp.quality === 'good' ? 'bg-blue-500' : 'bg-orange-500'
                  }`}>{i + 1}</div>
                ))}
                {Array.from({ length: totalSets - setsPerformance.length }, (_, i) => (
                  <div key={`r-${i}`} className="w-5 h-5 rounded-full border-2 border-white/30"></div>
                ))}
              </div>
            )}

            {/* Action buttons row */}
            {phase === PHASE.WARM_UP ? (
              <div className="flex gap-2">
                <button onClick={handlePauseExercise} className="px-3 py-2 min-h-[48px] bg-yellow-500 text-white rounded-lg text-sm font-medium">
                  {isHe ? 'השהה' : 'Pause'}
                </button>
                <button
                  onClick={() => {
                    clearInterval(warmUpTimerRef.current);
                    if (warmUpIdx < warmUpExercises.length - 1) {
                      setWarmUpIdx(warmUpIdx + 1);
                    } else {
                      setWarmUpDone(true);
                      sessionDataRef.current.warmUpCompleted = true;
                      speakWarmUpComplete(playerName);
                      setFeedback(null);
                      setTimeout(() => setPhase(PHASE.IDLE), 2500);
                    }
                  }}
                  className="flex-1 py-2 min-h-[48px] bg-blue-600 text-white rounded-lg font-bold text-base"
                >
                  {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? 'הבא' : 'Next') : (isHe ? 'סיים חימום' : 'Finish warm-up')}
                </button>
                <button
                  onClick={() => {
                    clearInterval(warmUpTimerRef.current);
                    setWarmUpDone(true);
                    sessionDataRef.current.warmUpCompleted = true;
                    speakWarmUpComplete(playerName);
                    setFeedback(null);
                    setTimeout(() => setPhase(PHASE.IDLE), 2500);
                  }}
                  className="px-3 py-2 min-h-[48px] border border-white/30 text-white rounded-lg text-sm"
                >
                  {isHe ? 'דלג' : 'Skip'}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={handlePrevExercise} disabled={currentIdx === 0}
                  className="px-3 py-2 min-h-[48px] rounded-lg text-sm disabled:opacity-30 border border-white/30 text-white">
                  {t('training.prevExercise')}
                </button>
                {phase === PHASE.PAUSED ? (
                  <button onClick={handleResumeExercise} className="flex-1 py-3 min-h-[52px] bg-green-500 text-white rounded-lg font-bold text-lg">
                    {isHe ? '\u25B6 \u05D4\u05DE\u05E9\u05DA' : '\u25B6 Resume'}
                  </button>
                ) : phase === PHASE.IDLE || phase === PHASE.EXERCISE_DONE ? (
                  <button onClick={handleStartBriefing} disabled={!cameraActive || !poseReady}
                    className="flex-1 py-3 min-h-[52px] bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-bold text-lg shadow-lg disabled:opacity-50">
                    {t('training.startExercise')}
                  </button>
                ) : phase === PHASE.EXERCISING ? (
                  <button onClick={handlePauseExercise} className="flex-1 py-3 min-h-[52px] bg-yellow-500 text-white rounded-lg font-bold text-lg">
                    {t('training.pauseExercise')}
                  </button>
                ) : null}
                <button onClick={handleNextExercise} className="px-3 py-2 min-h-[48px] bg-blue-600 text-white rounded-lg text-sm font-medium">
                  {currentIdx < exercises.length - 1 ? t('training.nextExercise') : t('training.finishWorkout')}
                </button>
              </div>
            )}

            {/* Mobile end workout */}
            <button
              onClick={() => { recordExerciseResult(); saveSession('partial'); handleStopCamera(); navigate('/'); }}
              className="w-full mt-2 text-xs text-white/40 hover:text-white/60 underline"
            >
              {isHe ? 'סיים אימון' : 'End workout'}
            </button>
          </div>

          {/* ZONE 3: Exercise list — scrollable bottom, z-10 */}
          <div className="flex-1 bg-gray-950 overflow-y-auto px-3 py-2 pb-[env(safe-area-inset-bottom)]" style={{ maxHeight: '40vh' }}>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {exercises.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => {
                    stopSpeech(); setCurrentIdx(i); setPhase(PHASE.IDLE); setTimer(0);
                    exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setSetsPerformance([]); setCurrentSet(1); resetAllTracking();
                  }}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition truncate max-w-[150px] ${
                    i === currentIdx ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  {i + 1}. {ex.name}
                </button>
              ))}
            </div>
            {/* Current exercise details */}
            {currentExercise && (
              <div className="bg-white/5 rounded-lg p-3 space-y-2 mt-1">
                <p className="text-white/80 text-sm">{currentExercise.description}</p>
                {currentExercise.tips && (
                  <p className="text-blue-300 text-xs">{currentExercise.tips}</p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* === FULLSCREEN LAYOUT: overlay at bottom (unchanged) === */}
      {isFullscreen && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-black/60 backdrop-blur-sm p-3 max-h-[45vh] flex flex-col pb-[env(safe-area-inset-bottom)]">
          {exercises.length > 0 && (
            <div className="space-y-2">
              {phase === PHASE.WARM_UP && currentWarmUp && (
                <div className="bg-white/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-orange-300">
                      {isHe ? 'חימום' : 'Warm-up'} ({warmUpIdx + 1}/{warmUpExercises.length})
                    </span>
                    <span className="text-xs text-white/50">{currentWarmUp.duration}{isHe ? ' שניות' : 's'}</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">{isHe ? currentWarmUp.name.he : currentWarmUp.name.en}</h2>

                  {/* Warmup instructions */}
                  {currentWarmUp.instructions && (
                    <div className="space-y-1 py-1">
                      {(isHe ? currentWarmUp.instructions.he : currentWarmUp.instructions.en).map((step, i) => (
                        <div key={i} className="flex items-start gap-2 text-white/80 text-sm">
                          <span className="text-orange-400 font-bold flex-shrink-0">{i + 1}.</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-center py-2">
                    <span className={`text-5xl font-bold ${warmUpPaused ? 'text-yellow-500 animate-pulse' : 'text-white'}`}>{warmUpTimer}</span>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {warmUpExercises.map((_, i) => (
                      <div key={i} className={`w-3 h-3 rounded-full ${i < warmUpIdx ? 'bg-green-500' : i === warmUpIdx ? 'bg-orange-400 animate-pulse' : 'bg-gray-300'}`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button onClick={handlePauseExercise} className="px-4 py-2 min-h-[44px] bg-yellow-500 text-white rounded-lg text-sm font-medium">
                      {isHe ? '⏸ השהה' : '⏸ Pause'}
                    </button>
                    <button
                      onClick={() => {
                        clearInterval(warmUpTimerRef.current);
                        if (warmUpIdx < warmUpExercises.length - 1) {
                          setWarmUpIdx(warmUpIdx + 1);
                        } else {
                          setWarmUpDone(true);
                          sessionDataRef.current.warmUpCompleted = true;
                          speakWarmUpComplete(playerName);
                          setFeedback(null);
                          setTimeout(() => setPhase(PHASE.IDLE), 2500);
                        }
                      }}
                      className="flex-1 py-2 min-h-[44px] bg-blue-600 text-white rounded-lg font-medium"
                    >
                      {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? 'הבא ▶' : 'Next ▶') : (isHe ? 'סיים חימום ▶' : 'Finish warm-up ▶')}
                    </button>
                    <button
                      onClick={() => {
                        clearInterval(warmUpTimerRef.current);
                        setWarmUpDone(true);
                        sessionDataRef.current.warmUpCompleted = true;
                        speakWarmUpComplete(playerName);
                        setFeedback(null);
                        setTimeout(() => setPhase(PHASE.IDLE), 2500);
                      }}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm border border-white/30 text-white"
                    >
                      {isHe ? 'דלג' : 'Skip'}
                    </button>
                  </div>
                </div>
              )}

              {currentExercise && phase !== PHASE.WARM_UP && (
                <div className="bg-white/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-300">{t('training.currentExercise')} ({currentIdx + 1}/{exercises.length})</span>
                    <span className="text-xs text-white/50">{totalSets} {t('dashboard.sets')} | {currentExercise.reps} {t('dashboard.reps')} | {restDuration}{t('dashboard.secRest')}</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">{currentExercise.name}</h2>
                  {setsPerformance.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/50">{t('training.setsCompleted')}:</span>
                      {setsPerformance.map((sp, i) => (
                        <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                          sp.quality === 'perfect' ? 'bg-green-500' : sp.quality === 'good' ? 'bg-blue-500' : 'bg-orange-500'
                        }`}>{i + 1}</div>
                      ))}
                      {Array.from({ length: totalSets - setsPerformance.length }, (_, i) => (
                        <div key={`r-${i}`} className="w-6 h-6 rounded-full border-2 border-white/30"></div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button onClick={handlePrevExercise} disabled={currentIdx === 0}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm disabled:opacity-30 border border-white/30 text-white">
                      {t('training.prevExercise')}
                    </button>
                    {phase === PHASE.PAUSED ? (
                      <button onClick={handleResumeExercise} className="flex-1 py-2 min-h-[44px] bg-green-500 text-white rounded-lg font-bold">
                        {isHe ? '\u25B6 \u05D4\u05DE\u05E9\u05DA' : '\u25B6 Resume'}
                      </button>
                    ) : phase === PHASE.IDLE || phase === PHASE.EXERCISE_DONE ? (
                      <button onClick={handleStartBriefing} disabled={!cameraActive || !poseReady} className="flex-1 py-2 min-h-[44px] bg-green-500 text-white rounded-lg font-medium disabled:opacity-50">
                        {t('training.startExercise')}
                      </button>
                    ) : phase === PHASE.EXERCISING ? (
                      <button onClick={handlePauseExercise} className="flex-1 py-2 min-h-[44px] bg-yellow-500 text-white rounded-lg font-medium">
                        {t('training.pauseExercise')}
                      </button>
                    ) : null}
                    <button onClick={handleNextExercise} className="px-4 py-2 min-h-[44px] bg-blue-600 text-white rounded-lg text-sm">
                      {currentIdx < exercises.length - 1 ? t('training.nextExercise') : t('training.finishWorkout')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 overflow-x-auto pb-1">
                {exercises.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      stopSpeech(); setCurrentIdx(i); setPhase(PHASE.IDLE); setTimer(0);
                      exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setSetsPerformance([]); setCurrentSet(1); resetAllTracking();
                    }}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      i === currentIdx ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {i + 1}. {ex.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === DESKTOP LAYOUT: normal flow below camera === */}
      {!isFullscreen && !isMobile && (
        <div>
          {cameraError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{t('training.cameraError')}: {cameraError}</div>
          )}

          {exercises.length === 0 ? (
            <div className="text-center text-gray-500 py-8">{t('training.noExercises')}</div>
          ) : (
            <div className="space-y-3">
              {phase === PHASE.WARM_UP && currentWarmUp && (
                <div className="bg-white rounded-xl shadow-lg p-5 border-2 border-orange-500 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-orange-600">
                      {isHe ? 'חימום' : 'Warm-up'} ({warmUpIdx + 1}/{warmUpExercises.length})
                    </span>
                    <span className="text-xs text-gray-400">{currentWarmUp.duration}{isHe ? ' שניות' : 's'}</span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-800">{isHe ? currentWarmUp.name.he : currentWarmUp.name.en}</h2>
                  {currentWarmUp.instructions ? (
                    <div className="space-y-1 py-1">
                      {(isHe ? currentWarmUp.instructions.he : currentWarmUp.instructions.en).map((step, i) => (
                        <div key={i} className="flex items-start gap-2 text-gray-600 text-sm">
                          <span className="text-orange-500 font-bold flex-shrink-0">{i + 1}.</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">{isHe ? currentWarmUp.description.he : currentWarmUp.description.en}</p>
                  )}
                  <div className="flex items-center justify-center py-2">
                    <span className={`text-5xl font-bold ${warmUpPaused ? 'text-yellow-500 animate-pulse' : 'text-gray-800'}`}>{warmUpTimer}</span>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {warmUpExercises.map((_, i) => (
                      <div key={i} className={`w-3 h-3 rounded-full ${i < warmUpIdx ? 'bg-green-500' : i === warmUpIdx ? 'bg-orange-400 animate-pulse' : 'bg-gray-300'}`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button onClick={handlePauseExercise} className="px-4 py-2 min-h-[44px] bg-yellow-500 text-white rounded-lg text-sm font-medium">
                      {isHe ? '⏸ השהה' : '⏸ Pause'}
                    </button>
                    <button
                      onClick={() => {
                        clearInterval(warmUpTimerRef.current);
                        if (warmUpIdx < warmUpExercises.length - 1) {
                          setWarmUpIdx(warmUpIdx + 1);
                        } else {
                          setWarmUpDone(true);
                          sessionDataRef.current.warmUpCompleted = true;
                          speakWarmUpComplete(playerName);
                          setFeedback(null);
                          setTimeout(() => setPhase(PHASE.IDLE), 2500);
                        }
                      }}
                      className="flex-1 py-2 min-h-[44px] bg-blue-600 text-white rounded-lg font-medium"
                    >
                      {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? 'הבא ▶' : 'Next ▶') : (isHe ? 'סיים חימום ▶' : 'Finish warm-up ▶')}
                    </button>
                    <button
                      onClick={() => {
                        clearInterval(warmUpTimerRef.current);
                        setWarmUpDone(true);
                        sessionDataRef.current.warmUpCompleted = true;
                        speakWarmUpComplete(playerName);
                        setFeedback(null);
                        setTimeout(() => setPhase(PHASE.IDLE), 2500);
                      }}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm border border-gray-300 text-gray-500"
                    >
                      {isHe ? 'דלג' : 'Skip'}
                    </button>
                  </div>
                </div>
              )}

              {currentExercise && phase !== PHASE.WARM_UP && (
                <div className="bg-white rounded-xl shadow-lg p-5 border-2 border-blue-500 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-600">{t('training.currentExercise')} ({currentIdx + 1}/{exercises.length})</span>
                    <span className="text-xs text-gray-400">{totalSets} {t('dashboard.sets')} | {currentExercise.reps} {t('dashboard.reps')} | {restDuration}{t('dashboard.secRest')}</span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-800">{currentExercise.name}</h2>
                  <p className="text-sm text-gray-500">{currentExercise.description}</p>
                  <div className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
                    {LOCATION_ICONS[currentLocation]} {locationProps.setup}
                  </div>
                  {currentExercise.tips && <p className="text-xs text-blue-500">{currentExercise.tips}</p>}
                  {setsPerformance.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{t('training.setsCompleted')}:</span>
                      {setsPerformance.map((sp, i) => (
                        <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                          sp.quality === 'perfect' ? 'bg-green-500' : sp.quality === 'good' ? 'bg-blue-500' : 'bg-orange-500'
                        }`}>{i + 1}</div>
                      ))}
                      {Array.from({ length: totalSets - setsPerformance.length }, (_, i) => (
                        <div key={`r-${i}`} className="w-6 h-6 rounded-full border-2 border-gray-200"></div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button onClick={handlePrevExercise} disabled={currentIdx === 0}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm disabled:opacity-30 border border-gray-300">
                      {t('training.prevExercise')}
                    </button>
                    {phase === PHASE.PAUSED ? (
                      <button onClick={handleResumeExercise} className="flex-1 py-2 min-h-[44px] bg-green-500 text-white rounded-lg font-bold">
                        {isHe ? '\u25B6 \u05D4\u05DE\u05E9\u05DA' : '\u25B6 Resume'}
                      </button>
                    ) : phase === PHASE.IDLE || phase === PHASE.EXERCISE_DONE ? (
                      <button onClick={handleStartBriefing} disabled={!cameraActive || !poseReady} className="flex-1 py-2 min-h-[44px] bg-green-500 text-white rounded-lg font-medium disabled:opacity-50">
                        {t('training.startExercise')}
                      </button>
                    ) : phase === PHASE.EXERCISING ? (
                      <button onClick={handlePauseExercise} className="flex-1 py-2 min-h-[44px] bg-yellow-500 text-white rounded-lg font-medium">
                        {t('training.pauseExercise')}
                      </button>
                    ) : null}
                    <button onClick={handleNextExercise} className="px-4 py-2 min-h-[44px] bg-blue-600 text-white rounded-lg text-sm">
                      {currentIdx < exercises.length - 1 ? t('training.nextExercise') : t('training.finishWorkout')}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                {exercises.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      stopSpeech(); setCurrentIdx(i); setPhase(PHASE.IDLE); setTimer(0);
                      exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setSetsPerformance([]); setCurrentSet(1); resetAllTracking();
                    }}
                    className={`text-start p-3 rounded-lg border transition ${
                      i === currentIdx ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-800 truncate max-w-[70%]">{i + 1}. {ex.name}</span>
                      <span className="text-xs text-gray-400">{ex.sets}x{ex.reps}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Level-Up Modal for longevity (51+) athletes */}
      {showLevelUpModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm text-center space-y-4">
            <div className="text-4xl">{'\u26A1'}</div>
            <h3 className="text-xl font-bold">
              {isHe ? 'אתה מוכן ליותר!' : "You're ready for more!"}
            </h3>
            <p className="text-gray-600">
              {isHe ? 'הביצועים שלך מצוינים. רוצה לנסות תרגילים מתקדמים יותר?' : 'Your performance is excellent. Want to try more advanced exercises?'}
            </p>
            <div className="flex gap-3">
              <button onClick={async () => {
                await updateDoc(doc(db, 'users', user.uid), { unlockedPerformance: true });
                setShowLevelUpModal(false);
                speakPriority(isHe ? 'מעולה! מהסט הבא נעבור לתרגילים מתקדמים!' : "Awesome! Starting next set with advanced exercises!");
              }} className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold">
                {isHe ? 'יאללה!' : "Let's go!"}
              </button>
              <button onClick={() => setShowLevelUpModal(false)} className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium">
                {isHe ? 'לא עכשיו' : 'Not now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
