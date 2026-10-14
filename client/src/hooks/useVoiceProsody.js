// useVoiceProsody — Layer 4 of the coach brain: listens to the trainee's AUDIBLE EFFORT (owner, 2026-10-14).
//
// The microphone's loudness at ~20 Hz → engine/coachBrain/prosody.js → effortRef (0..1).
// On the device only: no audio is recorded, stored or sent — only the effort number exists.
// The coach's own voice is ignored (frames while it speaks are skipped; echo cancellation on).
// The voice command ("תרגיל הבא") always wins the mic: on a capture conflict this listener stops.
// SAFETY: no mic / permission denied / any error → effortRef stays null and the coach works without it.

import { useEffect, useRef } from 'react';
import { createProsody, prosodyFrame, effortLevel, frameRms } from '../engine/coachBrain/prosody';

const FRAME_MS = 50;

export function useVoiceProsody({ enabled }) {
  const effortRef = useRef(null);
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return undefined;
    let stream = null, ac = null, timer = null, stopped = false;
    const stop = () => {
      stopped = true;
      clearInterval(timer);
      try { stream?.getTracks().forEach(t => t.stop()); } catch { /* already stopped */ }
      try { ac?.close(); } catch { /* already closed */ }
      effortRef.current = null;
    };
    const onConflict = () => { console.warn('[VoiceProsody] the voice command needs the mic — effort listening stops'); stop(); };
    window.addEventListener('voicecommand:audio-capture', onConflict);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false }, video: false });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const p = createProsody();
        timer = setInterval(() => {
          try {
            an.getFloatTimeDomainData(buf);
            const now = performance.now();
            prosodyFrame(p, frameRms(buf), now, !!window.speechSynthesis?.speaking);
            effortRef.current = effortLevel(p, now);
          } catch (err) { console.warn('[VoiceProsody] stopped:', err?.message); stop(); }
        }, FRAME_MS);
      } catch (err) {
        console.warn('[VoiceProsody] no microphone for effort listening — the coach works without it:', err?.message);
        effortRef.current = null;
      }
    })();
    return () => { window.removeEventListener('voicecommand:audio-capture', onConflict); stop(); };
  }, [enabled]);
  return effortRef;
}
