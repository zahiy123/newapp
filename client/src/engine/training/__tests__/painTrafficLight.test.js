import { describe, it, expect } from 'vitest';
import {
  painLight, painAction, reducedLoad, zonesFor, spokenLevel, spokenZone, isPainReport, painEntry, painFacts,
} from '../painTrafficLight.js';

describe('Pain Traffic Light — the levels', () => {
  it('0–3 green / continue, 4–5 yellow / reduce, 6–10 red / stop', () => {
    for (const l of [0, 1, 2, 3]) { expect(painLight(l)).toBe('green'); expect(painAction(l)).toBe('continue'); }
    for (const l of [4, 5]) { expect(painLight(l)).toBe('yellow'); expect(painAction(l)).toBe('reduce'); }
    for (const l of [6, 7, 8, 9, 10]) { expect(painLight(l)).toBe('red'); expect(painAction(l)).toBe('stop'); }
  });
  it('an invalid level decides nothing', () => {
    expect(painLight(-1)).toBe(null); expect(painLight(11)).toBe(null); expect(painAction('x')).toBe(null);
  });
});

describe('Pain Traffic Light — the lower load', () => {
  it('reps × 0.6 (at least 3), one set less but never below the set in progress', () => {
    expect(reducedLoad({ reps: 10, sets: 3, currentSet: 1 })).toEqual({ reps: 6, sets: 2 });
    expect(reducedLoad({ reps: 4, sets: 3, currentSet: 3 })).toEqual({ reps: 3, sets: 3 });
    expect(reducedLoad({ reps: 2, sets: 1, currentSet: 1 })).toEqual({ reps: 2, sets: 1 });
    expect(reducedLoad({ reps: '12', sets: '4', currentSet: 2 })).toEqual({ reps: 7, sets: 3 });
  });
});

describe('Pain Traffic Light — by voice', () => {
  it('hears the pain report at the end of what was said', () => {
    expect(isPainReport('כואב לי')).toBe(true);
    expect(isPainReport('יש לי כאב בברך')).toBe(true);
    expect(isPainReport('it hurts')).toBe(true);
    expect(isPainReport('תרגיל הבא')).toBe(false);
    expect(isPainReport('')).toBe(false);
  });
  it('the level: a digit or a number word, the last one wins', () => {
    expect(spokenLevel('שש')).toBe(6);
    expect(spokenLevel('כואב לי בברך 7')).toBe(7);
    expect(spokenLevel('אולי שלוש לא ארבע')).toBe(4);
    expect(spokenLevel('five')).toBe(5);
    expect(spokenLevel('כואב לי')).toBe(null);
    expect(spokenLevel('15')).toBe(null);
  });
  it('the zone; the residual limb only for an amputee', () => {
    expect(spokenZone('כואב לי בברך')).toBe('knee');
    expect(spokenZone('כואב בגב')).toBe('back');
    expect(spokenZone('כואב בגדם', { amputee: true })).toBe('stump');
    expect(spokenZone('כואב בגדם')).toBe(null);
    expect(zonesFor({ amputee: false }).some(z => z.id === 'stump')).toBe(false);
    expect(zonesFor({ amputee: true }).some(z => z.id === 'stump')).toBe(true);
  });
});

describe('Pain Traffic Light — the record and the AI facts', () => {
  it('an entry carries the level, the light, the action and where', () => {
    const e = painEntry({ level: 6, zone: 'knee', exercise: 'סקוואט', set: 2, rep: 4, phase: 'exercising', at: 1 });
    expect(e).toEqual({ level: 6, light: 'red', action: 'stop', zone: 'knee', exercise: 'סקוואט', set: 2, rep: 4, phase: 'exercising', at: 1 });
  });
  it('the facts tell the AI the decision, with no number in them', () => {
    const f = painFacts({ level: 5, zone: 'back', exercise: 'לאנג׳', isHe: true });
    expect(f.mode).toBe('pain');
    expect(f.action).toBe('reduce');
    expect(f.error.what).toContain('גב');
    expect(/\d/.test(f.error.what)).toBe(false);
  });
});
