import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTimedAnalyzer } from '../timedAnalyzer.js';

afterEach(() => vi.useRealTimers());

describe('Timed exercises count seconds of work only', () => {
  it('counts one per second of analyzed frames and stops while paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const an = makeTimedAnalyzer(null);
    let st = {};
    for (let ms = 0; ms <= 3000; ms += 50) { vi.setSystemTime(ms); st = an([], st); }
    expect(st.reps).toBe(3);
    vi.setSystemTime(13000);                 // 10 s with no frames (out of position)
    st = an([], st);
    expect(st.reps).toBe(3);
    for (let ms = 13050; ms <= 15050; ms += 50) { vi.setSystemTime(ms); st = an([], st); }
    expect(st.reps).toBe(5);
  });

  it('emits a count feedback exactly when a new second is reached', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const an = makeTimedAnalyzer(null);
    let st = {}; const counts = [];
    for (let ms = 0; ms <= 2050; ms += 50) { vi.setSystemTime(ms); st = an([], st); if (st.feedback?.type === 'count') counts.push(st.feedback.count); }
    expect(counts).toEqual([1, 2]);
  });
});
