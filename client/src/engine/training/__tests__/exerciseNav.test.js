import { describe, it, expect } from 'vitest';
import { createExerciseNav, navGo, navNext, navPrev, navUnchangedSince } from '../exerciseNav';

describe('IRON RULE — only the trainee moves themself between exercises', () => {
  it('a skip moves FORWARD at once, from where the trainee IS now', () => {
    const nav = createExerciseNav(0);
    expect(navNext(nav, 8)).toBe(1);
    expect(navNext(nav, 8)).toBe(2);
    expect(navNext(nav, 8)).toBe(3);          // three quick skips = three exercises forward
  });
  it('the owner\'s bug: a late background result can never send the trainee back', () => {
    const nav = createExerciseNav(3);
    navNext(nav, 8);                           // skip → 4; the adaptation starts in the background
    const seqAtStart = nav.seq;
    navGo(nav, 6, 8);                          // meanwhile the trainee picks exercise 7 from the list
    // the late adaptation result arrives: it sees the trainee moved, and drops itself
    expect(navUnchangedSince(nav, seqAtStart)).toBe(false);
    expect(nav.idx).toBe(6);                   // still exactly where the trainee chose
  });
  it('back only on the explicit "previous"; never below the first / above the last', () => {
    const nav = createExerciseNav(0);
    expect(navPrev(nav, 5)).toBe(null);
    navGo(nav, 4, 5);
    expect(navNext(nav, 5)).toBe(null);       // the last one: the workout ends, the index stays
    expect(nav.idx).toBe(4);
    expect(navPrev(nav, 5)).toBe(3);
    expect(navGo(nav, 99, 5)).toBe(4);
  });
});
