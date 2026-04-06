import { useCallback, useRef, useEffect } from 'react';
import { getCoachingRate, getCoachingPitch, getLifeStage } from '../utils/ageAdaptive';

export function useSpeech(lang = 'he-IL', age) {
  const speaking = useRef(false);
  const queueRef = useRef([]);
  const currentUtteranceRef = useRef(null);
  const speechStartedAtRef = useRef(0);
  const audioUnlockedRef = useRef(false);
  const preferredVoiceRef = useRef(null);
  const audioCtxRef = useRef(null);
  const silentSourceRef = useRef(null);
  const isHe = lang.startsWith('he');
  const lifeStage = getLifeStage(age);
  const processingQueueRef = useRef(false);
  const processQueueRef = useRef(null); // ref to processQueue function (avoids circular deps)
  const nameSpokenAtRef = useRef(0); // Timestamp when name was last spoken (60s cooldown)
  const NAME_COOLDOWN_MS = 60000; // Say name at most once per 60s

  // Split long text into TTS-safe chunks (max ~15 words per chunk)
  // Mobile TTS engines crash on long sentences — this prevents mid-sentence cuts
  const splitToChunks = useCallback((text) => {
    if (!text) return [];
    // Split on sentence-ending punctuation first, then on commas
    const sentences = text.split(/(?<=[.!?؟])\s+/).filter(Boolean);
    const chunks = [];
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      if (words.length <= 15) {
        chunks.push(sentence.trim());
      } else {
        // Split long sentence on commas or semicolons
        const parts = sentence.split(/(?<=[,;،])\s+/).filter(Boolean);
        let current = '';
        for (const part of parts) {
          const combined = current ? `${current} ${part}` : part;
          if (combined.split(/\s+/).length > 15 && current) {
            chunks.push(current.trim());
            current = part;
          } else {
            current = combined;
          }
        }
        if (current) chunks.push(current.trim());
      }
    }
    return chunks.filter(c => c.length > 0);
  }, []);

  // Pick Hebrew/English voice — broad search for Android compatibility
  const pickVoice = useCallback(() => {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    console.log('[Speech] Available voices:', voices.length, voices.map(v => `${v.name}(${v.lang})`).slice(0, 10));
    const langBase = lang.split('-')[0]; // 'he' or 'en'
    // Search order: exact match → prefix match → name contains "Hebrew"/"Israel"
    const exact = voices.find(v => v.lang === lang);
    const prefix = voices.find(v => v.lang.startsWith(langBase));
    const byName = voices.find(v => v.name.toLowerCase().includes(langBase === 'he' ? 'hebrew' : 'english')
      || v.name.toLowerCase().includes(langBase === 'he' ? 'israel' : 'united states'));
    const chosen = exact || prefix || byName || null;
    preferredVoiceRef.current = chosen;
    console.log('[Speech] Picked voice:', chosen?.name, chosen?.lang);
  }, [lang]);

  // useEffect for onvoiceschanged — critical for Android Chrome
  useEffect(() => {
    pickVoice();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        console.log('[Speech] onvoiceschanged fired');
        pickVoice();
      };
    }
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, [pickVoice]);

  // Get or create AudioContext
  const getAudioCtx = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Speech] AudioContext created, state:', audioCtxRef.current.state);
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch (e) {
      console.warn('[Speech] AudioContext error:', e);
      return null;
    }
  }, []);

  // Start a silent audio loop — keeps Android audio channel alive
  const startSilentLoop = useCallback(() => {
    if (silentSourceRef.current) return; // already running
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      // Create a silent oscillator at near-zero gain — holds the audio channel open
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.001; // practically silent
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      silentSourceRef.current = { osc, gain };
      console.log('[Speech] Silent audio loop started');
    } catch (e) {
      console.warn('[Speech] Silent loop error:', e);
    }
  }, [getAudioCtx]);

  // Low-level helper: speak a single utterance, does NOT clear queue
  const _utterSpeak = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;

    // Android Chrome: resume speechSynthesis + AudioContext before every speak
    try { window.speechSynthesis.resume(); } catch {}
    getAudioCtx(); // ensure AudioContext is alive

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    // Clamp rate to safe range for Google TTS engine (0.8-1.2)
    const rawRate = options.rate || 1;
    utterance.rate = Math.min(Math.max(rawRate, 0.8), 1.2);
    utterance.pitch = options.pitch || 1;
    utterance.volume = 1; // Always max volume
    // Use preferred voice if available
    if (preferredVoiceRef.current) {
      utterance.voice = preferredVoiceRef.current;
    }

    speaking.current = true;
    speechStartedAtRef.current = Date.now();
    currentUtteranceRef.current = utterance;

    utterance.onstart = () => {
      console.log('[Speech] onstart:', text.substring(0, 40));
    };
    utterance.onend = () => {
      console.log('[Speech] onend:', text.substring(0, 40));
      speaking.current = false;
      currentUtteranceRef.current = null;
      speechStartedAtRef.current = 0;
      if (processQueueRef.current) processQueueRef.current();
    };
    utterance.onerror = (e) => {
      console.warn('[Speech] onerror:', e.error, text.substring(0, 40));
      speaking.current = false;
      currentUtteranceRef.current = null;
      speechStartedAtRef.current = 0;
      if (processQueueRef.current) processQueueRef.current();
    };

    window.speechSynthesis.speak(utterance);
  }, [lang, getAudioCtx]);

  // Unlock audio on mobile — must be called from a user gesture (tap/click)
  const unlockAudio = useCallback(() => {
    if (!window.speechSynthesis) return;
    console.log('[Speech] unlockAudio called');

    // 1. Resume speechSynthesis
    try { window.speechSynthesis.resume(); } catch {}

    // 2. Cancel any stuck queue, then speak silent dot to unlock pipeline
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('.');
    utterance.volume = 0.01;
    utterance.lang = lang;
    if (preferredVoiceRef.current) utterance.voice = preferredVoiceRef.current;
    utterance.onstart = () => console.log('[Speech] unlock utterance started');
    utterance.onend = () => console.log('[Speech] unlock utterance ended');
    utterance.onerror = (e) => console.warn('[Speech] unlock utterance error:', e.error);
    window.speechSynthesis.speak(utterance);

    // 3. Create AudioContext + start silent loop to hold the channel
    getAudioCtx();
    startSilentLoop();

    // 4. Keepalive interval for both iOS Safari and Android Chrome
    if (!window._speechKeepAlive) {
      window._speechKeepAlive = setInterval(() => {
        if (!window.speechSynthesis) return;
        // Nudge speechSynthesis to prevent 15s auto-pause (iOS/Android)
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
        // Keep AudioContext alive
        try {
          if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
        } catch {}
      }, 5000); // Every 5s (more aggressive)
    }

    // 5. Pick voice if not yet found (Android late-load)
    if (!preferredVoiceRef.current) pickVoice();

    audioUnlockedRef.current = true;
  }, [lang, pickVoice, getAudioCtx, startSilentLoop]);

  // Process queue: speak next item if nothing is playing
  const processQueue = useCallback(() => {
    if (processingQueueRef.current) return;
    if (queueRef.current.length === 0) return;
    if (speaking.current) return;
    processingQueueRef.current = true;
    const next = queueRef.current.shift();
    processingQueueRef.current = false;
    if (next) _utterSpeak(next.text, next.options);
  }, [_utterSpeak]);

  // Keep ref in sync so _utterSpeak's onend can call it
  processQueueRef.current = processQueue;

  // Safety: reset stuck speaking flag if onend/onerror never fired (Android Chrome bug)
  // Check before every speak attempt — if stuck for > 8s, force reset
  const unstickSpeaking = useCallback(() => {
    if (speaking.current && speechStartedAtRef.current > 0) {
      const elapsed = Date.now() - speechStartedAtRef.current;
      if (elapsed > 8000) {
        console.warn('[Speech] Force-resetting stuck speaking flag after', elapsed, 'ms');
        window.speechSynthesis.cancel();
        speaking.current = false;
        speechStartedAtRef.current = 0;
        currentUtteranceRef.current = null;
        queueRef.current = [];
      }
    }
  }, []);

  // Internal helper: cancel previous speech, clear queue, then speak
  // Used ONLY for priority/urgent messages
  const _doSpeak = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    unstickSpeaking();
    window.speechSynthesis.cancel();
    queueRef.current = [];
    speaking.current = false;
    // Chunk the text for TTS stability
    const chunks = splitToChunks(text);
    if (chunks.length <= 1) {
      _utterSpeak(text, options);
    } else {
      // Queue all chunks after the first
      for (let i = 1; i < chunks.length; i++) {
        queueRef.current.push({ text: chunks[i], options });
      }
      _utterSpeak(chunks[0], options);
    }
  }, [_utterSpeak, splitToChunks, unstickSpeaking]);

  // Default speak: queues text WITHOUT canceling current speech
  // If nothing is playing, starts immediately. If busy, adds to queue.
  const speak = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    unstickSpeaking();
    const chunks = splitToChunks(text);
    if (chunks.length === 0) return;
    if (!speaking.current) {
      // Not speaking — start first chunk, queue the rest
      for (let i = 1; i < chunks.length; i++) {
        queueRef.current.push({ text: chunks[i], options });
      }
      _utterSpeak(chunks[0], options);
    } else {
      // Currently speaking — queue all chunks
      for (const chunk of chunks) {
        queueRef.current.push({ text: chunk, options });
      }
    }
  }, [_utterSpeak, splitToChunks, unstickSpeaking]);

  // Priority speak: always cuts previous speech (for urgent nudges/warnings)
  const speakPriority = useCallback((text, options = {}) => {
    _doSpeak(text, options);
  }, [_doSpeak]);

  // Idle speak: only speaks if not currently speaking (for encouragement/info feedback)
  const speakIfIdle = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    unstickSpeaking();
    if (speaking.current) return; // skip entirely if busy
    const chunks = splitToChunks(text);
    if (chunks.length === 0) return;
    for (let i = 1; i < chunks.length; i++) {
      queueRef.current.push({ text: chunks[i], options });
    }
    _utterSpeak(chunks[0], options);
  }, [_utterSpeak, splitToChunks, unstickSpeaking]);

  // Queued speak: always adds to queue, never cancels (used for vision coaching after count)
  const speakQueued = useCallback((text, options = {}) => {
    if (!window.speechSynthesis || !text) return;
    unstickSpeaking();
    const chunks = splitToChunks(text);
    if (chunks.length === 0) return;
    if (!speaking.current && queueRef.current.length === 0) {
      for (let i = 1; i < chunks.length; i++) {
        queueRef.current.push({ text: chunks[i], options });
      }
      _utterSpeak(chunks[0], options);
    } else {
      for (const chunk of chunks) {
        queueRef.current.push({ text: chunk, options });
      }
    }
  }, [_utterSpeak, splitToChunks, unstickSpeaking]);

  // Pre-exercise briefing — full coach persona: explain, safety, motivate
  // Uses chunking for each segment to prevent TTS cuts on mobile
  const speakBriefing = useCallback((exerciseName, description, tips, locationProps, playerName) => {
    if (!window.speechSynthesis) return;
    // Resume + ensure audio before briefing
    try { window.speechSynthesis.resume(); } catch {}
    getAudioCtx();
    window.speechSynthesis.cancel();
    queueRef.current = [];
    speaking.current = false;

    const name = playerName || (isHe ? 'אלוף' : 'champ');

    // Part 1: Energetic intro with exercise name
    const intro = isHe
      ? `יאללה ${name}! עכשיו נעשה ${exerciseName}!`
      : `Let's go ${name}! Now we're doing ${exerciseName}!`;

    // Part 2: How to do it (description) — chunked
    const desc = description
      ? (isHe ? `ככה עושים את זה: ${description}.` : `Here's how: ${description}.`)
      : '';

    // Part 3: Safety tip
    const safetyText = tips
      ? (isHe ? `דגש בטיחות: ${tips}.` : `Safety note: ${tips}.`)
      : '';

    // Part 4: Setup instruction
    const setupText = locationProps?.setup
      ? (isHe ? `הכנה: ${locationProps.setup}.` : `Setup: ${locationProps.setup}.`)
      : '';

    // Part 5: Motivational start cue (no name — already said in intro)
    const startCue = isHe
      ? `אני צופה בך. בוא נתחיל!`
      : `I'm watching you. Let's start!`;

    // Queue all segments — chunk each one for stability
    const queueChunked = (text, options = {}) => {
      const chunks = splitToChunks(text);
      for (const chunk of chunks) {
        queueRef.current.push({ text: chunk, options });
      }
    };

    if (desc) queueChunked(desc);
    if (safetyText) queueChunked(safetyText);
    if (setupText) queueChunked(setupText);
    queueChunked(startCue, { rate: 1.1 });
    _utterSpeak(intro, { rate: 1.1 });
  }, [lang, _utterSpeak, isHe, getAudioCtx, splitToChunks]);

  // Encouragement for good form (only when actively moving) - low priority, don't cut
  const speakEncouragement = useCallback(() => {
    let phrases;
    if (lifeStage === 'kids') {
      phrases = isHe
        ? ['!וואו, סופר כוכב', '!כל הכבוד, אלוף על', '!יש לך כוחות על', '!מדהים, ככה ממשיכים']
        : ['Wow, super star!', 'Amazing job, champion!', 'You have super powers!', 'Incredible, keep going!'];
    } else if (lifeStage === 'longevity') {
      phrases = isHe
        ? ['ביצוע מעולה, שמור על נשימה יציבה', 'יציבות מושלמת, כל הכבוד', 'תנועה מבוקרת, ממש יפה', 'מצוין, המפרקים שלך יודו לך']
        : ['Excellent form, keep breathing steady', 'Perfect stability, well done', 'Controlled movement, beautiful', 'Great, your joints will thank you'];
    } else {
      phrases = isHe
        ? ['ביצוע מעולה!', 'שיווי משקל מושלם!', 'קצב מצוין, ככה!', 'יפה מאוד, כל הכבוד!', 'מקצוען אמיתי!']
        : ['Excellent form!', 'Perfect balance!', 'Great pace, keep it!', 'Great job!', 'Like a true pro!'];
    }
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speakIfIdle(phrase, { rate: 1.1 });
  }, [lang, speakIfIdle, isHe, lifeStage]);

  // Correction for form — encouraging, guiding tone
  const speakCorrection = useCallback((specificTip) => {
    let base;
    if (lifeStage === 'kids') {
      base = isHe ? 'אפשר עוד יותר טוב! נסה ככה...' : 'You can do even better! Try like this...';
    } else if (lifeStage === 'longevity') {
      base = isHe ? 'שמור על המפרקים. תנועה איטית ומבוקרת.' : 'Protect your joints. Slow, controlled movement.';
    } else {
      base = isHe ? 'כיוון טוב! בוא נשפר קצת.' : "Good direction! Let's refine a bit.";
    }
    const tip = specificTip
      ? (isHe ? ` נסה: ${specificTip}` : ` Try: ${specificTip}`)
      : '';
    speak(base + tip);
  }, [lang, speak, isHe, lifeStage]);

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
    let text;
    if (lifeStage === 'kids') {
      text = isHe
        ? `משחק ${setNum} מתוך ${totalSets}! יאללה נשחק!`
        : `Game ${setNum} of ${totalSets}! Let's play!`;
    } else if (lifeStage === 'longevity') {
      text = isHe
        ? `סט ${setNum} מתוך ${totalSets}. קח נשימה עמוקה ונתחיל.`
        : `Set ${setNum} of ${totalSets}. Take a deep breath and begin.`;
    } else {
      text = isHe
        ? `סט ${setNum} מתוך ${totalSets}. יאללה!`
        : `Set ${setNum} of ${totalSets}. Let's go!`;
    }
    speak(text, { rate: 1.1 });
  }, [lang, speak, isHe, lifeStage]);

  // 5s post-briefing nudge with location-aware props (ENERGETIC rate 1.3)
  const speakPostBriefingNudge = useCallback((playerName, locationProps) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const props = locationProps?.markers || (isHe ? 'הציוד' : 'the equipment');
    const text = isHe
      ? `${name}, השעון רץ! סדר את ${props} ויאללה!`
      : `${name}, the clock is ticking! Position your ${props} and let's go!`;
    speak(text, { rate: 1.3, pitch: 1.1 });
  }, [lang, speak, isHe]);

  // General inactivity nudge — encouraging
  const speakNudge = useCallback((playerName, shortInstruction) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    let base;
    if (lifeStage === 'kids') {
      base = isHe
        ? `${name}, בוא נשחק! אני מחכה לך!`
        : `${name}, let's play! I'm waiting for you!`;
    } else if (lifeStage === 'longevity') {
      base = isHe
        ? `${name}, קח את הזמן שלך. כשתהיה מוכן, נתחיל באיטיות.`
        : `${name}, take your time. When you're ready, we'll start slowly.`;
    } else {
      base = isHe
        ? `${name}, אני פה ומחכה לך. כשתהיה מוכן, תתחיל לזוז.`
        : `${name}, I'm here waiting for you. Start moving when you're ready.`;
    }
    const tip = shortInstruction ? ` ${shortInstruction}` : '';
    speakPriority(base + tip, { rate: 1.1, pitch: 1.0 });
  }, [lang, speakPriority, isHe, lifeStage]);

  // Mid-set encouragement — motivating, not accusing
  const speakMidSetQuit = useCallback((playerName, repsRemaining) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const text = isHe
      ? `${name}, אתה עושה מעולה! רק עוד ${repsRemaining} חזרות, אתה יכול!`
      : `${name}, you're doing great! Just ${repsRemaining} more reps, you've got this!`;
    speakPriority(text, { rate: 1.2, pitch: 1.0 });
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

  // Active prodding — encouraging & guiding, never blaming (rate 1.2, warm tone)
  const speakActiveProd = useCallback((playerName, prodIndex, locationProps, exerciseDesc) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const equipment = locationProps?.markers || (isHe ? 'הציוד' : 'the equipment');

    const phrasesHe = [
      `${name}, אני פה, קח את הזמן שלך.`,
      `${name}, תנסה להגדיל את טווח התנועה כדי שאוכל לעקוב אחריך.`,
      `${name}, אני מאמין בך! כשתהיה מוכן, תתחיל לזוז.`,
      `${name}, אולי תסדר את ${equipment} ותתחיל כשנוח לך? ${exerciseDesc || ''}`,
      `${name}, אני רואה אותך! תתחיל לאט ותגביר בהדרגה.`,
      `${name}, בוא נעשה את זה ביחד! אתה לא לבד.`,
      `${name}, קח נשימה עמוקה, ויאללה. אני עוקב.`,
    ];
    const phrasesEn = [
      `${name}, I'm here, take your time.`,
      `${name}, try to increase your range of motion so I can follow along.`,
      `${name}, I believe in you! Start moving when you're ready.`,
      `${name}, maybe set up your ${equipment} and start when comfortable? ${exerciseDesc || ''}`,
      `${name}, I can see you! Start slow and build up gradually.`,
      `${name}, let's do this together! You're not alone.`,
      `${name}, take a deep breath, and let's go. I'm watching.`,
    ];

    const phrases = isHe ? phrasesHe : phrasesEn;
    const idx = prodIndex % phrases.length;
    speakPriority(phrases[idx], { rate: 1.2, pitch: 1.0 });
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
    speaking.current = false;

    const intro = isHe
      ? `${name}, אולי לא ברור לך איך להתחיל? בוא נסביר מהר.`
      : `${name}, maybe you're not sure how to start? Let me explain quickly.`;
    const howTo = isHe
      ? `${desc} סדר את ${equipment}. ${setup}. יאללה, עכשיו!`
      : `${desc} Set up your ${equipment}. ${setup}. Now let's go!`;

    // Chunk the howTo for stability
    const chunks = splitToChunks(howTo);
    for (const chunk of chunks) {
      queueRef.current.push({ text: chunk, options: { rate: 1.2, pitch: 1.1 } });
    }
    _utterSpeak(intro, { rate: 1.2, pitch: 1.1 });
  }, [lang, _utterSpeak, isHe, splitToChunks]);

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

  // Warm-up pace encouragement
  const speakWarmUpNudge = useCallback((playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const phrases = isHe
      ? [`${name}, יפה! תנסה להגביר קצת את הקצב.`, `${name}, מצוין! הגוף מתחיל להתחמם.`, `${name}, ממשיכים ככה! עוד קצת.`]
      : [`${name}, great! Try to pick up the pace a bit.`, `${name}, excellent! Your body is warming up.`, `${name}, keep it up! Just a bit more.`];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speakPriority(phrase, { rate: 1.15, pitch: 1.0 });
  }, [isHe, speakPriority]);

  // Warm-up inactivity nudge — gentle, encouraging
  const speakWarmUpInactivityNudge = useCallback((exerciseName, playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const phrases = isHe
      ? [
        `${name}, אני פה. כשתהיה מוכן, תתחיל את ה${exerciseName}.`,
        `${name}, קח את הזמן שלך. ה${exerciseName} מחכה לך.`,
        `${name}, תנסה להתחיל לזוז לאט. אני עוקב אחריך.`,
      ]
      : [
        `${name}, I'm here. Start the ${exerciseName} when you're ready.`,
        `${name}, take your time. The ${exerciseName} is waiting for you.`,
        `${name}, try to start moving slowly. I'm following along.`,
      ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speakPriority(phrase, { rate: 1.1, pitch: 1.0 });
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

  // Not visible — gentle guidance, blame yourself not the user
  const speakNotVisible = useCallback((playerName) => {
    const name = playerName || (isHe ? 'חבר' : 'buddy');
    const phrases = isHe
      ? [
        `${name}, אני לא רואה אותך טוב. תתקרב קצת למצלמה.`,
        `${name}, תנסה להגדיל את טווח התנועה כדי שאוכל לעקוב.`,
        `${name}, אני מתקשה לראות אותך. תוודא שאתה במרכז המצלמה.`,
      ]
      : [
        `${name}, I can't see you well. Try moving closer to the camera.`,
        `${name}, try increasing your range of motion so I can follow.`,
        `${name}, I'm having trouble seeing you. Make sure you're in the center of the camera.`,
      ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    speak(phrase, { rate: 1.0 });
  }, [isHe, speak]);

  // Positive reinforcement — frequent encouragement when user IS moving
  // Name is said only once per 60s to avoid annoying repetition
  const speakPositiveReinforcement = useCallback((playerName) => {
    const now = Date.now();
    const useName = now - nameSpokenAtRef.current > NAME_COOLDOWN_MS;
    const name = playerName || (isHe ? 'אלוף' : 'champ');

    const withName = isHe
      ? [`יפה מאוד ${name}!`, `כל הכבוד ${name}, ביצוע יפה!`, `ככה ${name}! בדיוק ככה!`]
      : [`Great job ${name}!`, `Well done ${name}, nice form!`, `That's it ${name}! Just like that!`];
    const noName = isHe
      ? ['תמשיך ככה!', 'אני רואה אותך עובד!', 'מצוין, ממשיכים!', 'ביצוע חזק!', 'ככה! בדיוק ככה!']
      : ['Keep it up!', 'I can see you working!', 'Excellent, keep going!', 'Strong form!', 'Just like that!'];

    const pool = useName ? withName : noName;
    const phrase = pool[Math.floor(Math.random() * pool.length)];
    if (useName) nameSpokenAtRef.current = now;
    speakIfIdle(phrase, { rate: 1.1 });
  }, [isHe, speakIfIdle]);

  // Rep count
  const speakCount = useCallback((count) => {
    _doSpeak(count.toString(), { rate: 1.3 });
  }, [_doSpeak]);

  // Body-part visibility warnings — self-blaming tone
  // Optional 3rd param `direction` for specific directional hints
  const speakMissingBodyParts = useCallback((missingParts, playerName, direction) => {
    // Directional messages override generic per-part messages
    if (direction === 'down') {
      const msg = isHe
        ? `${playerName}, תכוון את המצלמה למטה, אני לא רואה את הרגליים שלך`
        : `${playerName}, tilt the camera down, I can't see your legs`;
      speakPriority(msg);
      return;
    }
    if (direction === 'up') {
      const msg = isHe
        ? `${playerName}, תכוון את המצלמה למעלה, אני לא רואה את הכתפיים שלך`
        : `${playerName}, tilt the camera up, I can't see your shoulders`;
      speakPriority(msg);
      return;
    }

    const msgs = {
      legs: isHe
        ? `${playerName}, אני לא מצליח לראות את הרגליים שלך. תכוון את המצלמה נמוך יותר`
        : `${playerName}, I can't see your legs. Point the camera lower`,
      arms: isHe
        ? `${playerName}, אני לא רואה את הידיים שלך. תתרחק קצת מהמצלמה`
        : `${playerName}, I can't see your arms. Step back a bit from the camera`,
      hips: isHe
        ? `${playerName}, אני לא רואה את המותניים שלך. תוודא שכל הגוף במסך`
        : `${playerName}, I can't see your hips. Make sure your full body is on screen`,
      all: isHe
        ? `${playerName}, אני לא רואה אותך. תוודא שאתה מול המצלמה`
        : `${playerName}, I can't see you. Make sure you're facing the camera`,
    };
    const part = missingParts[0] || 'all';
    speakPriority(msgs[part] || msgs.all);
  }, [isHe, speakPriority]);

  // Side camera suggestion for lying exercises viewed from front
  const speakSideCamera = useCallback(() => {
    const msg = isHe
      ? 'שים את המצלמה מהצד כדי שאוכל לראות את התנוחה שלך טוב יותר'
      : 'Place the camera to the side so I can see your form better';
    speak(msg);
  }, [isHe, speak]);

  // Resume welcome — when returning to an in-progress workout
  const speakResumeWelcome = useCallback((playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const msg = isHe
      ? `${name}! חזרת! יאללה נמשיך מאיפה שעצרנו`
      : `${name}! Welcome back! Let's pick up where we left off`;
    speakPriority(msg, { rate: 1.2 });
  }, [isHe, speakPriority]);

  // Calibration start — encouraging prep
  const speakCalibrationStart = useCallback((playerName) => {
    const msg = isHe
      ? `בוא נעשה תנועה אחת של הכנה כדי שאוכל להבין את הטווח שלך`
      : `Let's do one prep movement so I can understand your range`;
    speakPriority(msg);
  }, [isHe, speakPriority]);

  // Calibration done — quick confirmation
  const speakCalibrationDone = useCallback((playerName) => {
    const msg = isHe
      ? `מעולה, תפסתי את הטווח שלך. יאללה נתחיל!`
      : `Great ${playerName}, I've got your range. Let's go!`;
    speakPriority(msg);
  }, [isHe, speakPriority]);

  // Level-up prompt for longevity athletes performing at high level
  const speakLevelUpPrompt = useCallback((playerName) => {
    const name = playerName || (isHe ? 'אלוף' : 'champ');
    const text = isHe
      ? `${name}, אתה מבצע ברמה גבוהה מאוד! רוצה לנסות תרגילים מתקדמים יותר?`
      : `${name}, you're performing at a very high level! Want to try more advanced exercises?`;
    speakPriority(text);
  }, [isHe, speakPriority]);

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
    speakNotVisible,
    speakPositiveReinforcement,
    speakMissingBodyParts,
    speakSideCamera,
    speakResumeWelcome,
    speakCalibrationStart,
    speakCalibrationDone,
    speakLevelUpPrompt,
    unlockAudio,
    speakCount,
    stop,
    isSpeaking
  };
}
