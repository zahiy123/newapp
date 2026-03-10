import { useCallback, useRef } from 'react';
import { getCoachingRate, getCoachingPitch } from '../utils/ageAdaptive';

export function useSpeech(lang = 'he-IL') {
  const speaking = useRef(false);
  const queueRef = useRef([]);
  const currentUtteranceRef = useRef(null);
  const speechStartedAtRef = useRef(0);
  const isHe = lang.startsWith('he');

  // Low-level helper: speak a single utterance, does NOT clear queue
  const _utterSpeak = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = options.rate || 1;
    utterance.pitch = options.pitch || 1;
    utterance.volume = options.volume || 1;

    speaking.current = true;
    speechStartedAtRef.current = Date.now();
    currentUtteranceRef.current = utterance;
    utterance.onend = () => {
      speaking.current = false;
      currentUtteranceRef.current = null;
      speechStartedAtRef.current = 0;
      processQueue();
    };
    utterance.onerror = () => {
      speaking.current = false;
      currentUtteranceRef.current = null;
      speechStartedAtRef.current = 0;
      processQueue();
    };

    window.speechSynthesis.speak(utterance);
  }, [lang]);

  // Internal helper: cancel previous speech, clear queue, then speak
  const _doSpeak = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    queueRef.current = [];
    _utterSpeak(text, options);
  }, [_utterSpeak]);

  // Default speak: if currently speaking and < 2s in, skip (don't cut)
  const speak = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    if (speaking.current) {
      const elapsed = Date.now() - speechStartedAtRef.current;
      if (elapsed < 2000) return; // don't cut short speech
    }
    _doSpeak(text, options);
  }, [_doSpeak]);

  // Priority speak: always cuts previous speech (for urgent nudges/warnings)
  const speakPriority = useCallback((text, options = {}) => {
    _doSpeak(text, options);
  }, [_doSpeak]);

  // Idle speak: only speaks if not currently speaking (for encouragement/info feedback)
  const speakIfIdle = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    if (speaking.current) return; // skip entirely if busy
    _doSpeak(text, options);
  }, [_doSpeak]);

  const speakQueued = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    if (speaking.current) {
      queueRef.current.push({ text, options });
      return;
    }
    _doSpeak(text, options);
  }, [_doSpeak]);

  function processQueue() {
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      _utterSpeak(next.text, next.options);
    }
  }

  // Pre-exercise briefing with location-aware equipment setup
  const speakBriefing = useCallback((exerciseName, description, tips, locationProps) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    queueRef.current = [];

    const intro = isHe
      ? `לפני שנתחיל, הנה איך לבצע ${exerciseName}.`
      : `Before we start, here is how to do ${exerciseName}.`;

    const desc = description ? `${description}.` : '';

    // Location-aware equipment setup instruction
    const setupText = locationProps?.setup
      ? (isHe ? `הכנה: ${locationProps.setup}.` : `Setup: ${locationProps.setup}.`)
      : '';

    const tipText = tips
      ? (isHe ? `טיפ חשוב: ${tips}` : `Important tip: ${tips}`)
      : '';

    const equipDetect = isHe
      ? 'אני אנסה לזהות את הציוד.'
      : 'I will try to detect your equipment.';

    // Queue all segments, then start first one (don't use _doSpeak which clears queue)
    if (desc) queueRef.current.push({ text: desc, options: {} });
    if (setupText) queueRef.current.push({ text: setupText, options: {} });
    if (tipText) queueRef.current.push({ text: tipText, options: {} });
    queueRef.current.push({ text: equipDetect, options: {} });
    _utterSpeak(intro);
  }, [lang, _utterSpeak, isHe]);

  // Encouragement for good form (only when actively moving) - low priority, don't cut
  const speakEncouragement = useCallback(() => {
    const phrases = isHe
      ? ['ביצוע מעולה!', 'שיווי משקל מושלם!', 'קצב מצוין, ככה!', 'יפה מאוד, כל הכבוד!', 'מקצוען אמיתי!']
      : ['Excellent form!', 'Perfect balance!', 'Great pace, keep it!', 'Great job!', 'Like a true pro!'];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speakIfIdle(phrase, { rate: 1.1 });
  }, [lang, speakIfIdle, isHe]);

  // Correction for bad form
  const speakCorrection = useCallback((specificTip) => {
    const base = isHe
      ? 'אל תוותר! בוא ננסה שוב.'
      : "Don't give up! Let's try again.";
    const tip = specificTip
      ? (isHe ? ` זכור: ${specificTip}` : ` Remember: ${specificTip}`)
      : '';
    speak(base + tip);
  }, [lang, speak, isHe]);

  // Optimization tip after a perfect set
  const speakOptimization = useCallback((tip) => {
    const base = isHe
      ? 'אתה מבצע מעולה!'
      : "You're doing great!";
    const next = tip
      ? (isHe ? ` בפעם הבאה, נסה ${tip}` : ` Next time, try to ${tip}`)
      : '';
    speak(base + next);
  }, [lang, speak, isHe]);

  // Rest time coaching
  const speakRestTip = useCallback((tipText) => {
    const intro = isHe ? 'זמן מנוחה.' : 'Rest time.';
    const tip = tipText ? ` ${tipText}` : '';
    speak(intro + tip);
  }, [lang, speak, isHe]);

  // Set announcement
  const speakSetStart = useCallback((setNum, totalSets) => {
    const text = isHe
      ? `סט ${setNum} מתוך ${totalSets}. יאללה!`
      : `Set ${setNum} of ${totalSets}. Let's go!`;
    speak(text, { rate: 1.1 });
  }, [lang, speak, isHe]);

  // 5s post-briefing nudge with location-aware props (ENERGETIC rate 1.3)
  const speakPostBriefingNudge = useCallback((playerName, locationProps) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const props = locationProps?.markers || (isHe ? 'הציוד' : 'the equipment');
    const text = isHe
      ? `${name}, השעון רץ! סדר את ${props} ויאללה!`
      : `${name}, the clock is ticking! Position your ${props} and let's go!`;
    speak(text, { rate: 1.3, pitch: 1.1 });
  }, [lang, speak, isHe]);

  // General inactivity nudge (ENERGETIC rate 1.25, high priority)
  const speakNudge = useCallback((playerName, shortInstruction) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const base = isHe
      ? `${name}, אני לא רואה אותך זז! יאללה, אתה מקצוען!`
      : `${name}, I don't see you moving! Come on, you're a pro!`;
    const tip = shortInstruction ? ` ${shortInstruction}` : '';
    speakPriority(base + tip, { rate: 1.25, pitch: 1.1 });
  }, [lang, speakPriority, isHe]);

  // Mid-set quit nudge (ENERGETIC rate 1.25, high priority)
  const speakMidSetQuit = useCallback((playerName, repsRemaining) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const text = isHe
      ? `${name}, אל תפסיק עכשיו, אתה מקצוען! רק עוד ${repsRemaining} חזרות לסיום הסט!`
      : `${name}, don't quit now, you're a Pro! Only ${repsRemaining} more reps to finish the set!`;
    speakPriority(text, { rate: 1.25, pitch: 1.1 });
  }, [lang, speakPriority, isHe]);

  // Head-down correction for football drills
  const speakHeadUp = useCallback(() => {
    const text = isHe
      ? 'ראש למעלה! תסתכל על המגרש, לא רק על הכדור!'
      : 'Eyes up! Look at the field, not just the ball!';
    speak(text, { rate: 1.2, pitch: 1.05 });
  }, [lang, speak, isHe]);

  // How-to-start tip when stagnant for 15s
  const speakHowToStart = useCallback((exerciseName, description) => {
    const text = isHe
      ? `כדי להתחיל, עמוד 2 מטר מהמצלמה והתחל את תנועת ${exerciseName}. ${description || ''}`
      : `To start, stand 2 meters from the camera and begin the ${exerciseName} movement. ${description || ''}`;
    speak(text);
  }, [lang, speak, isHe]);

  // Sitting warning - tell user to stand up (high priority)
  const speakSitting = useCallback((playerName) => {
    const name = playerName || (isHe ? 'חבר' : 'buddy');
    const text = isHe
      ? `${name}, אני רואה שאתה יושב. בבקשה קום כדי להתחיל את התרגיל.`
      : `${name}, I see you are sitting. Please stand up to start the drill.`;
    speakPriority(text);
  }, [lang, speakPriority, isHe]);

  // Calm "I'm ready" nudge (no exercise movement detected - gentle, not noisy)
  const speakReadyWhenYouAre = useCallback((playerName) => {
    const name = playerName || (isHe ? 'חבר' : 'buddy');
    const text = isHe
      ? `${name}, אני מוכן כשאתה מוכן.`
      : `${name}, I'm ready when you are.`;
    speak(text, { rate: 0.95 });
  }, [lang, speak, isHe]);

  // Active prodding - rotating motivational lines when standing idle (ENERGETIC rate 1.35)
  const speakActiveProd = useCallback((playerName, prodIndex, locationProps, exerciseDesc) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const equipment = locationProps?.markers || (isHe ? 'הציוד' : 'the equipment');

    const phrasesHe = [
      `${name}, אל תעמוד סתם! יאללה, תראה לי מה אתה יכול!`,
      `${name}, אני מחכה לתנועה הראשונה שלך! סדר את ${equipment} ויאללה!`,
      `${name}, הזמן רץ! אתה מקצוען, תוכיח את זה!`,
      `${name}, מה קרה? יאללה נתחיל! ${exerciseDesc || ''}`,
      `${name}, אתה יכול יותר מזה! סדר את ${equipment} והתחל לזוז!`,
      `${name}, בוא כבר! אני לא הולך לחכות כל היום!`,
      `${name}, זוז! תראה לי שאתה לא מוותר!`,
    ];
    const phrasesEn = [
      `${name}, don't just stand there! Show me what you've got!`,
      `${name}, I'm waiting for your first move! Set up your ${equipment} and let's go!`,
      `${name}, the clock is ticking! You're a pro, prove it!`,
      `${name}, what's the hold-up? Let's get started! ${exerciseDesc || ''}`,
      `${name}, you can do better than this! Set up your ${equipment} and start moving!`,
      `${name}, come on already! I'm not waiting all day!`,
      `${name}, move it! Show me you're not giving up!`,
    ];

    const phrases = isHe ? phrasesHe : phrasesEn;
    const idx = prodIndex % phrases.length;
    speakPriority(phrases[idx], { rate: 1.35, pitch: 1.1 });
    return phrases[idx];
  }, [lang, speakPriority, isHe]);

  // Quick re-explanation at 20s - short summary, not full briefing
  const speakQuickReExplain = useCallback((playerName, exerciseName, description, locationProps) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const equipment = locationProps?.markers || (isHe ? 'הציוד' : 'the equipment');
    const setup = locationProps?.setup || '';
    const desc = description || '';

    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    queueRef.current = [];

    const intro = isHe
      ? `${name}, אולי לא ברור לך איך להתחיל? בוא נסביר מהר.`
      : `${name}, maybe you're not sure how to start? Let me explain quickly.`;
    const howTo = isHe
      ? `${desc} סדר את ${equipment}. ${setup}. יאללה, עכשיו!`
      : `${desc} Set up your ${equipment}. ${setup}. Now let's go!`;

    queueRef.current.push({ text: howTo, options: { rate: 1.35, pitch: 1.1 } });
    _utterSpeak(intro, { rate: 1.35, pitch: 1.1 });
  }, [lang, _utterSpeak, isHe]);

  // === WARM-UP SPEECH ===

  // Warm-up intro
  const speakWarmUpIntro = useCallback((playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const text = isHe
      ? `${name}, לפני שנתחיל את האימון, בוא נחמם את הגוף! זה חשוב למניעת פציעות.`
      : `${name}, before we start the workout, let's warm up! This is important to prevent injuries.`;
    _doSpeak(text, { rate: 1.1 });
  }, [isHe, _doSpeak]);

  // Announce next warm-up exercise — full name + description + player name
  const speakWarmUpExercise = useCallback((exerciseName, description, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const desc = description || '';
    const text = isHe
      ? `${name}, בוא נתחיל ב${exerciseName}! ${desc}. יאללה, עקוב אחריי!`
      : `${name}, let's start ${exerciseName}! ${desc}. Come on, follow me!`;
    speakPriority(text, { rate: 1.15 });
  }, [isHe, speakPriority]);

  // Warm-up pace nudge
  const speakWarmUpNudge = useCallback((playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const phrases = isHe
      ? [`${name}, הגבר את הקצב! תעלה את הדופק!`, `${name}, יאללה, יותר מהר! חימום אמיתי!`, `${name}, זוז! הגוף צריך להתחמם!`]
      : [`${name}, pick up the pace! Get that heart rate up!`, `${name}, come on, faster! Real warm-up!`, `${name}, move it! Your body needs to warm up!`];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speakPriority(phrase, { rate: 1.3, pitch: 1.1 });
  }, [isHe, speakPriority]);

  // Warm-up inactivity nudge — 4s no movement, names the exercise
  const speakWarmUpInactivityNudge = useCallback((exerciseName, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const phrases = isHe
      ? [
        `${name}, אני מחכה! יאללה תתחיל את ה${exerciseName} עכשיו!`,
        `${name}, למה אתה עומד? יאללה ${exerciseName}!`,
        `${name}, הזמן עומד! תתחיל לזוז! ${exerciseName}!`,
      ]
      : [
        `${name}, I'm waiting! Start the ${exerciseName} now!`,
        `${name}, why are you standing? Let's go, ${exerciseName}!`,
        `${name}, the timer is frozen! Start moving! ${exerciseName}!`,
      ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speakPriority(phrase, { rate: 1.3, pitch: 1.1 });
  }, [isHe, speakPriority]);

  // Warm-up re-explain — 15s no movement, repeat full instruction
  const speakWarmUpReExplain = useCallback((exerciseName, description, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const desc = description || '';
    const text = isHe
      ? `${name}, אולי לא ברור? בוא נסביר שוב. ${exerciseName}: ${desc}. יאללה, עכשיו!`
      : `${name}, maybe it's not clear? Let me explain again. ${exerciseName}: ${desc}. Now let's go!`;
    speakPriority(text, { rate: 1.2 });
  }, [isHe, speakPriority]);

  // Warm-up specific correction (keyed by feedback text markers)
  const speakWarmUpCorrection = useCallback((correctionKey, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const corrections = {
      kneesHigher: isHe
        ? `${name}, תרים את הברכיים יותר גבוה! לגובה המותניים!`
        : `${name}, bring your knees higher! Up to waist level!`,
      armCirclesSmall: isHe
        ? `${name}, הגדל את המעגלים! סיבובים רחבים יותר!`
        : `${name}, bigger circles! Wider rotations!`,
      widerSteps: isHe
        ? `${name}, צעדים רחבים יותר לצדדים! תרחיב את הטווח!`
        : `${name}, wider steps to the sides! Extend your range!`,
      armPunchesSmall: isHe
        ? `${name}, תאגרף יותר רחוק! הושט את הזרועות עד הסוף!`
        : `${name}, punch further! Full arm extension!`,
      twistMore: isHe
        ? `${name}, סובב יותר! תסובב את הכתפיים!`
        : `${name}, twist more! Rotate your shoulders!`,
      notMoving: isHe
        ? `${name}, אני לא רואה תנועה! יאללה, זוז!`
        : `${name}, I don't see movement! Come on, move!`,
      kneeToChest: isHe
        ? `${name}, הרם את הברך יותר קרוב לחזה!`
        : `${name}, bring your knee closer to your chest!`,
      kickHigher: isHe
        ? `${name}, בעט יותר גבוה! הושט את הרגל עד הסוף!`
        : `${name}, kick higher! Extend your leg fully!`,
      hopMore: isHe
        ? `${name}, קפוץ יותר גבוה! השתמש בקביים לאיזון!`
        : `${name}, hop higher! Use your crutches for balance!`,
      singleArmSmall: isHe
        ? `${name}, הגדל את הסיבוב! סיבוב מלא עם היד!`
        : `${name}, bigger circles! Full rotation with your arm!`,
    };
    const text = corrections[correctionKey];
    if (text) speakPriority(text, { rate: 1.25, pitch: 1.05 });
  }, [isHe, speakPriority]);

  // Disability-specific safety/coaching tip
  const speakDisabilityTip = useCallback((key, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const tips = {
      crutchStable: isHe
        ? `${name}, וודא שהקביים יציבות לפני שאתה מתחיל`
        : `${name}, make sure your crutches are stable before you start`,
      useRemainingArm: isHe
        ? `${name}, השתמש ביד הפעילה שלך לאיזון`
        : `${name}, use your remaining arm for balance`,
      crutchKick: isHe
        ? `${name}, היישען חזק על הקביים לפני שאתה בועט`
        : `${name}, lean firmly on your crutches before you kick`,
    };
    const text = tips[key];
    if (text) speakPriority(text, { rate: 1.1 });
  }, [isHe, speakPriority]);

  // Warm-up complete transition
  const speakWarmUpComplete = useCallback((playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const text = isHe
      ? `מעולה ${name}, אתה חם ומוכן! עכשיו נתחיל את האימון הראשי.`
      : `Great ${name}, you're warmed up and ready! Now let's start the main workout.`;
    speakPriority(text, { rate: 1.1 });
  }, [isHe, speakPriority]);

  // Equipment found announcement
  const speakEquipmentFound = useCallback((objectName) => {
    const text = isHe
      ? `מעולה! אני רואה ${objectName}! הציוד מוכן.`
      : `Great! I can see a ${objectName}! Equipment is ready.`;
    speakPriority(text, { rate: 1.1 });
  }, [isHe, speakPriority]);

  // Mind-muscle connection cues — calm, non-interrupting
  // Now accepts cueKey directly (from getAnalyzer) instead of parsing exercise name
  const speakMindMuscleCue = useCallback((cueKeyOrName, phase, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');

    const cues = {
      he: {
        push_down: `${name}, תרגיש את השרירי חזה מתכווצים בירידה`,
        push_up: `${name}, דחוף חזק! תרגיש את הטריצפס עובד`,
        squat_down: `${name}, תרגיש את הארבע ראשי עובדים בירידה`,
        squat_up: `${name}, דחוף דרך העקבים! תרגיש את הישבן`,
        lunge_down: `${name}, תרגיש את שריר הירך הקדמי נמתח`,
        lunge_up: `${name}, דחוף למעלה! תרגיש את הישבן דוחף`,
        shoulder_down: `${name}, שליטה בירידה! תרגיש את הכתפיים`,
        shoulder_up: `${name}, דחוף למעלה! תרגיש את הדלתא עובדת`,
        plank: `${name}, חזק את הליבה! תרגיש את הבטן עובדת`,
        dip_down: `${name}, תרגיש את הטריצפס נמתח בירידה`,
        dip_up: `${name}, דחוף חזק! תרגיש את הכתפיים והטריצפס`,
        bicep_down: `${name}, שליטה בירידה! תרגיש את הביספס נמתח`,
        bicep_up: `${name}, כווץ חזק! תרגיש את הביספס עובד`,
        tricep_down: `${name}, תרגיש את הטריצפס נמתח מאחורי הראש`,
        tricep_up: `${name}, יישר את הזרועות! תרגיש את הטריצפס דוחף`,
        row_down: `${name}, שחרר לאט! תרגיש את הגב נמתח`,
        row_up: `${name}, משוך לכיוון הבטן! תרגיש את הגב העליון`,
        lateral_down: `${name}, שליטה בירידה! אל תיפול מהר`,
        lateral_up: `${name}, הרם לצדדים! תרגיש את הכתפיים שורפות`,
        bridge_down: `${name}, הורד לאט! שליטה מלאה`,
        bridge_up: `${name}, סחוט את הישבן למעלה! תרגיש אותו עובד`,
        wallsit: `${name}, החזק חזק! תרגיש את הירכיים שורפות`,
        mountain: `${name}, קצב מהיר! תרגיש את הליבה מייצבת`,
        crunch_down: `${name}, שחרר בשליטה! אל תיפול`,
        crunch_up: `${name}, כווץ את הבטן! תרגיש את שרירי הבטן`,
        sideplank: `${name}, החזק! תרגיש את האלכסוניים עובדים`,
        pullApart_together: `${name}, חזור לאט! שליטה`,
        pullApart_apart: `${name}, משוך לצדדים! תרגיש את הכתפיים האחוריות`,
        default: `${name}, התרכז בשריר שעובד! תרגיש את התנועה`,
      },
      en: {
        push_down: `${name}, feel your chest muscles engaging on the way down`,
        push_up: `${name}, push strong! Feel your triceps working`,
        squat_down: `${name}, feel your quads working on the descent`,
        squat_up: `${name}, drive through your heels! Feel your glutes`,
        lunge_down: `${name}, feel the stretch in your front quad`,
        lunge_up: `${name}, push up! Feel your glutes driving`,
        shoulder_down: `${name}, control the descent! Feel your shoulders`,
        shoulder_up: `${name}, push up! Feel your delts working`,
        plank: `${name}, brace your core! Feel your abs working`,
        dip_down: `${name}, feel the tricep stretch on the way down`,
        dip_up: `${name}, push strong! Feel your shoulders and triceps`,
        bicep_down: `${name}, control the descent! Feel the bicep stretching`,
        bicep_up: `${name}, squeeze hard! Feel your biceps working`,
        tricep_down: `${name}, feel the tricep stretch behind your head`,
        tricep_up: `${name}, extend your arms! Feel the triceps pushing`,
        row_down: `${name}, release slowly! Feel your back stretching`,
        row_up: `${name}, pull to your belly! Feel your upper back`,
        lateral_down: `${name}, control the descent! Don't drop fast`,
        lateral_up: `${name}, raise to the sides! Feel your shoulders burning`,
        bridge_down: `${name}, lower slowly! Full control`,
        bridge_up: `${name}, squeeze your glutes up! Feel them working`,
        wallsit: `${name}, hold strong! Feel your quads burning`,
        mountain: `${name}, fast pace! Feel your core stabilizing`,
        crunch_down: `${name}, release with control! Don't drop`,
        crunch_up: `${name}, crunch your abs! Feel the burn`,
        sideplank: `${name}, hold it! Feel your obliques working`,
        pullApart_together: `${name}, return slowly! Control`,
        pullApart_apart: `${name}, pull apart! Feel your rear delts`,
        default: `${name}, focus on the muscle working! Feel the movement`,
      }
    };

    const langCues = isHe ? cues.he : cues.en;

    // cueKey-based routing: map cueKey + phase → specific cue
    const key = cueKeyOrName || 'default';
    const PHASE_MAP = {
      push: { down: 'push_down', up: 'push_up' },
      squat: { down: 'squat_down', up: 'squat_up' },
      lunge: { down: 'lunge_down', up: 'lunge_up' },
      shoulder: { down: 'shoulder_down', up: 'shoulder_up' },
      dip: { down: 'dip_down', up: 'dip_up' },
      bicep: { down: 'bicep_down', up: 'bicep_up' },
      tricep: { down: 'tricep_down', up: 'tricep_up' },
      row: { down: 'row_down', up: 'row_up' },
      lateral: { down: 'lateral_down', up: 'lateral_up' },
      bridge: { down: 'bridge_down', up: 'bridge_up' },
      crunch: { down: 'crunch_down', up: 'crunch_up' },
      pullApart: { together: 'pullApart_together', apart: 'pullApart_apart' },
    };

    // Hold-type exercises (no phase)
    const HOLD_MAP = { plank: 'plank', wallsit: 'wallsit', sideplank: 'sideplank', mountain: 'mountain' };

    let resolvedKey = 'default';
    if (HOLD_MAP[key]) {
      resolvedKey = HOLD_MAP[key];
    } else if (PHASE_MAP[key]) {
      resolvedKey = PHASE_MAP[key][phase] || PHASE_MAP[key].up || 'default';
    }

    const text = langCues[resolvedKey] || langCues.default;
    speakIfIdle(text, { rate: 1.0, pitch: 0.95 });
  }, [isHe, speakIfIdle]);

  // AI-generated coaching sentence — age-adaptive rate/pitch
  const speakAICoaching = useCallback((text, age, isUrgent = false) => {
    if (!text) return;
    const rate = getCoachingRate(age);
    const pitch = getCoachingPitch(age);
    if (isUrgent) {
      speakPriority(text, { rate, pitch });
    } else {
      speak(text, { rate, pitch });
    }
  }, [speak, speakPriority]);

  // Environment scan results speech
  const speakEnvironmentScan = useCallback((scanResult) => {
    if (!scanResult) return;
    const { hazards, equipment, overallSafety } = scanResult;

    let text = '';
    if (overallSafety === 'unsafe' || (hazards && hazards.length > 0)) {
      text = isHe
        ? `זהירות! ${hazards.map(h => h.warning).join('. ')}`
        : `Caution! ${hazards.map(h => h.warning).join('. ')}`;
    } else if (equipment && equipment.length > 0) {
      text = isHe
        ? `הכל נראה בטוח. ${equipment.map(e => e.suggestion).join('. ')}`
        : `Everything looks safe. ${equipment.map(e => e.suggestion).join('. ')}`;
    } else {
      text = isHe
        ? 'הסביבה נראית בטוחה. יאללה נתחיל!'
        : 'The environment looks safe. Let\'s go!';
    }
    speakPriority(text, { rate: 1.0 });
  }, [isHe, speakPriority]);

  // Rep count
  const speakCount = useCallback((count) => {
    _doSpeak(count.toString(), { rate: 1.3 });
  }, [_doSpeak]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    speaking.current = false;
    speechStartedAtRef.current = 0;
    queueRef.current = [];
    currentUtteranceRef.current = null;
  }, []);

  const isSpeaking = () => speaking.current;

  return {
    speak,
    speakPriority,
    speakIfIdle,
    speakQueued,
    speakBriefing,
    speakEncouragement,
    speakCorrection,
    speakOptimization,
    speakRestTip,
    speakSetStart,
    speakPostBriefingNudge,
    speakNudge,
    speakMidSetQuit,
    speakHeadUp,
    speakHowToStart,
    speakSitting,
    speakReadyWhenYouAre,
    speakActiveProd,
    speakQuickReExplain,
    speakEquipmentFound,
    speakWarmUpIntro,
    speakWarmUpExercise,
    speakWarmUpNudge,
    speakWarmUpInactivityNudge,
    speakWarmUpReExplain,
    speakWarmUpCorrection,
    speakWarmUpComplete,
    speakDisabilityTip,
    speakMindMuscleCue,
    speakAICoaching,
    speakEnvironmentScan,
    speakCount,
    stop,
    isSpeaking
  };
}
