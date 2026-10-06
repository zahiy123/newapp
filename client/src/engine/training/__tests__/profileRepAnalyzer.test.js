import { describe, it, expect } from 'vitest';
import { makeProfileRepAnalyzer } from '../profileRepAnalyzer.js';
import { makeTimedAnalyzer } from '../timedAnalyzer.js';

describe('Profile rep counting replaces the analyzer count', () => {
  it('counts only what the profile detector counted; the analyzer\'s own counts are dropped', () => {
    let analyzerReps = 0;
    const noisy = (lm, prev) => { analyzerReps += 1; return { ...prev, reps: analyzerReps, feedback: { type: 'count', count: analyzerReps, coaching: { he: 'עומק מעולה' } }, posture: 'standing' }; };
    const countRef = { current: 0 };
    const an = makeProfileRepAnalyzer(noisy, { current: { active: true, countRef } });
    let st = {};
    st = an([], st); expect(st.reps).toBe(0); expect(st.feedback).toBeNull();
    countRef.current = 1;
    st = an([], st); expect(st.reps).toBe(1); expect(st.feedback.type).toBe('count'); expect(st.feedback.coaching.he).toBe('עומק מעולה');
    st = an([], st); expect(st.reps).toBe(1); expect(st.feedback).toBeNull();
    expect(st.posture).toBe('standing');
  });
  it('inactive source → the analyzer unchanged', () => {
    const base = (lm, prev) => ({ ...prev, reps: 7 });
    expect(makeProfileRepAnalyzer(base, { current: { active: false } })([], {}).reps).toBe(7);
  });
});

describe('Timed analyzer counts only working seconds', () => {
  it('not working → the clock stands still', () => {
    let working = false;
    const an = makeTimedAnalyzer(null, () => working);
    let st = {};
    const start = Date.now();
    const realNow = Date.now;
    let t = start;
    Date.now = () => t;
    try {
      for (let i = 0; i < 60; i++) { t += 50; st = an([], st); }
      expect(st.reps).toBe(0);
      working = true;
      for (let i = 0; i < 60; i++) { t += 50; st = an([], st); }
      expect(st.reps).toBe(3);                       // 60 working frames × 50 ms = 3 s
    } finally { Date.now = realNow; }
  });
});
