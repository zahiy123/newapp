import { useRef, useCallback } from 'react';

export function useWhistle() {
  const audioCtxRef = useRef(null);

  function getCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  }

  function playTone(freq, duration, type = 'sine', rampDown = true) {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    if (rampDown) {
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    }
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  // Short whistle — start/resume play
  const shortWhistle = useCallback(() => {
    const ctx = getCtx();
    // Two-tone whistle
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(3200, ctx.currentTime);
    osc2.frequency.setValueAtTime(3600, ctx.currentTime);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.5);
    osc2.stop(ctx.currentTime + 0.5);
  }, []);

  // Long whistle — game start/end
  const longWhistle = useCallback(() => {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2800, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(3500, ctx.currentTime + 0.3);
    osc.frequency.setValueAtTime(3500, ctx.currentTime + 1.2);
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.setValueAtTime(0.6, ctx.currentTime + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.5);
  }, []);

  // Foul horn — low buzzer
  const foulHorn = useCallback(() => {
    playTone(220, 0.8, 'sawtooth');
  }, []);

  // Goal horn — celebratory ascending tone
  const goalHorn = useCallback(() => {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.3);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.5);
    osc.frequency.linearRampToValueAtTime(1320, ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.2);
  }, []);

  // Half-time double whistle
  const halfTimeWhistle = useCallback(() => {
    shortWhistle();
    setTimeout(() => shortWhistle(), 600);
  }, [shortWhistle]);

  return { shortWhistle, longWhistle, foulHorn, goalHorn, halfTimeWhistle };
}
