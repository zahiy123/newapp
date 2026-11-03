import { describe, it, expect } from 'vitest';
import { defaultStyle, shouldSoften, effectiveStyle, rateFactor, isStyle } from '../coachStyle.js';

describe('Adaptive coach styles', () => {
  it('the default: rehab-only is calm; every other track keeps the #74 coach (energetic)', () => {
    expect(defaultStyle({ trainingTrack: 'rehab_only' })).toBe('calm');
    expect(defaultStyle({ trainingTrack: 'rehab_sport' })).toBe('energetic');
    expect(defaultStyle({ sport: 'footballAmputee' })).toBe('energetic');
    expect(defaultStyle({ sport: 'rehab' })).toBe('calm');
  });
  it('softens after a pain report of 4+ or a readiness of 1–2', () => {
    expect(shouldSoften({ painReports: [{ level: 3 }] })).toBe(false);
    expect(shouldSoften({ painReports: [{ level: 4 }] })).toBe(true);
    expect(shouldSoften({ readiness: 2 })).toBe(true);
    expect(shouldSoften({ readiness: 0 })).toBe(false);
    expect(effectiveStyle('energetic', { softened: true })).toBe('calm');
    expect(effectiveStyle('balanced')).toBe('balanced');
    expect(effectiveStyle('nonsense')).toBe('energetic');
  });
  it('energetic keeps the speech rate unchanged; calm is slower', () => {
    expect(rateFactor('energetic')).toBe(1);
    expect(rateFactor('calm')).toBeLessThan(rateFactor('balanced'));
    expect(isStyle('calm')).toBe(true);
  });
});
