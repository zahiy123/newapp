// useVoiceCommand — listens for "next exercise" ONLY while the training waits for the trainee's
// decision (an exercise finished). Uses the browser's SpeechRecognition where it exists; silently
// does nothing elsewhere (the on-screen button always works). The coach's own speech is ignored.

import { useEffect, useRef, useState } from 'react';
import { isNextCommand, acceptCommand } from '../engine/training/voiceCommands';

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
    let lastSpeechAt = null;
    // remember when the coach last spoke (echo guard)
    const watch = setInterval(() => { if (speakingRef.current?.()) lastSpeechAt = Date.now(); }, 150);
    const start = () => {
      if (stopped) return;
      try {
        rec = new SR();
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const alts = Array.from(e.results[i]);
            if (!alts.some(a => isNextCommand(a.transcript))) continue;
            if (!acceptCommand({ coachSpeaking: !!speakingRef.current?.(), lastCoachSpeechAt: lastSpeechAt, now: Date.now() })) continue;
            stopped = true;
            try { rec.stop(); } catch { /* already stopped */ }
            onNextRef.current?.();
            return;
          }
        };
        rec.onerror = (e) => { if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') stopped = true; };
        rec.onend = () => { if (!stopped) setTimeout(start, 400); };   // the browser ends after silence → listen again
        rec.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    };
    start();
    return () => {
      stopped = true;
      clearInterval(watch);
      setListening(false);
      try { rec?.abort(); } catch { /* not running */ }
    };
  }, [active, lang]);

  return { listening };
}
