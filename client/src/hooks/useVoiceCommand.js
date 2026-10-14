// useVoiceCommand — the explicit "תרגיל הבא" / "next exercise" by voice, through the WHOLE workout
// (owner, 2026-10-14: "the voice command does not work at all").
//
// The mic stays OPEN while active (it used to close on every coach line + 1.5 s — while the coach
// counted every rep it was almost never open). The coach can still never move the trainee with its
// own voice: a command is rejected when the coach said "הבא" / "next" in the last few seconds
// (voiceCommands.acceptCommand + useSpeech.coachSaidRecently).
// Exposes { listening, status } — status: 'starting' | 'listening' | 'off' | 'unsupported' | 'denied' | 'error'
// so the page shows the trainee whether the voice command is really on, and why not.
// Uses the browser's SpeechRecognition where it exists; elsewhere the on-screen button works.

import { useEffect, useRef, useState } from 'react';
import { isNextCommand, acceptCommand, ECHO_WINDOW_MS, COMMAND_ECHO_RE } from '../engine/training/voiceCommands';
import { coachSaidRecently } from './useSpeech';

const RESTART_MS = 300;

export function useVoiceCommand({ active, lang = 'he-IL', onNext }) {
  const onNextRef = useRef(onNext);
  useEffect(() => { onNextRef.current = onNext; }, [onNext]);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('off');

  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!active) { setStatus('off'); return undefined; }
    if (!SR) { setStatus('unsupported'); return undefined; }
    let stopped = false;
    let rec = null;
    let restartTm = null;
    let failures = 0;
    setStatus('starting');                     // shown until the browser confirms the mic is listening

    const startRec = () => {
      if (stopped || rec) return;
      try {
        const r = new SR();
        r.lang = lang;
        r.continuous = true;
        r.interimResults = false;        // final results only
        r.maxAlternatives = 3;
        r.onstart = () => { failures = 0; setListening(true); setStatus('listening'); };
        r.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (!Array.from(res).some(a => isNextCommand(a.transcript))) continue;
            if (!acceptCommand({ isFinal: res.isFinal !== false, coachSaidCommandWord: coachSaidRecently(COMMAND_ECHO_RE, ECHO_WINDOW_MS) })) continue;
            onNextRef.current?.();
            return;
          }
        };
        r.onerror = (e) => {
          const err = e?.error;
          if (err === 'not-allowed' || err === 'service-not-allowed') { stopped = true; setStatus('denied'); }
          else if (err === 'audio-capture') {
            // the mic is held by another capture (the effort listener) → it yields; the command wins
            try { window.dispatchEvent(new Event('voicecommand:audio-capture')); } catch { /* no window */ }
          } else if (err !== 'no-speech' && err !== 'aborted') failures += 1;
        };
        r.onend = () => {
          if (rec !== r) return;
          rec = null; setListening(false);
          if (stopped) return;
          if (failures >= 6) { setStatus('error'); }
          // the browser ends the session after silence / an error → listen again (backing off on errors)
          restartTm = setTimeout(startRec, RESTART_MS * (1 + Math.min(failures, 10)));
        };
        rec = r;
        r.start();
      } catch {
        rec = null;
        failures += 1;
        restartTm = setTimeout(startRec, RESTART_MS * (1 + Math.min(failures, 10)));
      }
    };
    startRec();
    return () => {
      stopped = true;
      clearTimeout(restartTm);
      const r = rec; rec = null;
      try { r?.abort(); } catch { /* not running */ }
      setListening(false);
    };
  }, [active, lang]);

  return { listening: !!active && listening, status: active ? status : 'off' };
}
