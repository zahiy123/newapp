import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useCamera } from '../hooks/useCamera';
import { usePose } from '../hooks/usePose';
import { useSpeech } from '../hooks/useSpeech';
import { useObjectDetection, classifyDetectedObjects } from '../hooks/useObjectDetection';
import { useBallDetection } from '../hooks/useBallDetection';
import { useEquipmentDetection } from '../hooks/useEquipmentDetection';
import { useAICoach } from '../hooks/useAICoach';
import { useHaikuVision } from '../hooks/useHaikuVision';
import { findObstacles, obstacleMessage, LABEL_HE } from '../engine/environmentHazards';
import { planWarmUp, needsBallQuestion } from '../engine/warmupPlanner';
import { getLimbProfile, trainingLimbs } from '../engine/limbProfile';
import WarmupGhostPanel from '../components/WarmupGhostPanel';
import GhostOverlay from '../components/GhostOverlay';
import ExecutionHud from '../components/ExecutionHud';
import { viewPromptText } from '../engine/training/viewPrompts';
import { useExpertExecution, buildExecutionProfile } from '../hooks/training/useExpertExecution';
import { showsRangeGauge } from '../engine/training/rangeGauge';
import { demoGhostFor } from '../engine/training/demoGhost';
import { makeTimedAnalyzer } from '../engine/training/timedAnalyzer';
import { makeProfileRepAnalyzer, withRepOffset } from '../engine/training/profileRepAnalyzer';
import CoachAvatar, { CoachPreview } from '../components/CoachAvatar';
import TrainingViewControls from '../components/TrainingViewControls';
import { coachMode, COACH_IDS } from '../engine/coachAvatar';
import { setCoachVoice } from '../hooks/useSpeech';
import { useVoiceCommand } from '../hooks/useVoiceCommand';
import { READY_DRIVE, withDrive, splitLegOrder, legLabel, splitStartText, splitSwitchText, splitWorkingSide, setLegHalf, legSetStartText, legSetNextText } from '../engine/training/coachFlow';
import { exerciseNeedsSetup } from '../engine/training/exerciseSetup';
import DailyCheckIn from '../components/DailyCheckIn';
import { applyCheckIn } from '../engine/training/dailyCheckIn';
import { catalogGhostSpec } from '../engine/catalog/catalog';
import { rebuildPlanFromCatalog, planContext } from '../engine/catalog/planBuilder';
import { availableEquipment, fitExercises, needsBall } from '../engine/exercise/equipmentFit';
import { sportContextsFor } from '../engine/sports/sportLibrary';
import ValidationPanel from '../components/ValidationPanel';
import { readValidationMode, saveLabelledClip } from '../services/validationStore';
import { FEATURES } from '../config/features';
import { CHALLENGE_MOVES, createRangeChallenge, updateRangeChallenge, createPeakTracker, trackPeak, shoulderAngle } from '../engine/rangeProgression';
import { detectActivity, requiredPointsFor } from '../engine/warmupActivity';
import { createAccuracyTracker, retargetAccuracyTracker, updateAccuracy, accuracyLevel } from '../engine/movementAccuracy';
import { getAnalyzer, getLocationProps, getWarmUpExercises, getDisabilityContext, getCalibrationAngles, checkOrientation, checkPerspective, checkMovementQuality, ORIENTATION, WARMUP_STABILIZER_CONFIG } from '../utils/exerciseAnalysis';
import { LandmarkStabilizer, computeJointAngles, computeSymmetryScore, computeStabilityScore, detectMovementPhase, buildPerformanceReport, evaluateSetPerformance, getSportProfile, runSafetyCheck, generateCoachFeedback } from '../utils/motionEngine';

import { estimateCalories } from '../utils/calorieEstimator';
import ROMGauge from '../components/ROMGauge';
import WorkoutSummary from '../components/WorkoutSummary';
import { db } from '../services/firebase';
import { doc, getDoc, addDoc, updateDoc, collection, Timestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl, authFetch, fetchWithTimeout } from '../utils/api';
import { markDayCompleted, sanitizePlan, saveActiveWorkout, loadActiveWorkout, clearActiveWorkout, queuePendingSession } from '../utils/workoutStorage';
import { incrementWeeklySession } from '../utils/weeklyGoals';
import { getExerciseInstruction, getWarmUpInstruction } from '../utils/exerciseInstructions';
import { drawFormCorrection } from '../utils/canvasDrawing';

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

// ── Pre-workout environment scan (Stage 2.2) ──
// Runs once per workout, BEFORE the warm-up. Never blocks: hazards are announced with a
// suggestion to move them + an own-responsibility notice, then the workout continues.
// Warm-up timer resolution: counts real moving time in 200 ms steps (reacts within a fraction of a second)
const WARM_UP_TICK_MS = 200;

const ENV_SCAN_COLLECT_MS = 3000;      // local object detection window
const ENV_VISION_TIMEOUT_MS = 8000;    // max wait for the AI hazard analysis
const ENV_SAFE_CONTINUE_SEC = 3;       // no hazards → short confirmation, then warm-up
const ENV_HAZARD_CONTINUE_SEC = 12;    // hazards → time to move the object, then warm-up

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
  // Daily check-in (where / ball / prosthesis or crutches TODAY) → the effective profile of this workout
  const [checkIn, setCheckIn] = useState(null);
  const todayProfile = useMemo(() => applyCheckIn(userProfile, checkIn), [userProfile, checkIn]);
  const planSourceRef = useRef(null);       // { plan, data, weekIdx, dayIdx } — rebuilt after the check-in
  const currentLocation = todayProfile?.trainingLocation || todayProfile?.currentLocation || 'field';
  const locationProps = getLocationProps(currentLocation, isHe, userProfile?.sport);

  const beforeDrawRef = useRef(null);
  const amputationProfile = useMemo(() => ({
    disability: userProfile?.disability || 'none',
    amputationSide: userProfile?.amputationSide || 'none',
    amputationLevel: userProfile?.amputationLevel || '',
  }), [userProfile?.disability, userProfile?.amputationSide, userProfile?.amputationLevel]);
  const { videoRef, active: cameraActive, error: cameraError, start: startCamera, stop: stopCamera } = useCamera();
  const { ready: poseReady, landmarks, landmarksRef: poseLandmarksRef, startLoop, stopLoop } = usePose(canvasRef, beforeDrawRef, amputationProfile);
  const { ready: objReady, detectedObjects, startLoop: startObjLoop, stopLoop: stopObjLoop, hasEquipment, scanEnvironment, captureFrame } = useObjectDetection();
  const { ready: ballReady, getBallData, startLoop: startBallLoop, stopLoop: stopBallLoop } = useBallDetection(userProfile?.sport);
  const { ready: equipReady, getEquipmentData, getBallData: getEquipBallData, startLoop: startEquipLoop, stopLoop: stopEquipLoop } = useEquipmentDetection(userProfile?.sport);

  // Unified ball data: prefer equipment model (16-class), fall back to dedicated ball model
  const getBallDataUnified = useCallback(() => {
    if (equipReady) return getEquipBallData();
    return getBallData();
  }, [equipReady, getEquipBallData, getBallData]);

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
    playAchievementDing,
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

  // Track active poll intervals for cleanup on unmount
  const pollIntervalsRef = useRef(new Set());

  // Poll until speech finishes, then call callback (safety: 10s max)
  function pollSpeechEnd(callback) {
    const poll = setInterval(() => {
      if (!isSpeaking()) {
        clearInterval(poll);
        pollIntervalsRef.current.delete(poll);
        callback();
      }
    }, 200);
    pollIntervalsRef.current.add(poll);
    setTimeout(() => { clearInterval(poll); pollIntervalsRef.current.delete(poll); }, 10000);
  }

  // Cleanup all poll intervals on unmount
  useEffect(() => {
    return () => { pollIntervalsRef.current.forEach(id => clearInterval(id)); };
  }, []);

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
        speakCritical(`${alreadySaid(repNumber) ? '' : `${repNumber}. `}${aiFeedback}`, { rate: 1.3 });
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
      fullSpeech = `${alreadySaid(repNumber) ? '' : `${repNumber}. `}${aiFeedback}${nextCmd}`;
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
  const [envScanRun, setEnvScanRun] = useState(0);         // bump to re-run the scan ("I moved it")
  const [envCountdown, setEnvCountdown] = useState(null);  // seconds until the warm-up starts
  const environmentScannedRef = useRef(false);
  const poseLoopStartedRef = useRef(false);

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
  const [phase, _setPhaseRaw] = useState(PHASE.IDLE);
  const phaseRef = useRef(PHASE.IDLE);
  const setPhase = useCallback((newPhase) => {
    console.log('[Phase Change]', phaseRef.current, '→', newPhase);
    phaseRef.current = newPhase;
    _setPhaseRaw(newPhase);
  }, []);
  const [timer, setTimer] = useState(0);
  const [activeTimer, setActiveTimer] = useState(0);
  const [workoutDone, setWorkoutDone] = useState(false);

  // Readiness rating (pre-workout)
  const [readinessRating, setReadinessRating] = useState(0); // 0 = not set, 1-5
  const [readinessApplied, setReadinessApplied] = useState(false);

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
  // Manual moves only (owner): a finished warm-up move WAITS for the trainee ("next" tap / voice)
  const [warmUpAwaitNext, setWarmUpAwaitNext] = useState(false);
  // The virtual coach chosen in the check-in (male / female / none), remembered on this device
  const [coachChoice, setCoachChoice] = useState(() => {
    try { const c = localStorage.getItem('coachChoice'); return c === 'male' || c === 'female' ? c : 'none'; } catch { return 'none'; }
  });
  const [coachCheer, setCoachCheer] = useState(false);
  const [coachPicked, setCoachPicked] = useState(() => {
    try { return localStorage.getItem('coachChoice') !== null; } catch { return false; }
  });
  const chooseCoach = (c) => {
    const v = COACH_IDS.includes(c) ? c : 'none';
    setCoachChoice(v);
    setCoachPicked(true);
    try { localStorage.setItem('coachChoice', v); } catch { /* storage unavailable */ }
  };
  const warmUpStateRef = useRef({});
  const warmUpTimerRef = useRef(null);
  const lastWarmUpNudgeRef = useRef(0);
  const lastWarmUpCorrectionRef = useRef(0);

  // Adaptive warm-up list based on profile limitations
  // Warm-up (Stage 2.3): planned from the scan's per-limb profile + track + ball availability
  const [ballAnswer, setBallAnswer] = useState(null);          // null = not asked, true/false = answer
  const [showBallQuestion, setShowBallQuestion] = useState(false);
  const [warmUpGhostOn, setWarmUpGhostOn] = useState(true);    // ghost shown by default in the warm-up
  // The limbs AS THEY TRAIN: on crutches the prosthesis is not worn (safety — trainingLimbs)
  const limbProfile = useMemo(() => trainingLimbs(getLimbProfile(todayProfile), todayProfile?.todayMobility), [todayProfile]);
  const warmUpExercises = useMemo(() => planWarmUp(todayProfile, { hasBall: typeof ballAnswer === 'boolean' ? ballAnswer : todayProfile?.hasBall === true }), [todayProfile, ballAnswer]);

  // Ghost Overlay & Progressive Range Challenge (opt-in, behind FEATURES.GHOST_OVERLAY).
  // 'panel' = the stable demo panel (checkpoint-stage2-stable) and the default; 'overlay' = full-size on the body.
  const [ghostMode, setGhostMode] = useState(() => {
    if (!FEATURES.GHOST_OVERLAY) return 'panel';
    try { return localStorage.getItem('ghostModeV3') === 'panel' ? 'panel' : 'overlay'; }   // default: full overlay
    catch { return 'overlay'; }
  });
  const overlayActive = FEATURES.GHOST_OVERLAY && ghostMode === 'overlay';
  const [rangeTarget, setRangeTarget] = useState(null);     // current challenge target (deg) or null
  // Direction of two-way moves (arm circles): forward for the first half, backward for the second
  const [ghostDirection, setGhostDirection] = useState('forward');
  const directionSwitchedRef = useRef(false);
  const [rangeFlash, setRangeFlash] = useState(false);       // brief green flash when the target widens
  const [liveMoving, setLiveMoving] = useState(false);       // on-screen "movement detected" indicator
  const activityStateRef = useRef({});
  // Required limbs (arms / upper body / working leg) must be IN VIEW before anything counts
  const limbsInViewRef = useRef(false);
  const [missingPart, setMissingPart] = useState(null);     // 'legs' | 'arms' | 'upper' | null
  const lastViewPromptRef = useRef(0);
  const warmUpDriveRef = useRef(Math.floor(Math.random() * 6));   // rotating energy lines
  const warmUpMovingMsRef = useRef(0);                      // accumulated moving time toward the next second
  // Real-time accuracy vs. the Ghost (range + position overlap), shown next to the movement indicator
  const [accuracy, setAccuracy] = useState(null);           // 0-100 or null
  const accuracyRef = useRef(null);                         // tracker
  const accuracyShownRef = useRef({ value: null, at: 0, ema: null });
  const rangeRef = useRef(null);                            // range challenge state for this exercise
  const peakRef = useRef(createPeakTracker());
  const rangeFailedRef = useRef(false);                     // challenge disabled after a runtime error
  const setGhostModeSaved = useCallback((mode) => {
    setGhostMode(mode);
    try { localStorage.setItem('ghostModeV3', mode); } catch { /* storage unavailable */ }
  }, []);
  // SAFETY: an overlay runtime error → back to the stable panel (and remembered)
  const handleOverlayError = useCallback((err) => {
    setGhostMode('panel');
    setFeedback({ type: 'info', text: isHe ? `הצללית הגדולה נתקלה בשגיאה — מציג את הקטנה (${String(err?.message || err).slice(0, 60)})` : `Big Ghost error — showing the small one (${String(err?.message || err).slice(0, 60)})` });
  }, [isHe]);
  // Ghost spec with the current challenge target (the Ghost peaks at the target)
  const ghostSpec = useMemo(() => {
    const g = warmUpExercises[warmUpIdx]?.ghost;
    if (!g) return null;
    const withTarget = rangeTarget ? { ...g, targetDeg: rangeTarget, romCapDeg: rangeTarget } : g;
    return g.directional ? { ...withTarget, direction: ghostDirection } : withTarget;
  }, [warmUpExercises, warmUpIdx, rangeTarget, ghostDirection]);
  // Name + steps of a warm-up exercise: the planner's own (scan-adapted) text first, then the static map
  const warmUpInfo = (ex) => (ex?.spokenSteps
    ? { name: isHe ? ex.name.he : ex.name.en, steps: isHe ? ex.spokenSteps.he : ex.spokenSteps.en }
    : getWarmUpInstruction(ex?.id));
  const disabilityCtx = useMemo(() => getDisabilityContext(userProfile), [userProfile]);

  // Warm-up pause state
  const warmUpPausedRef = useRef(false);
  const [warmUpPaused, setWarmUpPaused] = useState(false);
  const warmUpReExplainedRef = useRef(false);
  const warmUpInactivityStartRef = useRef(0);

  // Per-rep AI score tracking for adaptive coaching
  const repScoresRef = useRef([]);
  // Per-exercise history from Firestore (loaded once at training init)
  const exerciseHistoryRef = useRef({});

  // Set grade display (A+/A/B) — shown briefly after set completion
  const [setGrade, setSetGrade] = useState(null); // { grade: 'A+', color: '#...' }
  const gradeTimerRef = useRef(null);

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
  // Warm-up: light smoothing — the heavy exercise smoothing hid small (seated) movements
  const warmUpStabilizerRef = useRef(new LandmarkStabilizer(WARMUP_STABILIZER_CONFIG));
  const standSuggestedRef = useRef(false);  // "let's try standing" offered once per exercise
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
  const rawExercisesRef = useRef([]);      // the day's exercises before the equipment fit
  const aiSummaryRef = useRef(null);

  // Build the day's exercises from the plan for TODAY's reality (check-in answers; null = profile defaults)
  function buildTodayExercises(src, status) {
    const { plan, data, weekIdx, dayIdx } = src;
    const eff = applyCheckIn(data, status);
    const week = plan.weeks[weekIdx];
    const sport = data.sport || plan.sport || 'fitness';
    let loaded = null;
    if (FEATURES.CATALOG_PLANS) {
      // Coherent catalog session for this day (same builder + seed as the dashboard), for today's body / ball / place
      try {
        const lp = trainingLimbs(getLimbProfile(eff), eff.todayMobility);
        const built = rebuildPlanFromCatalog(plan, planContext(eff, lp, user.uid), (data.language || 'he') === 'he');
        loaded = built.weeks[weekIdx]?.days?.[dayIdx]?.exercises || [];
        sessionDataRef.current.sessionGoal = built.weeks[weekIdx]?.days?.[dayIdx]?.goal || null;
      } catch (err) {
        console.error('[Catalog] session build failed — using the AI exercises:', err);
        loaded = null;
      }
    }
    if (!loaded?.length) {
      const sanitized = sanitizePlan({ weeks: [{ days: [{ exercises: week.days[dayIdx].exercises || [] }] }] }, sport, data.age || userProfile?.age);
      loaded = sanitized.weeks[0].days[0].exercises || [];
    }
    // HARD equipment fit: never offer an exercise the trainee can't do (e.g. a ball drill without a ball)
    rawExercisesRef.current = loaded;
    return fitExercises(loaded, availableEquipment(eff, { hasBall: status?.hasBall })).exercises;
  }

  // Check-in answered → rebuild today's workout from the answers, remember them for next time
  function handleCheckInDone(status) {
    setCheckIn(status);
    setCoachChoice(COACH_IDS.includes(status.coach) ? status.coach : 'none');
    setCoachPicked(true);
    sessionDataRef.current.checkIn = status;
    if (typeof status.hasBall === 'boolean') setBallAnswer(status.hasBall);   // no separate ball question
    if (planSourceRef.current) setExercises(buildTodayExercises(planSourceRef.current, status));
    if (user?.uid) updateDoc(doc(db, 'users', user.uid), { lastCheckIn: status }).catch(err => console.error('[CheckIn] save failed:', err));
  }

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

      planSourceRef.current = { plan, data, weekIdx, dayIdx };
      setExercises(buildTodayExercises(planSourceRef.current, null));
      resetVisionSession();

      // Load per-exercise score history from Firestore (last 5 workouts)
      try {
        const histQ = query(
          collection(db, 'users', user.uid, 'workouts'),
          orderBy('date', 'desc'),
          limit(5)
        );
        const histSnap = await getDocs(histQ);
        const history = {};
        histSnap.docs.forEach(d => {
          const wData = d.data();
          (wData.exercises || []).forEach(ex => {
            if (ex.avgScore > 0) {
              if (!history[ex.name]) history[ex.name] = [];
              history[ex.name].push({ score: ex.avgScore, date: wData.date?.toDate?.() || new Date() });
            }
          });
        });
        exerciseHistoryRef.current = history;
      } catch (err) {
        console.error('Failed to load exercise history:', err);
      }

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
  const earlyStartPhase = phase === PHASE.BRIEFING || phase === PHASE.CHECKING_EQUIPMENT
    || phase === PHASE.CALIBRATING || phase === PHASE.EXERCISING;
  // Reps (kicks) done before the exercise phase began → carried into the count
  const earlyOffsetRef = useRef(0);
  // The count is spoken the moment a rep is done — once per number (per exercise / set)
  const spokenCountRef = useRef({ n: 0 });
  /** Say the rep number right now (cuts an explanation in progress) — each number once. */
  function speakCountNow(n) {
    if (!(n > spokenCountRef.current.n)) return;
    spokenCountRef.current.n = n;
    speakCount(n);
  }
  const alreadySaid = (n) => n <= spokenCountRef.current.n;
  currentExerciseRef.current = currentExercise;

  // Stage 3.1 — Expert Execution Profile of the current exercise (isolated module, behind a flag):
  // required limbs in the frame, kinematic errors / danger, accuracy, and the Ghost of the same profile
  const exerciseCueKey = useMemo(
    () => (currentExercise ? getAnalyzer(currentExercise.name).cueKey : null),
    [currentExercise?.name],
  );
  // Sport contexts (rehab / rehab + sport / sport) layer sport-specific technique on every profile
  const sportContexts = useMemo(
    () => sportContextsFor(userProfile),
    [userProfile?.sport, userProfile?.trainingTrack, userProfile?.rehabSport],
  );
  // Validation dataset (Stage 3.1): `?validate=1` records each rep and asks "good / fault" after the set
  const [validationMode] = useState(() => readValidationMode(window.location.search));
  const [validationSet, setValidationSet] = useState(null);       // { clips, profile } awaiting labels
  const handleValidationClips = useCallback((clips, profile) => setValidationSet({ clips, profile }), []);
  const handleValidationDone = useCallback((items) => {
    setValidationSet(null);
    if (!user?.uid || !items.length) return;
    Promise.all(items.map(it => saveLabelledClip(user.uid, it.clip, it.label, it.faults)))
      .then(() => setFeedback({ type: 'info', text: isHe ? `נשמרו ${items.length} חזרות למאגר האימות` : `Saved ${items.length} reps to the validation set` }))
      .catch(err => console.error('[Validation] save failed:', err));
  }, [user?.uid, isHe]);
  const execution = useExpertExecution({
    // From the briefing on: the trainee may start working while the coach still explains —
    // the module counts silently and the exercise starts at once (early start, below)
    enabled: FEATURES.EXPERT_PROFILE && earlyStartPhase,
    counting: earlyStartPhase,
    quiet: phase === PHASE.BRIEFING || phase === PHASE.CHECKING_EQUIPMENT,
    playerName,
    cueKey: exerciseCueKey,
    exerciseName: currentExercise?.name,
    catalogId: currentExercise?.catalogId || null,
    sportContexts,
    limbProfile,
    landmarksRef: poseLandmarksRef,
    isHe,
    speakPriority,
    recordClips: validationMode,
    onClips: handleValidationClips,
  });
  const executionInViewRef = execution.inViewRef;
  // Exact counting source for the analyzer wrapper (expert rep exercises only)
  const profileRepsRef = useRef({ active: false, countRef: null });
  profileRepsRef.current = {
    active: execution.active && execution.profile?.precision === 'expert' && execution.profile?.kind === 'reps',
    countRef: execution.repCountRef,
  };
  const workingSourceRef = useRef(execution);
  workingSourceRef.current = execution;

  // Demo Ghost of the exercise: from the briefing right after the warm-up, through the
  // calibration, and during the exercise — generated from the SAME execution profile that is
  // measured. On by default (remembered per device).
  const [exerciseGhostOn, setExerciseGhostOn] = useState(() => {
    try { return localStorage.getItem('exerciseGhostOn') !== '0'; } catch { return true; }
  });
  const demoGhostPhase = phase === PHASE.BRIEFING || phase === PHASE.CHECKING_EQUIPMENT
    || phase === PHASE.CALIBRATING || phase === PHASE.EXERCISING || phase === PHASE.RESTING;
  const demoProfile = useMemo(
    () => (FEATURES.EXPERT_PROFILE && demoGhostPhase
      ? (execution.profile || buildExecutionProfile(exerciseCueKey, currentExercise?.name, limbProfile, sportContexts, currentExercise?.catalogId || null))
      : null),
    [demoGhostPhase, execution.profile, exerciseCueKey, currentExercise?.name, limbProfile, sportContexts],
  );
  // The profile's Ghost, or the matching animated movement for exercises without an expert model yet
  // Split balance sets (both legs): which half of the set we are in — the Ghost stands on the same leg
  const [splitHalf, setSplitHalf] = useState(1);
  const splitOrder = useMemo(() => splitLegOrder(limbProfile), [limbProfile]);
  const splitSupport = splitHalf === 1 ? splitOrder.first : splitOrder.second;
  const demoGhostSpec = useMemo(() => {
    if (!demoGhostPhase) return null;
    // A catalog exercise always has its Ghost (its pattern × variation)
    const cid = currentExercise?.catalogId;
    let spec = cid ? catalogGhostSpec(cid, demoProfile?.catalogId === cid ? demoProfile : null) : demoGhostFor(demoProfile, exerciseCueKey);
    if (spec?.profile && currentExercise?.sideSwitch) {
      // this half's working leg: the kicking leg (kicks) or the free leg while standing on the other
      spec = { ...spec, profile: { ...spec.profile, ghost: { ...spec.profile.ghost, workingSide: splitWorkingSide(limbProfile, splitHalf, currentExercise.splitMode) } } };
    }
    return spec;
  }, [demoGhostPhase, demoProfile, exerciseCueKey, currentExercise?.catalogId, currentExercise?.sideSwitch, currentExercise?.splitMode, splitHalf, limbProfile]);
  const showDemoGhost = exerciseGhostOn && !!demoGhostSpec;
  // ROM gauge only for dynamic range-of-motion exercises (never static holds / ball drills / kicks / running)
  const showRomGauge = useMemo(() => {
    if (!currentExercise) return false;
    const a = getAnalyzer(currentExercise.name);
    const kind = buildExecutionProfile(a.cueKey, currentExercise.name, limbProfile, sportContexts, currentExercise.catalogId || null)?.kind;
    return showsRangeGauge({ analyzerType: a.type, profileKind: kind, exerciseName: currentExercise.name });
  }, [currentExercise?.name, limbProfile, sportContexts]);
  // "Ghost: big" = full size ON the body in every exercise (standing or on the floor): its size
  // follows the trainee's body / distance from the camera, its hips sit on the trainee's hips
  // shown on the body from the briefing on (no waiting for the exercise phase)
  const demoOnBody = overlayActive && demoGhostPhase;
  const demoLarge = false;
  const demoLabel = demoProfile?.precision === 'expert'
    ? (isHe ? `הדגמה: ${demoProfile.name.he}` : `Demo: ${demoProfile.name.en}`)
    : (isHe ? `הדגמה: ${currentExercise?.name || ''}` : `Demo: ${currentExercise?.nameEn || currentExercise?.name || ''}`);

  // Set up analyzer when exercise changes
  useEffect(() => {
    if (currentExercise) {
      const { analyze, type, cueKey, ballAware } = getAnalyzer(currentExercise.name);
      // Timed catalog exercises (intervals / holds): the target is seconds of REAL work, not reps.
      // Rep exercises: the count comes from the exact profile rep detector when there is one.
      const isWorking = () => !workingSourceRef.current?.active || workingSourceRef.current.workingRef.current;
      analyzerRef.current = currentExercise.timed
        ? { analyze: makeTimedAnalyzer(analyze, isWorking), type: 'hold', cueKey, ballAware }
        : { analyze: withRepOffset(makeProfileRepAnalyzer(analyze, profileRepsRef), earlyOffsetRef), type, cueKey, ballAware };
      earlyOffsetRef.current = 0;
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

  // Split balance sets: each set starts on the base leg; at half of the set's work the coach calls
  // the switch (clear voice), the Ghost changes legs and the chip shows the second half
  useEffect(() => {
    if (phase !== PHASE.EXERCISING || !currentExercise?.sideSwitch) return undefined;
    // Kicks / passes: a full set per leg — odd sets the base leg, even sets the other leg
    const perSet = currentExercise.splitBy === 'set';
    setSplitHalf(perSet ? setLegHalf(currentSet) : 1);
    const text = perSet
      ? legSetStartText(limbProfile, isHe, currentExercise.splitMode, currentSet)
      : splitStartText(limbProfile, isHe, currentExercise.splitMode);
    const tm = setTimeout(() => speakPriority(text, { rate: 1.1 }), 900);
    return () => clearTimeout(tm);
  }, [phase, currentSet, currentIdx]);

  useEffect(() => {
    if (phase !== PHASE.EXERCISING || !currentExercise?.sideSwitch || currentExercise.splitBy === 'set' || splitHalf !== 1) return;
    const target = parseInt(currentExercise.reps, 10) || 0;
    if (target > 1 && displayReps >= Math.ceil(target / 2)) {
      setSplitHalf(2);
      speakPriority(splitSwitchText(limbProfile, isHe, currentExercise.splitMode), { rate: 1.1 });
      setFeedback({ type: 'info', text: isHe ? '🔄 החלף רגל!' : '🔄 Switch legs!' });
    }
  }, [displayReps, phase, splitHalf]);

  // The coach's voice follows the chosen character
  useEffect(() => { setCoachVoice(coachChoice); }, [coachChoice]);
  // The coach claps for a finished set / exercise (3 s), then stands ready
  useEffect(() => {
    if (phase !== PHASE.RESTING && phase !== PHASE.EXERCISE_DONE) return undefined;
    setCoachCheer(true);
    const tm = setTimeout(() => setCoachCheer(false), 3000);
    return () => { clearTimeout(tm); setCoachCheer(false); };
  }, [phase, currentSet]);

  // "Next" by voice — ONLY while waiting for the trainee's decision (a finished warm-up move or exercise)
  const goNextWarmUp = () => {
    clearInterval(warmUpTimerRef.current);
    setWarmUpAwaitNext(false);
    if (warmUpIdx < warmUpExercises.length - 1) setWarmUpIdx(warmUpIdx + 1);
    else finishWarmUp();
  };
  const voiceNextAction = phase === PHASE.WARM_UP && warmUpAwaitNext ? 'warmup'
    : phase === PHASE.EXERCISE_DONE ? 'exercise' : null;
  const voiceNext = useVoiceCommand({
    active: !!voiceNextAction,
    lang: isHe ? 'he-IL' : 'en-US',
    isSpeaking,
    onNext: () => {
      if (voiceNextAction === 'warmup') goNextWarmUp();
      else if (voiceNextAction === 'exercise') handleNextExercise();
    },
  });

  // A new set / exercise counts from zero again
  useEffect(() => { if (displayReps === 0) spokenCountRef.current.n = 0; }, [displayReps, currentIdx, currentSet]);

  // EARLY START (owner): the trainee started working while the coach was still explaining /
  // before the start countdown ended → the exercise starts NOW. The explanation is cut to one
  // short line; reps already done are counted and said at once (never wait for the talk to end).
  useEffect(() => {
    if (phase !== PHASE.BRIEFING && phase !== PHASE.CHECKING_EQUIPMENT && phase !== PHASE.CALIBRATING) return undefined;
    const id = setInterval(() => {
      const ex = workingSourceRef.current;
      if (!ex?.active || !ex.earlyRef?.current) return;
      clearInterval(id);
      const kind = ex.profile?.kind;
      const early = kind === 'reps' ? (ex.repCountRef.current || 0) : kind === 'strike' ? (ex.strikeCountRef.current || 0) : 0;
      if (kind === 'strike') earlyOffsetRef.current = early;    // the kick analyzer counts on from here
      calibrationDataRef.current = null;
      commandPhaseRef.current = 'IDLE';                          // no rep-by-rep commands over the work
      sittingWarnedRef.current = false;
      setPhase(PHASE.EXERCISING);
      setTimer(0);
      lastActivityRef.current = Date.now();
      exerciseStartTimeRef.current = Date.now();
      lastNudgeTimeRef.current = 0;
      const line = isHe ? 'יפה, התחלת! אני סופר איתך.' : "Nice, you've started! I'm counting with you.";
      if (early > 0) {
        setDisplayReps(early);
        spokenCountRef.current.n = early;
        speakCritical(`${early}! ${line}`, { rate: 1.2 });
      } else {
        speakCritical(line, { rate: 1.2 });
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // Form correction arcs on the pose canvas during the exercise. (The exercise Ghost is the demo
  // panel / overlay, on by default — the old skeleton Ghost is retired.)
  useEffect(() => {
    if (phase === PHASE.EXERCISING && analyzerRef.current) {
      const cueKey = analyzerRef.current.cueKey;
      beforeDrawRef.current = (ctx, lm, w, h) => {
        drawFormCorrection(ctx, lm, w, h, cueKey);
      };
    } else {
      // (The warm-up ghost has its own panel — WarmupGhostPanel — not the pose canvas)
      beforeDrawRef.current = null;
    }
  }, [phase]);

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
    const gated = () => workingSourceRef.current?.active;     // the start gate is available
    calibrationDataRef.current.readyMs = 0;
    calibrationDataRef.current.lastTick = Date.now();
    const CAL_MS = gated() ? 3000 : 5000;
    setCalibrationCountdown(Math.ceil(CAL_MS / 1000));
    if (!gated()) speakCalibrationStart(playerName);

    // Countdown — with the start gate it advances ONLY while the trainee holds the start position
    // (positioned + reliable + in the start pose); otherwise it waits (the coach says what to do)
    calibrationIntervalRef.current = setInterval(() => {
      const cal = calibrationDataRef.current;
      if (!cal) return;
      const now = Date.now();
      const step = now - cal.lastTick;
      cal.lastTick = now;
      const ready = !gated() || workingSourceRef.current.startReadyRef.current;
      if (ready) cal.readyMs += step;
      const elapsed = cal.readyMs / 1000;
      const remaining = Math.max(0, Math.ceil(CAL_MS / 1000 - elapsed));
      setCalibrationCountdown(ready ? remaining : null);

      if (cal.readyMs >= CAL_MS) {
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

        // Honest: we start because the trainee IS in the start position (not "I got your range")
        if (gated()) speakPriority(isHe ? READY_DRIVE.start.he : READY_DRIVE.start.en, { rate: 1.12 });
        else speakCalibrationDone(playerName);
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
    }, 250);

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
    if (workingSourceRef.current?.active && !workingSourceRef.current.startReadyRef.current) return;
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

    // === EXPERT EXECUTION GATE (Stage 3.1) — the exercise's own limbs must be in the frame ===
    // Nothing counts (no reps, no technique cues) while they are out of view; the Expert
    // Execution module shows and speaks exactly which body part to bring into the frame.
    if (!executionInViewRef.current) {
      prevLandmarksRef.current = stableLandmarks;
      return;
    }

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
    const ballData = ballAware ? getBallDataUnified() : null;
    const equipData = equipReady ? getEquipmentData() : null;
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
          // The number is said NOW, in real time — it cuts any explanation / command in progress
          speakCountNow(fb.count);

          if (cmdPhase === 'IDLE' || isHoldExercise) {
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
              speakPriority(`המשך ככה${fallbackCmd}`, { rate: 1.25 });
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
    feedPhaseData(newState, repAngles, stableLandmarks, ballData, equipData);
  }, [landmarks, phase]);

  // === INACTIVITY NUDGES: AGGRESSIVE & FAST ===
  // Nudge cooldown ref for re-explain (only once per exercise start)
  const reExplainedRef = useRef(false);

  useEffect(() => {
    if (phase !== PHASE.EXERCISING) return;
    reExplainedRef.current = false;

    const inactivityCheck = setInterval(() => {
      // Required limbs out of the frame → the Expert Execution prompt handles it (no "start moving" nags)
      if (!executionInViewRef.current) return;
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
          const prodText = speakActiveProd(playerName, prodIndexRef.current, exerciseNeedsSetup(currentExercise) ? locationProps : null, currentExercise?.description);
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
        speakQuickReExplain(playerName, currentExercise?.name, currentExercise?.description, exerciseNeedsSetup(currentExercise) ? locationProps : null);
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
        const prodText = speakActiveProd(playerName, prodIndexRef.current, exerciseNeedsSetup(currentExercise) ? locationProps : null, currentExercise?.description);
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

  // Safety timeout: reset aiAnalyzing spinner if server never responds (8s)
  useEffect(() => {
    if (!aiAnalyzing) return;
    const timeout = setTimeout(() => setAiAnalyzing(false), 8000);
    return () => clearTimeout(timeout);
  }, [aiAnalyzing]);

  // Ball detection + AI coaching lifecycle
  useEffect(() => {
    if (phase === PHASE.EXERCISING) {
      // Start equipment detection (unified model) or fall back to ball-only
      if (equipReady && videoRef.current) {
        startEquipLoop(videoRef.current);
      } else if (analyzerRef.current?.ballAware && ballReady && videoRef.current) {
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
      const prevScores = exerciseHistoryRef.current[currentExercise?.name] || [];
      const previousScore = prevScores.length > 0 ? prevScores[0].score : null;
      startVision({
        sport: userProfile?.sport,
        exerciseName: currentExercise?.name,
        cueKey: analyzerRef.current?.cueKey || 'default',
        peakTrigger: analyzerRef.current?.peakTrigger || null,
        playerProfile: userProfile,
        playerName,
        previousScore
      }, captureFrame, videoRef.current, exerciseStateRef.current?._calibration || null);
    } else {
      stopEquipLoop();
      stopBallLoop();
      stopAICoaching();
      stopVision();
    }
    return () => { stopEquipLoop(); stopBallLoop(); stopAICoaching(); stopVision(); };
  }, [phase]);

  // After the environment scan → warm-up (or briefing if there is no warm-up)
  function proceedAfterEnvScan(continuedWithHazards) {
    environmentScannedRef.current = true;
    sessionDataRef.current.environmentScan = {
      ...(sessionDataRef.current.environmentScan || {}),
      continuedWithHazards: !!continuedWithHazards,
    };
    setEnvCountdown(null);
    // Rehab + sport track: a short "do you have a ball?" question before the warm-up
    const ballUnknown = typeof userProfile?.hasBall !== 'boolean';
    const dayNeedsBall = ballUnknown && needsBall(rawExercisesRef.current);
    if (!warmUpDone && currentIdx === 0 && ballAnswer === null && (needsBallQuestion(userProfile) || dayNeedsBall)) {
      setShowBallQuestion(true);
      speakPriority(isHe ? 'יש לך כדור זמין עכשיו?' : 'Do you have a ball available right now?', { rate: 1.0 });
      return;
    }
    startWarmUpOrBriefing();
  }

  function startWarmUpOrBriefing() {
    if (!warmUpDone && currentIdx === 0 && warmUpExercises.length > 0) {
      setWarmUpIdx(0);
      speakWarmUpIntro(playerName);
      setPhase(PHASE.WARM_UP);
    } else {
      setPhase(PHASE.BRIEFING);
      doBriefingSpeech(currentExercise);
    }
  }

  // Ball answer → warm-up (with ball drills, or air drills without a ball) AND the day's exercises
  // are re-fitted (no ball → every ball drill becomes its no-ball version). An explicit tap is saved
  // to the profile, so the trainee is not asked again and future plans respect it.
  function answerBall(hasBall, { explicit = true } = {}) {
    setBallAnswer(hasBall);
    setShowBallQuestion(false);
    sessionDataRef.current.ballAvailable = hasBall;
    const fitted = fitExercises(rawExercisesRef.current, availableEquipment(userProfile, { hasBall }));
    if (fitted.exercises.length) setExercises(fitted.exercises);
    if (fitted.substitutions.length) sessionDataRef.current.equipmentSubstitutions = fitted.substitutions;
    if (explicit && user?.uid) {
      updateDoc(doc(db, 'users', user.uid), { hasBall }).catch(err => console.error('[Ball] save failed:', err));
    }
    startWarmUpOrBriefing();
  }

  // No answer within 10 s → no ball for THIS session only (never saved, never blocks)
  useEffect(() => {
    if (!showBallQuestion) return;
    const t = setTimeout(() => answerBall(false, { explicit: false }), 10000);
    return () => clearTimeout(t);
  }, [showBallQuestion]);

  // Environment scan effect (Stage 2.2) — short, never blocking
  useEffect(() => {
    if (phase !== PHASE.ENVIRONMENT_SCAN) return;

    let cancelled = false;
    let collectLoop;
    let countdownTimer;
    setEnvironmentScan(null);
    setEnvCountdown(null);

    async function runScan() {
      // 1. Local object detection (only if the detector is loaded — the scan runs either way)
      const allDetections = [];
      if (objReady && videoRef.current) {
        await new Promise((resolve) => {
          const scanStart = Date.now();
          collectLoop = setInterval(() => {
            if (cancelled) { clearInterval(collectLoop); resolve(); return; }
            allDetections.push(...scanEnvironment(videoRef.current));
            if (Date.now() - scanStart >= ENV_SCAN_COLLECT_MS) { clearInterval(collectLoop); resolve(); }
          }, 200);
        });
      }
      if (cancelled) return;

      const seen = new Map();
      for (const obj of allDetections) {
        if (!seen.has(obj.label) || seen.get(obj.label).score < obj.score) seen.set(obj.label, obj);
      }
      const uniqueObjects = [...seen.values()];

      // 2. AI hazard analysis of one camera frame — bounded wait, the scan never hangs on it
      let analysis = null;
      const frame = videoRef.current ? captureFrame(videoRef.current) : null;
      if (frame) {
        try {
          const resp = await fetchWithTimeout(apiUrl('/api/coach/analyze-environment'), {
            method: 'POST',
            body: JSON.stringify({
              frame,
              cocoDetections: uniqueObjects,
              profile: { name: userProfile?.name, age: userProfile?.age, disability: userProfile?.disability, mobilityAid: userProfile?.mobilityAid, sport: userProfile?.sport },
              location: currentLocation,
            }),
          }, ENV_VISION_TIMEOUT_MS);
          if (resp.ok) analysis = await resp.json();
        } catch (err) {
          console.warn('[EnvScan] AI analysis skipped:', err.name === 'AbortError' ? 'timeout' : err.message);
        }
      }
      if (cancelled) return;

      // 3. Obstacles in the MOVEMENT ZONE (local geometry: object boxes vs. the body + arm's reach),
      //    merged with the AI hazards. A seat the trainee sits on gets its own message;
      //    wheelchair users' seats are not obstacles.
      const seatedUser = userProfile?.mobilityAid === 'wheelchair' ||
        /wheelchair/i.test(userProfile?.sport || '') || userProfile?.scanData?.classification === 'WHEELCHAIR';
      const localObstacles = findObstacles(allDetections, poseLandmarksRef.current || landmarks, {
        frameW: videoRef.current?.videoWidth,
        frameH: videoRef.current?.videoHeight,
        clearanceZone: getSportProfile(userProfile?.sport)?.safetyRequirements?.clearanceZone ?? 1,
        seatedUser,
      });
      // Skip AI hazards about an object the local check already reported (avoid double warnings)
      const isSameObject = (h, o) => {
        const name = String(h?.object || '').toLowerCase();
        return !!name && (name.includes(o.label) || (!!LABEL_HE[o.label] && name.includes(LABEL_HE[o.label])));
      };
      const aiHazards = (analysis?.hazards || [])
        .filter(h => h?.warning && !localObstacles.some(o => isSameObject(h, o)))
        .map(h => h.warning);
      const hazardWarnings = [...new Set([
        ...localObstacles.map(o => obstacleMessage(o, isHe)),
        ...aiHazards,
      ])];
      console.log('[EnvScan] local obstacles:', localObstacles, '| AI hazards:', analysis?.hazards || '(no AI result)');
      const hasHazards = hazardWarnings.length > 0;
      setEnvironmentScan({
        hazardWarnings,
        equipment: analysis?.equipment || [],
        assistiveDevices: analysis?.assistiveDevices || [],
        aiChecked: !!analysis && !analysis.aiFailed,
      });
      sessionDataRef.current.environmentScan = { hazards: hazardWarnings, at: new Date().toISOString() };

      // 4. Announce: hazards → suggest moving + own responsibility; otherwise a short OK
      if (hasHazards) {
        speakPriority(isHe
          ? `שים לב: ${hazardWarnings.join('. ')}. מומלץ להזיז את זה לפני שמתחילים. אם תבחר להמשיך בלי להזיז, זה על אחריותך בלבד.`
          : `Heads up: ${hazardWarnings.join('. ')}. It's best to move it before we start. If you choose to continue without moving it, it is your own responsibility.`,
          { rate: 1.0 });
      } else if (analysis && !analysis.aiFailed) {
        speakPriority(isHe ? 'המרחב פנוי ובטוח. עוברים לחימום!' : 'Your space is clear and safe. On to the warm-up!', { rate: 1.0 });
      } else {
        // Only the local check ran — don't claim "safe", ask the trainee to make sure
        speakPriority(isHe
          ? 'לא זוהו מכשולים בבדיקה המהירה. ודא שהשטח סביבך פנוי, ועוברים לחימום.'
          : 'No obstacles found in the quick check. Make sure the space around you is clear — on to the warm-up.',
          { rate: 1.0 });
      }

      // 5. Never block: continue automatically after a short countdown
      let remaining = hasHazards ? ENV_HAZARD_CONTINUE_SEC : ENV_SAFE_CONTINUE_SEC;
      setEnvCountdown(remaining);
      countdownTimer = setInterval(() => {
        if (cancelled) { clearInterval(countdownTimer); return; }
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdownTimer);
          proceedAfterEnvScan(hasHazards);
        } else {
          setEnvCountdown(remaining);
        }
      }, 1000);
    }

    runScan();
    return () => { cancelled = true; clearInterval(collectLoop); clearInterval(countdownTimer); };
  }, [phase, envScanRun]);

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
        calibrationDataRef.current = null;
        setPhase(PHASE.CALIBRATING);
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
        calibrationDataRef.current = null;
        setPhase(PHASE.CALIBRATING);
      }, 2000);
    }
  }, [detectedObjects, phase, equipmentFound]);

  // === WARM-UP PHASE LOGIC ===
  const currentWarmUp = warmUpExercises[warmUpIdx];

  // Warm-up countdown timer — movement-locked, with aggressive vocal coaching
  useEffect(() => {
    if (phase !== PHASE.WARM_UP) return;
    console.log('[WARM_UP Effect] Started! warmUpIdx:', warmUpIdx, 'exercise:', currentWarmUp?.id, 'duration:', currentWarmUp?.duration);

    setWarmUpTimer(currentWarmUp.duration);
    warmUpStateRef.current = {};
    lastWarmUpNudgeRef.current = 0;
    lastWarmUpCorrectionRef.current = 0;
    warmUpReExplainedRef.current = false;
    standSuggestedRef.current = false;
    warmUpInactivityStartRef.current = Date.now();
    lastActivityRef.current = 0;          // no movement yet — the timer waits for real, in-view movement
    warmUpMovingMsRef.current = 0;
    lastViewPromptRef.current = 0;

    // Server wake-up: send first frame on first warm-up exercise to eliminate cold-start
    if (warmUpIdx === 0 && captureFrame && videoRef.current) {
      performWarmUpCalibration(captureFrame, videoRef.current);
    }

    // 1) Audible Instructions: use deterministic Hebrew instructions from map, fallback to voicePrompt/description
    const wuInstr = warmUpInfo(currentWarmUp);
    const exName = wuInstr?.name || (isHe ? currentWarmUp.name.he : currentWarmUp.name.en);
    const exDesc = wuInstr
      ? wuInstr.steps.join('. ')
      : (currentWarmUp.voicePrompt ? (isHe ? currentWarmUp.voicePrompt.he : currentWarmUp.voicePrompt.en) : (isHe ? currentWarmUp.description.he : currentWarmUp.description.en));
    speakWarmUpExercise(exName, exDesc, playerName);

    // Disability-specific safety tip after announcement (only if no voicePrompt already covers it)
    if (!currentWarmUp.voicePrompt) {
      if (disabilityCtx.usesCrutches) {
        setTimeout(() => speakDisabilityTip('crutchStable', playerName), 3500);
      }
      if (disabilityCtx.type === 'one_arm') {
        setTimeout(() => speakDisabilityTip('useRemainingArm', playerName), 3500);
      }
    }

    warmUpPausedRef.current = false;
    setWarmUpPaused(false);
    setWarmUpAwaitNext(false);

    warmUpTimerRef.current = setInterval(() => {
      const now = Date.now();
      const state = warmUpStateRef.current;
      // Counts only real, in-view movement read in the last 0.8 s (activity is refreshed every 50 ms
      // while moving, and the rolling window bridges the short still ends of a circle/punch)
      const inView = limbsInViewRef.current;
      const isMoving = inView && (now - lastActivityRef.current) < 800;

      // 0) Required limbs not in view → frozen, clear prompt (no generic "start moving" nudges)
      if (!inView) {
        if (!warmUpPausedRef.current) { warmUpPausedRef.current = true; setWarmUpPaused(true); }
        const sinceStart = now - warmUpInactivityStartRef.current;
        if (sinceStart > 1500 && now - lastViewPromptRef.current > 10000) {
          lastViewPromptRef.current = now;
          const part = requiredPointsFor(currentWarmUp.ghost, limbProfile).part;
          speakPriority(withDrive(viewPromptText(part, isHe), warmUpDriveRef.current++, playerName, isHe), { rate: 1.12 });
        }
        return;
      }

      // 3) Movement Lock: timer ONLY counts down when moving
      if (!isMoving) {
        // Track continuous inactivity duration (from the exercise start or the last movement)
        const inactiveSeconds = (now - Math.max(lastActivityRef.current, warmUpInactivityStartRef.current)) / 1000;

        if (!warmUpPausedRef.current) {
          warmUpPausedRef.current = true;
          setWarmUpPaused(true);
        }

        // 1b) Seated + no movement read for a while: friendly suggestion to try standing (once per exercise,
        //     not for wheelchair users / legs that can't stand). Tracking keeps running while seated.
        const seatedNow = state.posture === 'sitting';
        const canStand = !limbProfile.wheelchair && limbProfile.affectedLegs.length < 2;
        if (seatedNow && canStand && inactiveSeconds >= 10 && !standSuggestedRef.current) {
          standSuggestedRef.current = true;
          lastWarmUpNudgeRef.current = now;
          speakPriority(isHe
            ? 'כל הכבוד שהתחלת לזוז! אם מתאפשר לך, בוא ננסה רגע בעמידה. אם נוח לך יותר לשבת, תמשיך — אני ממשיך לעקוב.'
            : "Great job getting moving! If you can, let's try it standing for a moment. If sitting is more comfortable, keep going — I'm still tracking.",
            { rate: 1.0 });
          setFeedback({
            type: 'info',
            text: isHe ? 'אם מתאפשר — נסה בעמידה. אפשר גם להמשיך בישיבה.' : 'If you can — try standing. You can also keep going seated.',
          });
          return; // timer stays frozen until movement is read
        }

        // 2) Gentle nudge: 8s of no movement (forgiving timing)
        if (inactiveSeconds >= 8 && (now - lastWarmUpNudgeRef.current) / 1000 >= 8) {
          lastWarmUpNudgeRef.current = now;

          // Re-explain at 20s (once per exercise)
          if (inactiveSeconds >= 20 && !warmUpReExplainedRef.current) {
            warmUpReExplainedRef.current = true;
            // Re-explain with this exercise's own (scan-adapted) instructions
            const info = warmUpInfo(currentWarmUp);
            const eName = info?.name || (isHe ? currentWarmUp.name.he : currentWarmUp.name.en);
            const eDesc = info?.steps?.join('. ') || (isHe ? currentWarmUp.description.he : currentWarmUp.description.en);
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

      warmUpMovingMsRef.current += WARM_UP_TICK_MS;
      if (warmUpMovingMsRef.current < 1000) return;
      warmUpMovingMsRef.current -= 1000;

      setWarmUpTimer(prev => {
        if (prev <= 1) {
          clearInterval(warmUpTimerRef.current);
          // Done — but NEVER move on by itself (owner): the trainee taps "next" or says it
          setWarmUpAwaitNext(true);
          const last = warmUpIdx >= warmUpExercises.length - 1;
          speakPriority(isHe
            ? `כל הכבוד ${playerName}! ${last ? 'סיימנו את החימום.' : 'סיימת את התרגיל.'} כשאתה מוכן — לחץ "הבא" או תגיד "הבא".`
            : `Well done ${playerName}! ${last ? 'Warm-up complete.' : 'Exercise done.'} When you're ready — tap "Next" or say "next".`, { rate: 1.1 });
          return 0;
        }
        return prev - 1;
      });
    }, WARM_UP_TICK_MS);

    return () => clearInterval(warmUpTimerRef.current);
  }, [phase, warmUpIdx]);

  // Warm-up pose analysis
  useEffect(() => {
    if (phase !== PHASE.WARM_UP || !landmarks || !currentWarmUp) return;

    const stableLm = warmUpStabilizerRef.current.stabilize(landmarks);
    if (!stableLm) return;
    const analyze = currentWarmUp.analyze;
    const prevState = warmUpStateRef.current;
    const newState = analyze(stableLm, prevState);

    // Update activity tracking (only when the exercise's limbs are actually in view —
    // MediaPipe "guesses" out-of-frame legs, which must never start the timer)
    if (newState.moving && limbsInViewRef.current) {
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
        } else if (currentWarmUp.suppressCorrections?.includes(fb.text)) {
          // Iron Rule: limited range from the scan — no "bigger / higher" push for this exercise
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

    // Progressive Range Challenge (overlay mode): measure the real shoulder range per rep
    if (rangeRef.current && !rangeFailedRef.current) {
      try {
        const g = currentWarmUp.ghost;
        const side = g.move === 'single_arm_circle' ? g.side
          : limbProfile.left_arm.state === 'limited' ? 'left'
          : limbProfile.right_arm.state === 'limited' ? 'right' : 'both';
        const r = trackPeak(peakRef.current, shoulderAngle(landmarks, side));
        peakRef.current = r.tracker;
        if (r.peak) {
          const u = updateRangeChallenge(rangeRef.current, r.peak);
          rangeRef.current = u.state;
          if (u.event === 'expanded') {
            setRangeTarget(u.state.target);
            setRangeFlash(true);
            setTimeout(() => setRangeFlash(false), 1800);
            speakPriority(isHe ? 'מעולה! מרחיבים קצת את הטווח' : "Great! Let's widen the range a little", { rate: 1.1 });
          } else if (u.event === 'eased') {
            setRangeTarget(u.state.target);
            speakPriority(isHe ? 'בנוח — חוזרים לטווח הקודם' : 'Easy — back to the previous range', { rate: 1.0 });
          }
          sessionDataRef.current.rangeChallenge = {
            ...(sessionDataRef.current.rangeChallenge || {}),
            [currentWarmUp.id]: { start: u.state.start, target: u.state.target, max: u.state.max, reps: u.state.reps },
          };
        }
      } catch (err) {
        rangeFailedRef.current = true;
        rangeRef.current = null;
        setRangeTarget(null);
        console.error('[RangeChallenge] disabled after a runtime error:', err);
      }
    }

    warmUpStateRef.current = newState;
  }, [landmarks, phase, warmUpIdx]);

  // Direct warm-up activity detection: raw pose landmarks at ~20 Hz, only the body parts this
  // movement uses (works seated). Feeds the movement-locked timer + the on-screen indicator.
  useEffect(() => {
    if (phase !== PHASE.WARM_UP || !currentWarmUp?.ghost) { setLiveMoving(false); return; }
    activityStateRef.current = {};
    limbsInViewRef.current = false;
    accuracyShownRef.current = { value: null, at: 0, ema: null };
    setAccuracy(null);
    let last = false;
    let lastMissing = undefined;
    let accuracyOff = false;
    const id = setInterval(() => {
      const lm = poseLandmarksRef.current;
      try {
        const r = detectActivity(activityStateRef.current, lm, currentWarmUp.ghost, limbProfile);
        activityStateRef.current = r.state;
        limbsInViewRef.current = r.inView;
        const missing = r.inView ? null : r.part;
        if (missing !== lastMissing) { lastMissing = missing; setMissingPart(missing); }
        if (r.moving) lastActivityRef.current = Date.now();
        if (r.moving !== last) { last = r.moving; setLiveMoving(r.moving); }
      } catch (err) {
        console.error('[WarmupActivity] error:', err);
      }
      // Accuracy vs. the Ghost — isolated: an error turns only the accuracy display off
      if (accuracyOff || !accuracyRef.current) return;
      try {
        const a = updateAccuracy(accuracyRef.current, lm);
        accuracyRef.current = a.tracker;
        const shown = accuracyShownRef.current;
        const now = Date.now();
        if (a.accuracy === null) {
          if (shown.value !== null && now - shown.at > 1500) { shown.value = null; shown.ema = null; shown.at = now; setAccuracy(null); }
        } else {
          shown.ema = shown.ema === null ? a.accuracy : shown.ema + 0.35 * (a.accuracy - shown.ema);   // steady number
          const v = Math.round(shown.ema);
          if (now - shown.at >= 250 && v !== shown.value) { shown.value = v; shown.at = now; setAccuracy(v); }
        }
      } catch (err) {
        accuracyOff = true;
        setAccuracy(null);
        console.error('[MovementAccuracy] disabled after a runtime error:', err);
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase, warmUpIdx, currentWarmUp]);

  // Accuracy tracker follows the Ghost that is shown (incl. a widened range target)
  useEffect(() => {
    if (phase !== PHASE.WARM_UP || !ghostSpec) { accuracyRef.current = null; return; }
    try {
      const sameMove = accuracyRef.current?.sig && accuracyRef.current.move === ghostSpec.move && accuracyRef.current.idx === warmUpIdx;
      const tr = sameMove ? retargetAccuracyTracker(accuracyRef.current, ghostSpec, limbProfile) : createAccuracyTracker(ghostSpec, limbProfile);
      accuracyRef.current = tr ? { ...tr, move: ghostSpec.move, idx: warmUpIdx } : null;
    } catch (err) {
      accuracyRef.current = null;
      console.error('[MovementAccuracy] setup failed:', err);
    }
  }, [phase, warmUpIdx, ghostSpec, limbProfile]);

  // Keep a per-exercise accuracy summary for the session record
  useEffect(() => {
    if (phase !== PHASE.WARM_UP || accuracy === null || !currentWarmUp) return;
    const rec = sessionDataRef.current.warmUpAccuracy || (sessionDataRef.current.warmUpAccuracy = {});
    const e = rec[currentWarmUp.id] || (rec[currentWarmUp.id] = { sum: 0, n: 0, best: 0 });
    e.sum += accuracy; e.n += 1; e.best = Math.max(e.best, accuracy); e.avg = Math.round(e.sum / e.n);
  }, [accuracy]);

  // Two-way moves: start forward on every exercise
  useEffect(() => {
    setGhostDirection('forward');
    directionSwitchedRef.current = false;
  }, [phase, warmUpIdx]);

  // Halfway through a two-way move: announce + flip the Ghost's direction at the same moment.
  // (The accuracy measure compares ranges, which are the same both ways, and keeps its samples.)
  useEffect(() => {
    if (phase !== PHASE.WARM_UP || !currentWarmUp?.ghost?.directional || directionSwitchedRef.current) return;
    const half = Math.floor(currentWarmUp.duration / 2);
    if (warmUpTimer > 0 && warmUpTimer <= half) {
      directionSwitchedRef.current = true;
      setGhostDirection('backward');
      speakPriority(isHe ? 'עכשיו נחליף כיוון — ממשיכים לאחורה' : "Now we switch direction — continue backward", { rate: 1.05 });
      setFeedback({ type: 'info', text: isHe ? '🔄 מחליפים כיוון — עכשיו אחורה' : '🔄 Switch direction — now backward' });
      const rec = sessionDataRef.current.directionSwitches || (sessionDataRef.current.directionSwitches = []);
      rec.push({ exercise: currentWarmUp.id, at: new Date().toISOString() });
    }
  }, [warmUpTimer, phase, currentWarmUp]);

  // Range challenge setup for each warm-up exercise (overlay mode, arm-range moves only)
  useEffect(() => {
    const g = currentWarmUp?.ghost;
    if (phase === PHASE.WARM_UP && overlayActive && !rangeFailedRef.current && g && CHALLENGE_MOVES.has(g.move)) {
      rangeRef.current = createRangeChallenge({ scanCapDeg: g.romCapDeg });
      peakRef.current = createPeakTracker();
      setRangeTarget(rangeRef.current.target);
    } else {
      rangeRef.current = null;
      setRangeTarget(null);
    }
  }, [phase, warmUpIdx, overlayActive, currentWarmUp]);

  const handleStartCamera = useCallback(async () => {
    unlockAudio(); // Unlock mobile audio on camera permission tap — this IS the user gesture
    setAudioUnlocked(true); // Hide manual audio button immediately
    await startCamera();
    // Re-unlock after camera resolves (Android sometimes re-suspends during permission dialog)
    unlockAudio();
    // DON'T start pose loop here — wait until user clicks Start Training
    // This keeps the camera feed clean (no skeleton) during IDLE and avoids GPU load
    // Start session timer
    if (!sessionDataRef.current.startTime) {
      sessionDataRef.current.startTime = Date.now();
      sessionSavedRef.current = false;
    }
  }, [startCamera, videoRef, unlockAudio]);

  // Start skeleton detection as soon as the camera and the model are ready (not only on "Start"),
  // so the skeleton is already tracked when the first exercise begins — no cold start.
  useEffect(() => {
    if (cameraActive && poseReady && videoRef.current && !poseLoopStartedRef.current) {
      console.log('[Training] Starting pose detection loop early (camera + model ready)');
      startLoop(videoRef.current);
      poseLoopStartedRef.current = true;
    }
  }, [cameraActive, poseReady, startLoop]);

  const handleStopCamera = useCallback(() => {
    stopLoop(); stopObjLoop(); stopEquipLoop(); stopBallLoop(); stopCamera(); stopSpeech(); stopAICoaching(); stopVision();
    clearInterval(warmUpTimerRef.current);
    poseLoopStartedRef.current = false;
    setPhase(PHASE.IDLE);
  }, [stopLoop, stopObjLoop, stopEquipLoop, stopBallLoop, stopCamera, stopSpeech, stopAICoaching]);

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

    // Compute session-level technical quality from exercise avgScores
    const scoredExercises = sessionDataRef.current.exerciseResults.filter(e => (e.avgScore || 0) > 0);
    const technicalQuality = scoredExercises.length > 0
      ? Math.round((scoredExercises.reduce((s, e) => s + e.avgScore, 0) / scoredExercises.length) * 10) / 10
      : null;

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
      technicalQuality,
      personalBests: [],
      aiSummary: null,
    };

    // Retry with exponential backoff: 3 attempts (0s, 1s, 3s delays)
    const delays = [0, 1000, 3000];
    let saved = false;
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt]));
      try {
        const ref = await addDoc(collection(db, 'users', user.uid, 'workouts'), data);
        saved = true;
        // Mark day as completed in localStorage for Dashboard progress tracking
        if (status === 'completed') {
          const weekIdx = parseInt(searchParams.get('week') || '0');
          const dayIdx = parseInt(searchParams.get('day') || '0');
          markDayCompleted(weekIdx, dayIdx);
          incrementWeeklySession();

          // Check level-up from Firestore (last 3 completed workouts)
          try {
            const recentQ = query(
              collection(db, 'users', user.uid, 'workouts'),
              orderBy('date', 'desc'),
              limit(3)
            );
            const recentSnap = await getDocs(recentQ);
            const recentScores = recentSnap.docs
              .map(d => d.data().technicalQuality)
              .filter(s => s != null && s > 0);

            if (recentScores.length >= 3) {
              const avg3 = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
              if (avg3 > 8.5) {
                setTimeout(() => {
                  speakIfIdle(isHe
                    ? `${playerName}, שלושה אימונים ברמה גבוהה! הגיע הזמן לעלות לרמת Pro`
                    : `${playerName}, three high-level sessions! Time to upgrade to Pro level`,
                    { rate: 1.2 });
                }, 3000);
              }
            }
          } catch (err) {
            console.error('Level-up check failed:', err);
          }
        }
        // Fire-and-forget AI summary
        fetchAISummary(ref.id, data);
        break;
      } catch (err) {
        console.error(`[saveSession] Attempt ${attempt + 1}/${delays.length} failed:`, err.message);
      }
    }

    // All retries failed — queue to localStorage so it syncs later
    if (!saved) {
      console.warn('[saveSession] All attempts failed, queuing to localStorage');
      const serializable = { ...data, date: { seconds: Math.floor(Date.now() / 1000) }, uid: user.uid };
      queuePendingSession(serializable);
      // Still mark day completed locally so Dashboard shows progress
      if (status === 'completed') {
        markDayCompleted(parseInt(searchParams.get('week') || '0'), parseInt(searchParams.get('day') || '0'));
        incrementWeeklySession();
      }
      sessionSavedRef.current = false; // allow retry on next open
    }
  }

  async function fetchAISummary(docId, sessionData) {
    try {
      const resp = await fetchWithTimeout(apiUrl('/api/coach/workout-summary'), {
        method: 'POST',
        body: JSON.stringify({
          profile: {
            name: userProfile?.name,
            age: userProfile?.age,
            disability: userProfile?.disability,
          },
          sessionData,
        }),
      }, 15000);
      if (resp.ok) {
        const data = await resp.json();
        if (data.summary) {
          aiSummaryRef.current = { summary: data.summary, tips: data.tips || [] };
          await updateDoc(doc(db, 'users', user.uid, 'workouts', docId), { aiSummary: data.summary });
        }
      }
    } catch (err) {
      console.warn('[fetchAISummary] Failed (non-critical):', err.message);
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

  // Complete warmup and auto-transition to first exercise briefing
  function finishWarmUp() {
    console.log('[finishWarmUp] Completing warmup. currentIdx:', currentIdx, 'exercises.length:', exercises.length);
    clearInterval(warmUpTimerRef.current);
    setWarmUpDone(true);
    sessionDataRef.current.warmUpCompleted = true;
    speakWarmUpComplete(playerName);
    setFeedback(null);
    // Auto-transition to briefing for first exercise after 2.5s
    const targetIdx = currentIdx;
    const targetExercises = exercises;
    setTimeout(() => {
      const ex = targetExercises[targetIdx];
      console.log('[finishWarmUp] setTimeout fired. ex:', ex?.name, 'targetIdx:', targetIdx);
      if (ex) {
        setPhase(PHASE.BRIEFING);
        doBriefingSpeech(ex);
      } else {
        setPhase(PHASE.IDLE);
      }
    }, 2500);
  }

  // Build briefing voice params from deterministic instruction map
  function doBriefingSpeech(exercise) {
    if (!exercise) return;
    const instr = getExerciseInstruction(exercise.name, getAnalyzer(exercise.name)?.cueKey);
    const voiceText = instr ? instr.steps.join('. ') : (exercise.voicePrompt || exercise.description);
    const safetyText = instr?.safety || exercise.tips;
    // Equipment set-up only for drills that really use it (never "two chairs" for a plank)
    speakBriefing(instr?.name || exercise.name, voiceText, safetyText, exerciseNeedsSetup(exercise) ? locationProps : null, playerName);
  }

  function handleStartBriefing() {
    if (currentIdx === 0 && !checkIn) return;      // today's check-in first (the overlay asks for it)
    // Apply readiness adjustment once at workout start
    if (readinessRating > 0 && !readinessApplied && exercises.length > 0) {
      const adjusted = exercises.map(ex => {
        const orig = { ...ex };
        if (readinessRating <= 2) {
          // Low readiness: reduce volume
          orig.sets = Math.max(1, (ex.sets || 3) - 1);
          orig.restSeconds = (ex.restSeconds || 60) + 15;
        } else if (readinessRating >= 4) {
          // High readiness: bump reps slightly
          const repsNum = parseInt(ex.reps, 10);
          if (!isNaN(repsNum)) {
            orig.reps = String(repsNum + 1);
          }
        }
        return orig;
      });
      // Update exercises in the parent state (setExercises comes from the plan loader)
      setExercises(adjusted);
      setReadinessApplied(true);
    }

    unlockAudio(); // Ensure mobile audio is unlocked on every exercise start
    exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0);
    setTimer(0);
    setFeedback(null);
    resetAllTracking();

    // Start pose detection loop on first activation (deferred from camera start)
    if (videoRef.current && !poseLoopStartedRef.current) {
      console.log('[handleStartBriefing] Starting pose detection loop');
      startLoop(videoRef.current);
      poseLoopStartedRef.current = true;
    }

    console.log('[handleStartBriefing] currentIdx:', currentIdx, 'warmUpDone:', warmUpDone, 'warmUpExercises.length:', warmUpExercises.length, 'objReady:', objReady, 'envScanned:', environmentScannedRef.current);

    // 1. Environment scan FIRST — once per workout, before the warm-up (Stage 2.2).
    //    Runs even if the object detector isn't loaded (the AI frame check still runs).
    if (currentIdx === 0 && !environmentScannedRef.current) {
      console.log('[handleStartBriefing] → ENVIRONMENT_SCAN phase');
      setPhase(PHASE.ENVIRONMENT_SCAN);
      return;
    }

    // 2. Warm-up
    if (!warmUpDone && currentIdx === 0 && warmUpExercises.length > 0) {
      console.log('[handleStartBriefing] → WARM_UP phase');
      setWarmUpIdx(0);
      speakWarmUpIntro(playerName);
      setPhase(PHASE.WARM_UP);
      return;
    }

    console.log('[handleStartBriefing] → BRIEFING phase');
    setPhase(PHASE.BRIEFING);
    doBriefingSpeech(currentExercise);
  }

  function handleStartAfterBriefing() {
    unlockAudio(); // Re-unlock on user tap for iOS
    stopSpeech();
    sittingWarnedRef.current = false;

    if (!needsEquipmentCheck(currentExercise)) {
      calibrationDataRef.current = null;
      setPhase(PHASE.CALIBRATING);
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

    // Compute set grade (A+/A/B)
    const romReport = performanceReportRef.current;
    const romPct = romReport?.romPercentage ?? 0;
    let grade, gradeColor;
    if (setAvgScore >= 9.0 && romPct >= 95) {
      grade = 'A+'; gradeColor = '#00FF00';
    } else if (setAvgScore >= 7.5 || romPct >= 85) {
      grade = 'A'; gradeColor = '#FFD700';
    } else {
      grade = 'B'; gradeColor = '#FF8C00';
    }

    // Show grade overlay with auto-dismiss
    clearTimeout(gradeTimerRef.current);
    setSetGrade({ grade, color: gradeColor });
    gradeTimerRef.current = setTimeout(() => setSetGrade(null), 2500);

    // Play achievement ding on A+
    if (grade === 'A+') playAchievementDing();

    setSetsPerformance(prev => [...prev, { set: currentSet, quality: wasPerfect ? 'perfect' : wasGood ? 'good' : 'needs_work', avgScore: Math.round(setAvgScore * 10) / 10, grade }]);

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
      if (currentExercise?.sideSwitch && currentExercise.splitBy === 'set') {
        // the next set is the OTHER leg — said clearly in the rest
        const next = legSetNextText(limbProfile, isHe, currentExercise.splitMode, currentSet + 1);
        speakPriority(next, { rate: 1.05 });
        setFeedback({ type: 'info', text: `🔄 ${next}` });
      } else {
        speakRestTip(currentExercise?.tips || '');
      }
    }
  }

  function startNextSet() {
    setCurrentSet(prev => {
      const nextSet = prev + 1;
      // Speak inside updater to avoid stale closure on currentSet
      setTimeout(() => speakSetStart(nextSet, totalSets), 100);
      return nextSet;
    });
    const prevCal = exerciseStateRef.current._calibration;
    exerciseStateRef.current = { _userProfile: userProfile, _calibration: prevCal }; setDisplayReps(0);
    setFeedback(null);
    resetAllTracking();
    exerciseStartTimeRef.current = Date.now();
    setPhase(PHASE.EXERCISING);
    setTimer(0);
    setActiveTimer(0);

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
    stopEquipLoop();
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
          const resp = await authFetch(apiUrl('/api/coach/adapt-workout'), {
            method: 'POST',
            body: JSON.stringify({
              profile: { name: userProfile?.name, age: userProfile?.age, disability: userProfile?.disability, sport: userProfile?.sport, skillLevel: userProfile?.skillLevel },
              completedExercises: sessionDataRef.current.exerciseResults,
              remainingPlan: exercises.slice(currentIdx + 1),
              environmentContext: environmentScan,
            }),
          });
          if (resp.ok) {
            const result = await resp.json();
            if (result.adapted && result.plan?.length > 0 && FEATURES.CATALOG_PLANS) {
              console.info('[Adaptation] catalog sessions are active — free AI exercises are not inserted');
            } else if (result.adapted && result.plan?.length > 0) {
              const sport = userProfile?.sport || 'fitness';
              const sanitizedAdapt = sanitizePlan({ weeks: [{ days: [{ exercises: result.plan }] }] }, sport, userProfile?.age);
              const cleanPlan = fitExercises(sanitizedAdapt.weeks[0].days[0].exercises || [],
                availableEquipment(userProfile, { hasBall: typeof ballAnswer === 'boolean' ? ballAnswer : undefined })).exercises;
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
        prefetchedSummary={aiSummaryRef.current}
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

        {/* Warm-up demo figure (Ghost): own canvas, always visible, not stretched, not covered by the banner */}
        {phase === PHASE.WARM_UP && warmUpGhostOn && ghostSpec && !overlayActive && (
          <WarmupGhostPanel spec={ghostSpec} limbProfile={limbProfile} isHe={isHe} />
        )}
        {/* Full-size Ghost overlay on the body (opt-in; falls back to the panel on any error) */}
        {phase === PHASE.WARM_UP && warmUpGhostOn && ghostSpec && overlayActive && (
          <GhostOverlay spec={ghostSpec} limbProfile={limbProfile} landmarksRef={poseLandmarksRef} videoRef={videoRef} onError={handleOverlayError} />
        )}
        {phase === PHASE.WARM_UP && warmUpGhostOn && overlayActive && rangeTarget && (
          <div className={`absolute left-3 top-1/2 -translate-y-1/2 z-[15] pointer-events-none text-white rounded-xl px-3 py-2 text-sm font-bold transition-all duration-300 ${
            rangeFlash ? 'bg-green-500 scale-125 shadow-lg' : 'bg-black/60'}`}>
            {'\uD83C\uDFAF'} {isHe ? `יעד טווח: ${rangeTarget}°` : `Range target: ${rangeTarget}°`}{rangeFlash ? ' (+5°)' : ''}
          </div>
        )}
        {/* Exercise Ghost generated from the Expert Execution Profile (Stage 3.1): shown from the
            briefing (top, above the instructions card) through calibration and the exercise —
            the panel, or the full overlay on the body for standing exercises */}
        {demoGhostPhase && showDemoGhost && !demoOnBody && (
          <WarmupGhostPanel
            spec={demoGhostSpec} limbProfile={limbProfile} isHe={isHe}
            placement={phase === PHASE.BRIEFING || phase === PHASE.CHECKING_EQUIPMENT || phase === PHASE.RESTING ? 'top' : 'middle'}
            size={demoLarge ? 'large' : 'small'}
            label={demoLabel}
          />
        )}
        {demoGhostPhase && showDemoGhost && demoOnBody && (
          <GhostOverlay spec={demoGhostSpec} limbProfile={limbProfile} landmarksRef={poseLandmarksRef} videoRef={videoRef} onError={handleOverlayError} />
        )}
        {(phase === PHASE.EXERCISING || phase === PHASE.CALIBRATING) && <ExecutionHud execution={execution} isHe={isHe} />}
        {/* The virtual coach (chosen in the check-in): demonstrates with the Ghost, talks, claps */}
        {COACH_IDS.includes(coachChoice) && [PHASE.WARM_UP, PHASE.BRIEFING, PHASE.CHECKING_EQUIPMENT, PHASE.CALIBRATING,
          PHASE.EXERCISING, PHASE.RESTING, PHASE.EXERCISE_DONE, PHASE.PAUSED].includes(phase) && (
          <CoachAvatar
            coach={coachChoice}
            mode={coachMode({ phase, hasSpec: !!(phase === PHASE.WARM_UP ? ghostSpec : demoGhostSpec), justFinished: coachCheer })}
            spec={phase === PHASE.WARM_UP ? ghostSpec : demoGhostSpec}
            limbProfile={limbProfile}
            isHe={isHe}
            isSpeaking={isSpeaking}
            bubble={feedback?.text || null}
          />
        )}
        {/* A finished warm-up move waits for the trainee — never moves on by itself */}
        {phase === PHASE.WARM_UP && warmUpAwaitNext && (
          <div className="absolute inset-x-0 top-1/3 z-[26] flex justify-center px-4">
            <div className="bg-white/95 rounded-2xl shadow-2xl px-5 py-4 text-center space-y-3 max-w-sm w-full" dir={isHe ? 'rtl' : 'ltr'}>
              <div className="text-lg font-bold text-gray-800">{'✅'} {isHe ? 'כל הכבוד, סיימת!' : 'Well done!'}</div>
              <button onClick={goNextWarmUp}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg">
                {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? '▶ התרגיל הבא' : '▶ Next exercise') : (isHe ? '▶ לתרגילים' : '▶ To the exercises')}
              </button>
              {voiceNext.listening && (
                <div className="text-xs text-gray-500">{'🎤'} {isHe ? 'או פשוט תגיד "הבא"' : 'or just say "next"'}</div>
              )}
            </div>
          </div>
        )}
        {phase === PHASE.EXERCISING && currentExercise?.sideSwitch && (
          <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none rounded-full text-white text-sm font-bold px-3 py-1 shadow ${splitHalf === 1 ? 'bg-sky-700/90' : 'bg-orange-600/90'}`}>
            {'🦵'} {currentExercise.splitMode === 'kick'
              ? (currentExercise.splitBy === 'set'
                ? (isHe ? `בעיטות ב${legLabel(splitSupport, limbProfile, true)} · סט ${currentSet}/${totalSets}` : `Kicking with your ${legLabel(splitSupport, limbProfile, false)} · set ${currentSet}/${totalSets}`)
                : (isHe ? `בעיטות ב${legLabel(splitSupport, limbProfile, true)} · חצי ${splitHalf}/2` : `Kicking with your ${legLabel(splitSupport, limbProfile, false)} · half ${splitHalf}/2`))
              : (isHe ? `עמידה על ${legLabel(splitSupport, limbProfile, true)} · חצי ${splitHalf}/2` : `Standing on your ${legLabel(splitSupport, limbProfile, false)} · half ${splitHalf}/2`)}
          </div>
        )}
        {phase === PHASE.EXERCISING && validationMode && execution.active && (
          <div className="absolute top-2 right-2 z-20 pointer-events-none rounded-full bg-fuchsia-700/90 text-white text-[11px] font-bold px-2 py-1">
            {'🧪'} {isHe ? 'מצב אימות — מקליט חזרות' : 'Validation mode — recording reps'}
          </div>
        )}
        {validationSet && phase !== PHASE.EXERCISING && (
          <ValidationPanel clips={validationSet.clips} profile={validationSet.profile} isHe={isHe} onDone={handleValidationDone} />
        )}

        {/* Required limbs not in view → the timer is frozen; tell the trainee exactly what to do */}
        {phase === PHASE.WARM_UP && missingPart && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[16] pointer-events-none bg-amber-500 text-white rounded-2xl px-4 py-2 text-sm sm:text-base font-bold shadow-lg text-center max-w-[90%]">
            {'⚠️'} {viewPromptText(missingPart, isHe)}
            <div className="text-xs font-medium opacity-90">{isHe ? 'הספירה תתחיל כשנראה אותך' : 'The count starts when I can see you'}</div>
          </div>
        )}

        {/* Direction of a two-way move (matches the Ghost's rotation) */}
        {phase === PHASE.WARM_UP && warmUpExercises[warmUpIdx]?.ghost?.directional && (
          <div className={`absolute left-3 top-[55%] z-[15] pointer-events-none rounded-full px-3 py-1 text-xs font-bold text-white ${
            ghostDirection === 'backward' ? 'bg-orange-500/90' : 'bg-sky-600/90'}`}>
            {ghostDirection === 'backward'
              ? (isHe ? 'כיוון: אחורה ⟲' : 'Direction: backward ⟲')
              : (isHe ? 'כיוון: קדימה ⟳' : 'Direction: forward ⟳')}
          </div>
        )}

        {/* Live tracking indicator — shows whether the movement is being read right now */}
        {phase === PHASE.WARM_UP && (
          <div className={`absolute left-3 top-[62%] z-[15] pointer-events-none rounded-full px-3 py-1 text-xs font-bold ${
            liveMoving ? 'bg-green-500/90 text-white' : 'bg-black/55 text-white/80'}`}>
            {liveMoving ? (isHe ? '🟢 מזהה תנועה' : '🟢 Movement detected') : (isHe ? '⚪ ממתין לתנועה' : '⚪ Waiting for movement')}
            {accuracy !== null && (
              <span className={`mx-1 px-2 py-0.5 rounded-full text-white ${
                accuracyLevel(accuracy) === 'good' ? 'bg-green-600' : accuracyLevel(accuracy) === 'mid' ? 'bg-yellow-500' : 'bg-red-600'}`}>
                {isHe ? `${accuracy}% דיוק` : `${accuracy}% accuracy`}
              </span>
            )}
          </div>
        )}

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
        {phase === PHASE.EXERCISING && cameraActive && showRomGauge && (
          <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
            <ROMGauge ref={romGaugeRef} isHe={isHe} />
          </div>
        )}

        {/* Set Grade Overlay (A+/A/B) */}
        {setGrade && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            <div
              className="text-8xl font-black drop-shadow-lg"
              style={{
                color: setGrade.color,
                animation: 'gradePopIn 0.4s ease-out forwards, gradePopOut 0.5s ease-in 2s forwards',
              }}
            >
              {setGrade.grade}
            </div>
          </div>
        )}

        {/* Loading pose overlay — only show AFTER user started training, not during IDLE */}
        {!poseReady && cameraActive && phase !== PHASE.IDLE && (
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
          // Deterministic Hebrew instructions from map (override AI-generated)
          const analyzer = currentExercise ? getAnalyzer(currentExercise.name) : null;
          const instruction = getExerciseInstruction(currentExercise?.name, analyzer?.cueKey);
          const steps = instruction?.steps
            || (currentExercise?.instructions?.length > 0
              ? currentExercise.instructions
              : currentExercise?.description
                ? currentExercise.description.split(/[.,،]/).map(s => s.trim()).filter(Boolean)
                : []);
          const safetyTip = instruction?.safety || currentExercise?.tips || '';
          const displayName = instruction?.name || currentExercise?.name;
          return (
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/50 z-20">
            <div className="bg-white/95 backdrop-blur-sm rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-sm w-full space-y-3 max-h-[60vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl" dir={isHe ? 'rtl' : 'ltr'}>
              {/* Drag handle for mobile */}
              <div className="sm:hidden w-10 h-1 bg-gray-300 rounded-full mx-auto mb-1"></div>

              {/* Exercise name + meta */}
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-800">{displayName}</h3>
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

              {/* Setup hint — only for drills that really use equipment */}
              {exerciseNeedsSetup(currentExercise) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5 text-sm text-yellow-800">
                  <span className="font-bold">{LOCATION_ICONS[currentLocation]} {isHe ? 'הכנה' : 'Setup'}:</span>{' '}
                  {locationProps.setup}
                </div>
              )}

              {/* Safety tip */}
              {safetyTip && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 flex items-start gap-1.5">
                  <span className="flex-shrink-0">&#9888;&#65039;</span>
                  <span>{safetyTip}</span>
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

        {/* Environment scan overlay (Stage 2.2) — bottom sheet on mobile, never blocking */}
        {/* Ball question (rehab + sport track) — before the warm-up, never blocking */}
        {phase === PHASE.ENVIRONMENT_SCAN && showBallQuestion && (
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/50 z-20">
            <div className="bg-white/95 backdrop-blur-sm rounded-t-2xl sm:rounded-2xl p-5 max-w-sm w-full text-center space-y-3 shadow-2xl" dir={isHe ? 'rtl' : 'ltr'}>
              <div className="text-5xl">{'\u26BD'}</div>
              <h3 className="text-lg font-bold text-gray-800">{isHe ? 'יש לך כדור זמין עכשיו?' : 'Do you have a ball available?'}</h3>
              <p className="text-sm text-gray-500">
                {isHe ? 'בלי כדור — נחמם עם תנועות באוויר.' : 'No ball — we will warm up with air movements.'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => answerBall(true)} className="flex-1 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700">
                  {isHe ? 'יש כדור' : 'Yes'}
                </button>
                <button onClick={() => answerBall(false)} className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-800 font-medium hover:bg-gray-300">
                  {isHe ? 'אין כדור' : 'No ball'}
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === PHASE.ENVIRONMENT_SCAN && !showBallQuestion && (
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:bg-black/50 z-20">
            <div className="bg-white/95 backdrop-blur-sm rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-md w-full text-center space-y-3 max-h-[55vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl" dir={isHe ? 'rtl' : 'ltr'}>
              {!environmentScan ? (
                <>
                  <div className="text-5xl animate-pulse">{'\uD83D\uDD0D'}</div>
                  <h3 className="text-lg font-bold text-gray-800">
                    {isHe ? 'בודק את המרחב...' : 'Checking your space...'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {isHe ? 'מחפש מכשולים וסכנות סביבך — כמה שניות' : 'Looking for obstacles and hazards around you — a few seconds'}
                  </p>
                  <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <button
                    onClick={() => proceedAfterEnvScan(false)}
                    className="block mx-auto text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    {isHe ? 'דלג' : 'Skip'}
                  </button>
                </>
              ) : environmentScan.hazardWarnings.length > 0 ? (
                <>
                  <div className="text-5xl">{'\u26A0\uFE0F'}</div>
                  <h3 className="text-lg font-bold text-gray-800">
                    {isHe ? 'זוהה מכשול במרחב' : 'Obstacle detected'}
                  </h3>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 text-start">
                    {environmentScan.hazardWarnings.map((w, i) => <div key={i}>{'• '}{w}</div>)}
                  </div>
                  <p className="text-sm text-gray-700">
                    {isHe ? 'מומלץ להזיז אותו לפני שמתחילים.' : "It's best to move it before you start."}
                  </p>
                  <p className="text-xs text-gray-500">
                    {isHe
                      ? 'אם תבחר להמשיך בלי להזיז — זה על אחריותך בלבד.'
                      : 'If you choose to continue without moving it, it is your own responsibility.'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEnvScanRun(n => n + 1)}
                      className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                    >
                      {isHe ? 'הזזתי — בדוק שוב' : 'I moved it — check again'}
                    </button>
                    <button
                      onClick={() => proceedAfterEnvScan(true)}
                      className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-300"
                    >
                      {isHe ? 'המשך על אחריותי' : 'Continue at my own risk'}
                    </button>
                  </div>
                  {envCountdown !== null && (
                    <p className="text-xs text-gray-400">
                      {isHe ? `ממשיכים לחימום בעוד ${envCountdown} שניות` : `Warm-up starts in ${envCountdown}s`}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-5xl">{'\u2705'}</div>
                  <h3 className="text-lg font-bold text-gray-800">
                    {environmentScan.aiChecked
                      ? (isHe ? 'המרחב פנוי ובטוח' : 'Your space is clear')
                      : (isHe ? 'לא זוהו מכשולים' : 'No obstacles found')}
                  </h3>
                  {!environmentScan.aiChecked && (
                    <p className="text-sm text-gray-600">
                      {isHe ? 'בדיקה מהירה בלבד — ודא שהשטח סביבך פנוי.' : 'Quick check only — make sure the space around you is clear.'}
                    </p>
                  )}
                  {environmentScan.equipment?.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 text-start">
                      <div className="font-bold mb-1">{isHe ? 'ציוד זמין:' : 'Available equipment:'}</div>
                      {environmentScan.equipment.map((eq, i) => <div key={i}>{'• '}{eq.suggestion}</div>)}
                    </div>
                  )}
                  {envCountdown !== null && (
                    <p className="text-xs text-gray-400">
                      {isHe ? `עוברים לחימום בעוד ${envCountdown} שניות` : `Warm-up starts in ${envCountdown}s`}
                    </p>
                  )}
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
                    calibrationDataRef.current = null;
                    setPhase(PHASE.CALIBRATING);
                  }}
                  className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  {isHe ? 'התחל בכל זאת' : 'Start anyway'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* START TRAINING — readiness rating + start button when IDLE and camera ready */}
        {/* TODAY's check-in: where / ball / prosthesis or crutches — the workout is built from it */}
        {phase === PHASE.IDLE && exercises.length > 0 && currentIdx === 0 && !checkIn && userProfile && (
          <div className="absolute inset-0 flex items-center justify-center z-[30] bg-black/40 p-3 overflow-y-auto">
            <div className="w-full max-w-md">
              <DailyCheckIn profile={userProfile} isHe={isHe} onDone={handleCheckInDone} />
            </div>
          </div>
        )}

        {phase === PHASE.IDLE && cameraActive && exercises.length > 0 && (checkIn || currentIdx > 0) && (
          <div className="absolute inset-0 flex items-center justify-center z-[6]">
            <div className="text-center space-y-4">
              {/* Readiness Rating */}
              {!readinessApplied && (
                <div className="bg-white/95 backdrop-blur rounded-2xl px-6 py-4 shadow-xl mb-2">
                  <div className="text-gray-800 font-bold text-lg mb-3">{t('training.readinessTitle')}</div>
                  <div className="flex justify-center gap-3">
                    {[
                      { val: 1, emoji: '\uD83D\uDE2B', label: t('training.readiness1') },
                      { val: 2, emoji: '\uD83D\uDE10', label: t('training.readiness2') },
                      { val: 3, emoji: '\uD83D\uDE42', label: t('training.readiness3') },
                      { val: 4, emoji: '\uD83D\uDCAA', label: t('training.readiness4') },
                      { val: 5, emoji: '\uD83D\uDD25', label: t('training.readiness5') },
                    ].map(r => (
                      <button
                        key={r.val}
                        onClick={() => setReadinessRating(r.val)}
                        className={`flex flex-col items-center p-2 rounded-xl transition ${
                          readinessRating === r.val
                            ? 'bg-blue-100 border-2 border-blue-500 scale-110'
                            : 'border-2 border-transparent hover:bg-gray-100'
                        }`}
                      >
                        <span className="text-2xl">{r.emoji}</span>
                        <span className="text-xs text-gray-600 mt-1">{r.label}</span>
                      </button>
                    ))}
                  </div>
                  {readinessRating > 0 && readinessRating <= 2 && (
                    <div className="text-sm text-amber-600 mt-2">{t('training.readinessAdjusted')}</div>
                  )}
                  {readinessRating >= 4 && (
                    <div className="text-sm text-green-600 mt-2">{t('training.readinessBoosted')}</div>
                  )}
                </div>
              )}
              <button
                onClick={() => { unlockAudio(); handleStartBriefing(); }}
                disabled={readinessRating === 0 && !readinessApplied}
                className="px-12 py-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl font-bold text-2xl shadow-2xl hover:scale-105 transition-transform animate-pulse disabled:opacity-50 disabled:animate-none"
              >
                {isHe ? '\u25B6 \u05D4\u05EA\u05D7\u05DC \u05D0\u05D9\u05DE\u05D5\u05DF' : '\u25B6 Start Training'}
              </button>
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
              {/* the next exercise starts only when the trainee asks for it */}
              <div className="text-white/70 text-xs">
                {isHe ? 'ממשיכים רק כשאתה מוכן' : 'We move on only when you are ready'}
                {voiceNext.listening && (isHe ? ' — לחץ או תגיד "הבא" 🎤' : ' — tap or say "next" 🎤')}
              </div>
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
          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center z-20 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-6 py-4 text-center text-white">
              <div className="text-lg font-bold mb-1">
                {execution.active ? (isHe ? 'עמדת פתיחה' : 'Start position') : (isHe ? 'כיול תנועה' : 'Calibrating')}
              </div>
              <div className="text-4xl font-bold text-yellow-400 mb-1">
                {calibrationCountdown === null ? '⏳' : calibrationCountdown}
              </div>
              <div className="text-sm opacity-80">
                {calibrationCountdown === null
                  ? (isHe ? 'מחכה שתיכנס לעמדת הפתיחה' : 'Waiting for you to get into the start position')
                  : execution.active
                    ? (isHe ? 'החזק את עמדת הפתיחה...' : 'Hold the start position...')
                    : (isHe ? 'בצע תנועה אחת מלאה' : 'Perform one full movement')}
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

        {/* (The Ghost / coach controls are in the strip BELOW the camera view — nothing covers them) */}

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

      {/* Ghost (off / small / big) + coach (male / female / none): always visible, never covered */}
      {cameraActive && (
        <TrainingViewControls
          isHe={isHe}
          floating={isFullscreen}
          ghost={(phase === PHASE.WARM_UP ? warmUpGhostOn : exerciseGhostOn) ? (overlayActive ? 'big' : 'small') : 'off'}
          bigAvailable={FEATURES.GHOST_OVERLAY}
          onGhost={(v) => {
            const on = v !== 'off';
            setWarmUpGhostOn(on);
            setExerciseGhostOn(on);
            try { localStorage.setItem('exerciseGhostOn', on ? '1' : '0'); } catch { /* storage unavailable */ }
            if (on) setGhostModeSaved(v === 'big' ? 'overlay' : 'panel');
          }}
          coach={coachChoice}
          onCoach={chooseCoach}
        />
      )}

      {/* Coach selection at the start of the training (once per device; changeable any time in the strip) */}
      {cameraActive && !coachPicked && exercises.length > 0 && (phase === PHASE.IDLE || phase === PHASE.WARM_UP) && (checkIn || currentIdx > 0 || phase === PHASE.WARM_UP) && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-4 text-center" dir={isHe ? 'rtl' : 'ltr'}>
            <div className="text-lg font-bold text-gray-800">{'🎽'} {isHe ? 'מי יאמן אותך היום?' : 'Who coaches you today?'}</div>
            <div className="text-xs text-gray-500">{isHe ? 'הדמות תעמוד בצד המסך, תדגים כל תרגיל ותלווה אותך לאורך האימון' : 'The coach stands at the side of the screen, demonstrates every exercise and talks you through the workout'}</div>
            <div className="flex gap-3 justify-center">
              {COACH_IDS.map(c => (
                <button key={c} type="button" onClick={() => chooseCoach(c)}
                  className={`flex-1 rounded-2xl border-2 p-2 flex flex-col items-center gap-1 transition ${c === 'female' ? 'border-pink-300 hover:bg-pink-50' : 'border-blue-300 hover:bg-blue-50'}`}>
                  <CoachPreview coach={c} className="w-24 h-36" />
                  <span className="font-bold text-gray-800">{c === 'female' ? (isHe ? 'מאמנת' : 'Female coach') : (isHe ? 'מאמן' : 'Male coach')}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => chooseCoach('none')} className="text-sm text-gray-500 underline">
              {isHe ? 'בלי דמות מאמן' : 'No coach character'}
            </button>
          </div>
        </div>
      )}

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

            {/* Current exercise/warmup name + info */}
            {phase === PHASE.WARM_UP && currentWarmUp ? (
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-orange-300 font-bold text-base truncate max-w-[60%]">
                  {isHe ? `חימום: ${currentWarmUp.name.he}` : `Warm-up: ${currentWarmUp.name.en}`}
                </h2>
                <span className="text-4xl font-bold text-white">{warmUpTimer}</span>
              </div>
            ) : currentExercise && (warmUpDone || warmUpExercises.length === 0) ? (
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-white font-bold text-base truncate max-w-[60%]">{currentExercise.name}</h2>
                <span className="text-white/60 text-xs flex-shrink-0">
                  {t('training.set')} {currentSet}/{totalSets} | {displayReps}/{currentExercise.reps}
                </span>
              </div>
            ) : !warmUpDone && warmUpExercises.length > 0 ? (
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-orange-300 font-bold text-base">
                  {isHe ? `לחץ "התחל" כדי להתחיל חימום (${warmUpExercises.length} תרגילים)` : `Press "Start" to begin warm-up (${warmUpExercises.length} exercises)`}
                </h2>
              </div>
            ) : null}

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
                  onClick={goNextWarmUp}
                  className={`flex-1 py-2 min-h-[48px] bg-blue-600 text-white rounded-lg font-bold text-base ${warmUpAwaitNext ? 'ring-4 ring-green-400 animate-pulse' : ''}`}
                >
                  {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? 'הבא' : 'Next') : (isHe ? 'סיים חימום' : 'Finish warm-up')}
                </button>
                <button
                  onClick={() => { finishWarmUp(); }}
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
                  <button onClick={handleStartBriefing} disabled={!cameraActive}
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

          {/* ZONE 3: Unified exercise list (warmup + main) — scrollable bottom, z-10 */}
          <div className="flex-1 bg-gray-950 overflow-y-auto px-3 py-2 pb-[env(safe-area-inset-bottom)]" style={{ maxHeight: '40vh' }}>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {/* Warmup first, then main — same card style */}
              {[
                ...warmUpExercises.map((wu, i) => ({ key: `wu-${i}`, idx: i, name: isHe ? wu.name.he : wu.name.en, isWarmup: true })),
                ...exercises.map((ex, i) => ({ key: `ex-${i}`, idx: i, name: ex.name, isWarmup: false })),
              ].map((item, globalIdx) => {
                const isActiveWarmup = item.isWarmup && phase === PHASE.WARM_UP && item.idx === warmUpIdx;
                const isActiveExercise = !item.isWarmup && item.idx === currentIdx && phase !== PHASE.WARM_UP;
                const isWarmupDone = item.isWarmup && (warmUpDone || (phase === PHASE.WARM_UP && item.idx < warmUpIdx));
                const isActive = isActiveWarmup || isActiveExercise;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      if (item.isWarmup || phase === PHASE.WARM_UP) return;
                      stopSpeech(); setCurrentIdx(item.idx); setPhase(PHASE.IDLE); setTimer(0);
                      exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setSetsPerformance([]); setCurrentSet(1); resetAllTracking();
                    }}
                    className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition truncate max-w-[150px] ${
                      isActive ? 'bg-blue-500 text-white' :
                      isWarmupDone ? 'bg-green-500/30 text-green-300' :
                      'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {globalIdx + 1}. {item.name}
                  </button>
                );
              })}
            </div>
            {/* Current exercise details */}
            {phase === PHASE.WARM_UP && currentWarmUp && (
              <div className="bg-orange-500/10 rounded-lg p-3 space-y-2 mt-1">
                <p className="text-white/80 text-sm">{isHe ? currentWarmUp.description.he : currentWarmUp.description.en}</p>
                <div className="flex items-center gap-2">
                  <span className="text-orange-300 text-xs font-medium">{currentWarmUp.duration}{isHe ? ' שניות' : 's'}</span>
                  <span className="text-4xl font-bold text-white">{warmUpTimer}</span>
                </div>
              </div>
            )}
            {currentExercise && phase !== PHASE.WARM_UP && (warmUpDone || warmUpExercises.length === 0) && (
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
                  <h2 className="text-lg font-bold text-white">{(() => { const wi = warmUpInfo(currentWarmUp); return wi?.name || (isHe ? currentWarmUp.name.he : currentWarmUp.name.en); })()}</h2>

                  {/* Warmup instructions — deterministic from map */}
                  {(() => {
                    const wi = warmUpInfo(currentWarmUp);
                    const steps = wi?.steps || (currentWarmUp.instructions ? (isHe ? currentWarmUp.instructions.he : currentWarmUp.instructions.en) : null);
                    if (!steps) return null;
                    return (
                      <div className="space-y-1 py-1">
                        {steps.map((step, i) => (
                          <div key={i} className="flex items-start gap-2 text-white/80 text-sm">
                            <span className="text-orange-400 font-bold flex-shrink-0">{i + 1}.</span>
                            <span>{step}</span>
                          </div>
                        ))}
                        {wi?.safety && (
                          <p className="text-red-300 text-xs mt-1">{wi.safety}</p>
                        )}
                      </div>
                    );
                  })()}

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
                          finishWarmUp();
                        }
                      }}
                      className="flex-1 py-2 min-h-[44px] bg-blue-600 text-white rounded-lg font-medium"
                    >
                      {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? 'הבא ▶' : 'Next ▶') : (isHe ? 'סיים חימום ▶' : 'Finish warm-up ▶')}
                    </button>
                    <button
                      onClick={() => { finishWarmUp(); }}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm border border-white/30 text-white"
                    >
                      {isHe ? 'דלג' : 'Skip'}
                    </button>
                  </div>
                </div>
              )}

              {currentExercise && phase !== PHASE.WARM_UP && (warmUpDone || warmUpExercises.length === 0) && (
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
                      <button onClick={handleStartBriefing} disabled={!cameraActive} className="flex-1 py-2 min-h-[44px] bg-green-500 text-white rounded-lg font-medium disabled:opacity-50">
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
                  <h2 className="text-lg font-bold text-gray-800">{(() => { const wi = warmUpInfo(currentWarmUp); return wi?.name || (isHe ? currentWarmUp.name.he : currentWarmUp.name.en); })()}</h2>
                  {(() => {
                    const wi = warmUpInfo(currentWarmUp);
                    const steps = wi?.steps || (currentWarmUp.instructions ? (isHe ? currentWarmUp.instructions.he : currentWarmUp.instructions.en) : null);
                    if (!steps) return <p className="text-sm text-gray-500">{isHe ? currentWarmUp.description.he : currentWarmUp.description.en}</p>;
                    return (
                      <div className="space-y-1 py-1">
                        {steps.map((step, i) => (
                          <div key={i} className="flex items-start gap-2 text-gray-600 text-sm">
                            <span className="text-orange-500 font-bold flex-shrink-0">{i + 1}.</span>
                            <span>{step}</span>
                          </div>
                        ))}
                        {wi?.safety && (
                          <p className="text-red-500 text-xs mt-1">{wi.safety}</p>
                        )}
                      </div>
                    );
                  })()}
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
                          finishWarmUp();
                        }
                      }}
                      className="flex-1 py-2 min-h-[44px] bg-blue-600 text-white rounded-lg font-medium"
                    >
                      {warmUpIdx < warmUpExercises.length - 1 ? (isHe ? 'הבא ▶' : 'Next ▶') : (isHe ? 'סיים חימום ▶' : 'Finish warm-up ▶')}
                    </button>
                    <button
                      onClick={() => { finishWarmUp(); }}
                      className="px-4 py-2 min-h-[44px] rounded-lg text-sm border border-gray-300 text-gray-500"
                    >
                      {isHe ? 'דלג' : 'Skip'}
                    </button>
                  </div>
                </div>
              )}

              {/* Show "press start for warmup" when warmup pending */}
              {!warmUpDone && warmUpExercises.length > 0 && phase !== PHASE.WARM_UP && (
                <div className="bg-orange-50 rounded-xl shadow-lg p-5 border-2 border-orange-400 space-y-2 text-center">
                  <span className="text-orange-600 font-bold text-lg">{isHe ? 'חימום' : 'Warm-up'}</span>
                  <p className="text-sm text-orange-700">{isHe ? `${warmUpExercises.length} תרגילי חימום לפני האימון. לחץ "התחל" כדי להתחיל.` : `${warmUpExercises.length} warm-up exercises before the workout. Press "Start" to begin.`}</p>
                </div>
              )}

              {currentExercise && phase !== PHASE.WARM_UP && (warmUpDone || warmUpExercises.length === 0) && (
                <div className="bg-white rounded-xl shadow-lg p-5 border-2 border-blue-500 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-600">{t('training.currentExercise')} ({currentIdx + 1}/{exercises.length})</span>
                    <span className="text-xs text-gray-400">{totalSets} {t('dashboard.sets')} | {currentExercise.reps} {t('dashboard.reps')} | {restDuration}{t('dashboard.secRest')}</span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-800">{currentExercise.name}</h2>
                  <p className="text-sm text-gray-500">{currentExercise.description}</p>
                  {exerciseNeedsSetup(currentExercise) && (
                    <div className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
                      {LOCATION_ICONS[currentLocation]} {locationProps.setup}
                    </div>
                  )}
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
                      <button onClick={handleStartBriefing} disabled={!cameraActive} className="flex-1 py-2 min-h-[44px] bg-green-500 text-white rounded-lg font-medium disabled:opacity-50">
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

              {/* Unified exercise list: warmup + main — same card style */}
              <div className="grid gap-2">
                {[
                  ...warmUpExercises.map((wu, i) => ({ key: `wu-${i}`, idx: i, name: isHe ? wu.name.he : wu.name.en, info: `${wu.duration}${isHe ? 'שנ' : 's'}`, isWarmup: true })),
                  ...exercises.map((ex, i) => ({ key: `ex-${i}`, idx: i, name: ex.name, info: `${ex.sets}x${ex.reps}`, isWarmup: false })),
                ].map((item, globalIdx) => {
                  const isActiveWarmup = item.isWarmup && phase === PHASE.WARM_UP && item.idx === warmUpIdx;
                  const isActiveExercise = !item.isWarmup && item.idx === currentIdx && phase !== PHASE.WARM_UP;
                  const isWarmupDone = item.isWarmup && (warmUpDone || (phase === PHASE.WARM_UP && item.idx < warmUpIdx));
                  const isActive = isActiveWarmup || isActiveExercise;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        if (item.isWarmup || phase === PHASE.WARM_UP) return;
                        stopSpeech(); setCurrentIdx(item.idx); setPhase(PHASE.IDLE); setTimer(0);
                        exerciseStateRef.current = { _userProfile: userProfile }; setDisplayReps(0); setSetsPerformance([]); setCurrentSet(1); resetAllTracking();
                      }}
                      className={`text-start p-3 rounded-lg border transition ${
                        isActive ? 'border-blue-500 bg-blue-50' :
                        isWarmupDone ? 'border-green-300 bg-green-50' :
                        'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-medium text-sm truncate max-w-[70%] ${isWarmupDone ? 'text-green-600' : 'text-gray-800'}`}>
                          {globalIdx + 1}. {item.name}
                        </span>
                        <span className="text-xs text-gray-400">{item.info}</span>
                      </div>
                    </button>
                  );
                })}
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
