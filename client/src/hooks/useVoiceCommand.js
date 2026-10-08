// useVoiceCommand — listens for the explicit "תרגיל הבא" / "next exercise" ONLY while the training
// waits for the trainee's decision (an exercise finished). The microphone is OFF while the coach
// speaks and for MIC_REOPEN_MS after it — the app can never hear its own voice and skip by itself.
// Uses the browser's SpeechRecognition where it exists; elsewhere the on-screen button works.

import { useEffect, useRef, useState } from 'react';
import { isNextCommand, acceptCommand, MIC_REOPEN_MS } from '../engine/training/voiceCommands';

export function useVoiceCommand({ active, lang = 'he-IL', isSpeaking, onNext }) {
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const speakingRef = useRef(isSpeaking);
  speakingRef.current = isSpeaking;
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!active || !SR) { setListening(false); return undefined; }
    let stopped = false;
    let rec = null;
    let running = false;
    let heardCoach = false;              // this listening session overlapped the coach's speech
    let silentSince = Date.now();
    let restartTm = null;

    const stopRec = () => {
      if (!rec) return;
      const r = rec; rec = null; running = false;
      try { r.abort(); } catch { /* not running */ }
      setListening(false);
    };
    const startRec = () => {
      if (stopped || running) return;
      try {
        const r = new SR();
        r.lang = lang;
        r.continuous = true;
        r.interimResults = false;        // final results only
        r.maxAlternatives = 3;
        heardCoach = false;
        r.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (!Array.from(res).some(a => isNextCommand(a.transcript))) continue;
            if (!acceptCommand({ coachSpeaking: !!speakingRef.current?.(), sessionHeardCoach: heardCoach, isFinal: res.isFinal !== false })) continue;
            stopped = true;
            stopRec();
            onNextRef.current?.();
            return;
          }
        };
        r.onerror = (e) => { if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') stopped = true; };
        r.onend = () => {
          if (rec !== r) return;
          rec = null; running = false; setListening(false);
          if (!stopped) restartTm = setTimeout(maybeStart, 400);   // the browser ends after silence → listen again
        };
        rec = r;
        r.start();
        running = true;
        setListening(true);
      } catch {
        running = false;
        setListening(false);
      }
    };
    const maybeStart = () => {
      if (stopped || running) return;
      if (!speakingRef.current?.() && Date.now() - silentSince >= MIC_REOPEN_MS) startRec();
    };
    // the microphone follows the coach's voice: off while it speaks, back on after a pause
    const watch = setInterval(() => {
      if (speakingRef.current?.()) {
        silentSince = Date.now();
        if (running) { heardCoach = true; stopRec(); }
      } else {
        maybeStart();
      }
    }, 120);
    maybeStart();
    return () => {
      stopped = true;
      clearInterval(watch);
      clearTimeout(restartTm);
      stopRec();
    };
  }, [active, lang]);

  return { listening };
}
