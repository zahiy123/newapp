import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useCamera } from '../hooks/useCamera';
import { usePose } from '../hooks/usePose';
import { useSpeech } from '../hooks/useSpeech';
import { useObjectDetection } from '../hooks/useObjectDetection';
import { getAnalyzer, getLocationProps, getWarmUpExercises, getDisabilityContext } from '../utils/exerciseAnalysis';

import { estimateCalories } from '../utils/calorieEstimator';
import { db } from '../services/firebase';
import { doc, getDoc, addDoc, updateDoc, collection, Timestamp } from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../utils/api';

const PHASE = {
  IDLE: 'idle',
  BRIEFING: 'briefing',
  CHECKING_EQUIPMENT: 'checking_equipment',
  WARM_UP: 'warm_up',
  EXERCISING: 'exercising',
  RESTING: 'resting',
  EXERCISE_DONE: 'exercise_done',
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

  const { videoRef, active: cameraActive, error: cameraError, start: startCamera, stop: stopCamera } = useCamera();
  const { ready: poseReady, landmarks, startLoop, stopLoop } = usePose(canvasRef);
  const { ready: objReady, detectedObjects, startLoop: startObjLoop, stopLoop: stopObjLoop, hasEquipment } = useObjectDetection();

  // Equipment check state
  const [equipmentFound, setEquipmentFound] = useState(false);
  const [equipmentLabel, setEquipmentLabel] = useState('');
  const equipCheckTimerRef = useRef(null);
  const {
    speak, speakPriority, speakIfIdle, speakBriefing, speakEncouragement, speakCorrection,
    speakOptimization, speakRestTip, speakSetStart, speakCount,
    speakPostBriefingNudge, speakMidSetQuit, speakHeadUp,
    speakHowToStart, speakSitting, speakReadyWhenYouAre, speakActiveProd,
    speakQuickReExplain, speakEquipmentFound,
    speakWarmUpIntro, speakWarmUpExercise, speakWarmUpNudge, speakWarmUpInactivityNudge, speakWarmUpReExplain,
    speakWarmUpCorrection, speakWarmUpComplete,
    speakDisabilityTip, speakMindMuscleCue, stop: stopSpeech, isSpeaking
  } = useSpeech(lang);

  const [exercises, setExercises] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const exerciseStateRef = useRef({});
  const [displayReps, setDisplayReps] = useState(0);
  const [feedback, setFeedback] = useState(null);
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
  const sittingWarnedRef = useRef(false);

  // Head-down tracking
  const headDownCountRef = useRef(0);
  const lastHeadUpWarningRef = useRef(0);

  // Active prodding rotation index
  const prodIndexRef = useRef(0);

  // Mind-muscle cue timing
  const lastMindMuscleCueRef = useRef(0);

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

      setExercises(week.days[dayIdx].exercises || []);
    }
    load();
  }, [user, searchParams]);

  const currentExercise = exercises[currentIdx];

  // Set up analyzer when exercise changes
  useEffect(() => {
    if (currentExercise) {
      const { analyze, type, cueKey } = getAnalyzer(currentExercise.name);
      analyzerRef.current = { analyze, type, cueKey };
      exerciseStateRef.current = {};
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

  // Core pose analysis - with posture gating (uses ref to avoid render loops)
  useEffect(() => {
    if (phase !== PHASE.EXERCISING || !landmarks || !analyzerRef.current) return;

    const { analyze } = analyzerRef.current;
    const prevState = exerciseStateRef.current;
    const newState = analyze(landmarks, prevState);
    const posture = newState.posture;
    const isMoving = newState.moving;
    const firstRepStarted = newState.firstRepStarted || false;

    // === POSTURE GATE: If sitting or unknown, suppress ALL technique feedback ===
    if (posture === 'sitting' || posture === 'unknown') {
      const now = Date.now();
      if (!sittingWarnedRef.current || now - lastNudgeTimeRef.current > 10000) {
        sittingWarnedRef.current = true;
        lastNudgeTimeRef.current = now;
        speakSitting(playerName);
        setFeedback({
          type: 'warning',
          text: isHe
            ? `${playerName}, אני רואה שאתה יושב. קום כדי להתחיל.`
            : `${playerName}, I see you're sitting. Please stand up.`
        });
      }
      exerciseStateRef.current = newState;
      return;
    }

    // User is standing - clear sitting warning
    sittingWarnedRef.current = false;

    // Update activity timestamp when movement or new rep detected
    if (isMoving || (newState.lastRepTime && newState.lastRepTime !== prevState.lastRepTime)) {
      lastActivityRef.current = Date.now();
      lastNudgeTimeRef.current = 0;
    }

    // === HEAD-DOWN: Only check after first rep started ===
    if (firstRepStarted && newState.headDown) {
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

    // === TECHNIQUE FEEDBACK: Only if firstRepStarted ===
    if (newState.feedback && firstRepStarted) {
      const fb = newState.feedback;

      if (fb.type === 'good' && isMoving) {
        goodFormCountRef.current++;
        const now = Date.now();
        if (now - lastEncouragementRef.current > 8000) {
          speakEncouragement();
          lastEncouragementRef.current = now;
        }
      } else if (fb.type === 'warning' && isMoving) {
        badFormCountRef.current++;
        if (badFormCountRef.current >= 3 && !formStoppedRef.current) {
          formStoppedRef.current = true;
          speakCorrection(currentExercise?.tips);
          setFeedback({ type: 'warning', text: t('training.formStopped') });
          setTimeout(() => {
            formStoppedRef.current = false;
            badFormCountRef.current = 0;
          }, 3000);
          exerciseStateRef.current = newState;
          return;
        }
      } else if (fb.type !== 'good' && fb.type !== 'warning') {
        badFormCountRef.current = 0;
      }

      // Suppress good/warning feedback when NOT moving
      if (!isMoving && (fb.type === 'good' || fb.type === 'warning')) {
        // Silence
      } else if (fb.text !== lastSpokenRef.current) {
        setFeedback(fb);
        if (fb.type === 'count') {
          speakCount(fb.count);
          lastSpokenRef.current = fb.text;
          setDisplayReps(fb.count);

          const targetReps = parseInt(currentExercise?.reps) || 10;
          if (fb.count >= targetReps) {
            exerciseStateRef.current = newState;
            handleSetComplete();
            return;
          }
        } else {
          speakIfIdle(fb.text);
          lastSpokenRef.current = fb.text;
        }
      }
    }

    // Mind-muscle cue: every 15s during good-form movement
    if (firstRepStarted && isMoving && newState.feedback?.type !== 'warning') {
      const now = Date.now();
      if (now - lastMindMuscleCueRef.current > 15000) {
        lastMindMuscleCueRef.current = now;
        speakMindMuscleCue(analyzerRef.current?.cueKey || 'default', newState.phase || 'up', playerName);
      }
    }

    // Update reps display when reps change
    if (newState.reps !== undefined && newState.reps !== prevState.reps) {
      setDisplayReps(newState.reps);
    }

    exerciseStateRef.current = newState;
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

      // === PRIORITY 1: Mid-set quit - started reps but stopped 5s+ ===
      if (currentReps > 0 && elapsed >= 5 && timeSinceLastNudge >= 5) {
        const targetReps = parseInt(currentExercise?.reps) || 10;
        const repsRemaining = targetReps - currentReps;
        if (repsRemaining > 0) {
          lastNudgeTimeRef.current = now;
          speakMidSetQuit(playerName, repsRemaining);
          setFeedback({
            type: 'warning',
            text: isHe
              ? `אל תפסיק! רק עוד ${repsRemaining} חזרות!`
              : `Don't quit! Only ${repsRemaining} more reps!`
          });
          return;
        }
      }

      // === Already started reps but idle ===
      if (firstRepStarted) {
        if (elapsed >= 7 && timeSinceLastNudge >= 7) {
          lastNudgeTimeRef.current = now;
          const prodText = speakActiveProd(playerName, prodIndexRef.current, locationProps, currentExercise?.description);
          prodIndexRef.current++;
          setFeedback({ type: 'warning', text: prodText });
        }
        return;
      }

      // === PRIORITY 2: Quick re-explain at 20s (once) ===
      if (elapsed >= 20 && !reExplainedRef.current) {
        reExplainedRef.current = true;
        lastNudgeTimeRef.current = now;
        prodIndexRef.current = 0;
        speakQuickReExplain(playerName, currentExercise?.name, currentExercise?.description, locationProps);
        setFeedback({
          type: 'info',
          text: isHe
            ? `${playerName}, אולי לא ברור? בוא נסביר מהר...`
            : `${playerName}, not sure how to start? Let me explain quickly...`
        });
        return;
      }

      // === PRIORITY 3: First nudge at exactly 5s, then every 7s ===
      const nudgeCooldown = lastNudgeTimeRef.current === 0 ? 5 : 7;
      if (elapsed >= 5 && timeSinceLastNudge >= nudgeCooldown) {
        lastNudgeTimeRef.current = now;
        const prodText = speakActiveProd(playerName, prodIndexRef.current, locationProps, currentExercise?.description);
        prodIndexRef.current++;
        setFeedback({ type: 'warning', text: prodText });
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
          setPhase(PHASE.EXERCISING);
          setTimer(0);
          lastActivityRef.current = Date.now();
          exerciseStartTimeRef.current = Date.now();
          lastNudgeTimeRef.current = 0;
          speakSetStart(currentSet, totalSets);
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
          setPhase(PHASE.EXERCISING);
          setTimer(0);
          lastActivityRef.current = Date.now();
          exerciseStartTimeRef.current = Date.now();
          lastNudgeTimeRef.current = 0;
          speakSetStart(currentSet, totalSets);
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

    // 1) Audible Instructions: full name + description + player name (speakPriority)
    const exName = isHe ? currentWarmUp.name.he : currentWarmUp.name.en;
    const exDesc = isHe ? currentWarmUp.description.he : currentWarmUp.description.en;
    speakWarmUpExercise(exName, exDesc, playerName);

    // Disability-specific safety tip after announcement
    if (disabilityCtx.usesCrutches) {
      setTimeout(() => speakDisabilityTip('crutchStable', playerName), 3500);
    }
    if (disabilityCtx.type === 'one_arm') {
      setTimeout(() => speakDisabilityTip('useRemainingArm', playerName), 3500);
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

        // 2) Vocal Nudge: 4s of no movement → priority nudge naming the exercise
        if (inactiveSeconds >= 4 && (now - lastWarmUpNudgeRef.current) / 1000 >= 4) {
          lastWarmUpNudgeRef.current = now;

          // 4) Re-explain at 15s (once per exercise)
          if (inactiveSeconds >= 15 && !warmUpReExplainedRef.current) {
            warmUpReExplainedRef.current = true;
            const eName = isHe ? currentWarmUp.name.he : currentWarmUp.name.en;
            const eDesc = isHe ? currentWarmUp.description.he : currentWarmUp.description.en;
            speakWarmUpReExplain(eName, eDesc, playerName);
            setFeedback({
              type: 'warning',
              text: isHe ? 'אולי לא ברור? בוא נסביר שוב...' : "Maybe it's not clear? Let me explain again..."
            });
          } else {
            const eName = isHe ? currentWarmUp.name.he : currentWarmUp.name.en;
            speakWarmUpInactivityNudge(eName, playerName);
            setFeedback({
              type: 'warning',
              text: isHe ? `אני מחכה! התחל את ה${eName}!` : `I'm waiting! Start the ${eName}!`
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

    const analyze = currentWarmUp.analyze;
    const prevState = warmUpStateRef.current;
    const newState = analyze(landmarks, prevState);

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
    await startCamera();
    setTimeout(() => { if (videoRef.current) startLoop(videoRef.current); }, 500);
    // Start session timer
    if (!sessionDataRef.current.startTime) {
      sessionDataRef.current.startTime = Date.now();
      sessionSavedRef.current = false;
    }
  }, [startCamera, startLoop, videoRef]);

  const handleStopCamera = useCallback(() => {
    stopLoop(); stopObjLoop(); stopCamera(); stopSpeech();
    clearInterval(warmUpTimerRef.current);
    setPhase(PHASE.IDLE);
  }, [stopLoop, stopObjLoop, stopCamera, stopSpeech]);

  function resetAllTracking() {
    lastSpokenRef.current = '';
    badFormCountRef.current = 0;
    goodFormCountRef.current = 0;
    formStoppedRef.current = false;
    lastActivityRef.current = Date.now();
    lastNudgeTimeRef.current = 0;
    sittingWarnedRef.current = false;
    headDownCountRef.current = 0;
    prodIndexRef.current = 0;
    exerciseStartTimeRef.current = null;
    lastMindMuscleCueRef.current = 0;
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

    sessionDataRef.current.exerciseResults.push({
      name: currentExercise.name,
      repsTarget: parseInt(currentExercise.reps) || 0,
      repsActual: displayReps,
      setsTarget: totalSets,
      setsCompleted: setsPerformance.length,
      duration,
      quality: bestQuality,
      calories,
    });
  }

  async function saveSession(status) {
    if (!user || sessionSavedRef.current) return;
    if (sessionDataRef.current.exerciseResults.length === 0) return;
    sessionSavedRef.current = true;

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
        const { summary } = await resp.json();
        if (summary) {
          await updateDoc(doc(db, 'users', user.uid, 'workouts', docId), { aiSummary: summary });
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
    setPhase(PHASE.BRIEFING);
    exerciseStateRef.current = {}; setDisplayReps(0);
    setTimer(0);
    setFeedback(null);
    resetAllTracking();
    speakBriefing(currentExercise.name, currentExercise.description, currentExercise.tips, locationProps);
  }

  function handleStartAfterBriefing() {
    stopSpeech();
    sittingWarnedRef.current = false;

    if (!needsEquipmentCheck(currentExercise)) {
      // Skip equipment detection — go directly to warm-up or exercising
      if (!warmUpDone && currentIdx === 0) {
        setWarmUpIdx(0);
        speakWarmUpIntro(playerName);
        setPhase(PHASE.WARM_UP);
      } else {
        setPhase(PHASE.EXERCISING);
        setTimer(0);
        lastActivityRef.current = Date.now();
        exerciseStartTimeRef.current = Date.now();
        lastNudgeTimeRef.current = 0;
        speakSetStart(currentSet, totalSets);
      }
    } else {
      setEquipmentFound(false);
      setEquipmentLabel('');
      setPhase(PHASE.CHECKING_EQUIPMENT);
    }
  }

  function handleSetComplete() {
    clearInterval(timerRef.current);
    const wasGood = badFormCountRef.current < 3;
    const wasPerfect = badFormCountRef.current === 0 && goodFormCountRef.current > 3;

    setSetsPerformance(prev => [...prev, { set: currentSet, quality: wasPerfect ? 'perfect' : wasGood ? 'good' : 'needs_work' }]);

    if (wasPerfect) {
      const langKey = isHe ? 'he' : 'en';
      const exType = analyzerRef.current?.cueKey || 'default';
      speakOptimization(OPTIMIZATION_TIPS[langKey][exType] || OPTIMIZATION_TIPS[langKey].default);
    } else if (wasGood) {
      speakEncouragement();
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
    exerciseStateRef.current = {}; setDisplayReps(0);
    setFeedback(null);
    resetAllTracking();
    exerciseStartTimeRef.current = Date.now();
    setPhase(PHASE.EXERCISING);
    setTimer(0);
    setActiveTimer(0);
    speakSetStart(currentSet + 1, totalSets);
  }

  function handleSkipRest() {
    clearInterval(timerRef.current);
    setRestTime(0);
    startNextSet();
  }

  function handlePauseExercise() { setPhase(PHASE.IDLE); }

  function handleNextExercise() {
    // Record this exercise's results before moving on
    recordExerciseResult();
    stopSpeech(); setPhase(PHASE.IDLE); setTimer(0); setFeedback(null);
    exerciseStateRef.current = {}; setDisplayReps(0); setCurrentSet(1); setSetsPerformance([]); resetAllTracking();
    if (currentIdx < exercises.length - 1) { setCurrentIdx(currentIdx + 1); speak(t('training.nextExercise')); }
    else { setWorkoutDone(true); speak(t('training.workoutComplete')); saveSession('completed'); }
  }

  function handlePrevExercise() {
    if (currentIdx > 0) {
      stopSpeech(); setPhase(PHASE.IDLE); setTimer(0); setFeedback(null);
      exerciseStateRef.current = {}; setDisplayReps(0); setCurrentSet(1); setSetsPerformance([]); resetAllTracking();
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
      <div className="max-w-lg mx-auto text-center py-12 space-y-6">
        <div className="text-6xl">&#127942;</div>
        <h1 className="text-3xl font-bold text-gray-800">{t('training.workoutComplete')}</h1>
        <p className="text-lg text-gray-500">{t('training.greatJob')}</p>
        <button onClick={() => navigate('/')} className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium">
          {t('training.backToPlan')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
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

      {/* Camera + Pose Overlay */}
      <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted style={{ transform: 'scaleX(-1)' }} />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ transform: 'scaleX(-1)' }} />

        {!poseReady && cameraActive && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-white text-center space-y-2">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-white border-t-transparent rounded-full"></div>
              <p>{t('training.loadingPose')}</p>
            </div>
          </div>
        )}

        {!cameraActive && (
          <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
            <button onClick={handleStartCamera} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium text-lg hover:bg-blue-700 transition">
              &#128247; {t('training.startCamera')}
            </button>
          </div>
        )}

        {/* Briefing overlay */}
        {phase === PHASE.BRIEFING && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 sm:p-6">
            <div className="bg-white rounded-2xl p-4 sm:p-6 max-w-sm w-full text-center space-y-4 max-h-[85vh] overflow-y-auto">
              <div className="text-3xl">&#127897;</div>
              <h3 className="text-lg font-bold text-gray-800">{currentExercise?.name}</h3>
              <p className="text-sm text-gray-600">{currentExercise?.description}</p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                <span className="font-bold">{LOCATION_ICONS[currentLocation]} {isHe ? 'הכנה' : 'Setup'}:</span>{' '}
                {locationProps.setup}
              </div>
              {currentExercise?.tips && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">{currentExercise.tips}</div>
              )}
              <div className="text-xs text-gray-400">
                {currentExercise?.sets} {t('training.set')} | {currentExercise?.reps} {t('training.reps')} | {currentExercise?.restSeconds}{t('dashboard.secRest')}
              </div>
              <button onClick={handleStartAfterBriefing} className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-bold text-lg hover:opacity-90 transition">
                {t('training.briefingReady')}
              </button>
            </div>
          </div>
        )}

        {/* Equipment check overlay */}
        {phase === PHASE.CHECKING_EQUIPMENT && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center space-y-4">
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
                      setPhase(PHASE.EXERCISING);
                      setTimer(0);
                      lastActivityRef.current = Date.now();
                      exerciseStartTimeRef.current = Date.now();
                      lastNudgeTimeRef.current = 0;
                      speakSetStart(currentSet, totalSets);
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

        {/* Warm-up overlay */}
        {phase === PHASE.WARM_UP && currentWarmUp && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-between p-4 sm:p-6">
            {/* Top: exercise name + description */}
            <div className="bg-white/95 rounded-2xl p-4 w-full max-w-sm text-center space-y-2 mt-2">
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl">{warmUpIdx === 0 ? '\uD83D\uDCAA' : warmUpIdx === 1 ? '\uD83E\uDDBF' : '\u2194\uFE0F'}</span>
                <h3 className="text-lg font-bold text-gray-800">
                  {isHe ? currentWarmUp.name.he : currentWarmUp.name.en}
                </h3>
              </div>
              <p className="text-sm text-gray-500">
                {isHe ? currentWarmUp.description.he : currentWarmUp.description.en}
              </p>
              <div className="flex items-center justify-center gap-1 text-xs text-gray-400">
                {warmUpExercises.map((_, i) => (
                  <div key={i} className={`w-2 h-2 rounded-full ${i < warmUpIdx ? 'bg-green-500' : i === warmUpIdx ? 'bg-orange-500' : 'bg-gray-300'}`} />
                ))}
              </div>
            </div>

            {/* Center: big countdown */}
            <div className="text-center">
              <div className="text-8xl font-bold text-white drop-shadow-lg">{warmUpTimer}</div>
              {warmUpPaused && (
                <div className="mt-2 inline-block bg-red-600 text-white px-4 py-1 rounded-full text-sm font-bold animate-pulse">
                  {isHe ? 'מושהה - זוז!' : 'PAUSED - move!'}
                </div>
              )}
              <div className="text-white/70 text-sm mt-1">
                {isHe ? `תרגיל ${warmUpIdx + 1} מתוך ${warmUpExercises.length}` : `Exercise ${warmUpIdx + 1} of ${warmUpExercises.length}`}
              </div>
            </div>

            {/* Bottom: feedback + skip */}
            <div className="w-full max-w-sm space-y-3">
              {feedback && (
                <div className={`${feedbackColor[feedback.type] || 'bg-blue-500'} text-white px-4 py-2 rounded-xl text-center font-bold text-sm`}>
                  {feedback.text}
                </div>
              )}
              <button
                onClick={() => {
                  clearInterval(warmUpTimerRef.current);
                  setWarmUpDone(true);
                  speakWarmUpComplete(playerName);
                  setFeedback(null);
                  setTimeout(() => setPhase(PHASE.IDLE), 2500);
                }}
                className="w-full py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition text-sm"
              >
                {isHe ? 'דלג על חימום' : 'Skip warm-up'} &#9654;
              </button>
            </div>
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

        {/* Live feedback overlay */}
        {feedback && phase === PHASE.EXERCISING && (
          <div className={`absolute top-4 left-4 right-4 ${feedbackColor[feedback.type] || 'bg-blue-500'} text-white px-4 py-3 rounded-xl text-center font-bold text-lg shadow-lg`}>
            {feedback.type === 'count' && <span className="text-3xl sm:text-4xl block">{feedback.count}</span>}
            {feedback.text}
          </div>
        )}

        {/* Set counter */}
        {phase === PHASE.EXERCISING && (
          <div className="absolute top-4 right-4 bg-purple-600/90 text-white px-3 py-2 rounded-xl text-sm font-bold">
            {t('training.set')} {currentSet}/{totalSets}
          </div>
        )}

        {/* Rep counter */}
        {phase === PHASE.EXERCISING && displayReps != null && (
          <div className="absolute bottom-4 right-4 bg-black/70 text-white px-4 py-2 rounded-xl">
            <span className="text-sm">{t('training.reps')}: </span>
            <span className="text-2xl font-bold">{displayReps}</span>
            <span className="text-sm text-white/60">/{currentExercise?.reps || '?'}</span>
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

      {cameraError && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{t('training.cameraError')}: {cameraError}</div>
      )}

      {exercises.length === 0 ? (
        <div className="text-center text-gray-500 py-8">{t('training.noExercises')}</div>
      ) : (
        <div className="space-y-3">
          {currentExercise && (
            <div className="bg-white rounded-xl shadow-lg p-5 border-2 border-blue-500 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-blue-600 font-medium">
                  {t('training.currentExercise')} ({currentIdx + 1}/{exercises.length})
                </span>
                <span className="text-xs text-gray-400">
                  {totalSets} {t('dashboard.sets')} | {currentExercise.reps} {t('dashboard.reps')} | {restDuration}{t('dashboard.secRest')}
                </span>
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
                <button onClick={handlePrevExercise} disabled={currentIdx === 0} className="px-4 py-2 min-h-[44px] border border-gray-300 rounded-lg text-sm disabled:opacity-30">
                  {t('training.prevExercise')}
                </button>
                {phase === PHASE.IDLE || phase === PHASE.EXERCISE_DONE ? (
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
                  exerciseStateRef.current = {}; setDisplayReps(0); setSetsPerformance([]); setCurrentSet(1); resetAllTracking();
                }}
                className={`text-start p-3 rounded-lg border transition ${
                  i === currentIdx ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-800">{i + 1}. {ex.name}</span>
                  <span className="text-xs text-gray-400">{ex.sets}x{ex.reps}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
