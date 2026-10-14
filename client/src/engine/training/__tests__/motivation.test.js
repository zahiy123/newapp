import { describe, it, expect } from 'vitest';
import { createMotivation, motivationLine, MIN_GAP_MS, NO_REPEAT } from '../motivation';

describe('Motivation in a SMART DOSE — warm, never a flood', () => {
  it('warm lines are said ("יאללה", "בוא נתחיל") — at most one every MIN_GAP_MS', () => {
    const m = createMotivation();
    const first = motivationLine(m, { now: 0, moment: 'start', name: 'זהי' });
    expect(first).toBeTruthy();
    expect(motivationLine(m, { now: 5000, moment: 'set', name: 'זהי' })).toBe(null);          // 5 s later: no
    expect(motivationLine(m, { now: MIN_GAP_MS - 1, moment: 'set', name: 'זהי' })).toBe(null);
    expect(motivationLine(m, { now: MIN_GAP_MS + 1, moment: 'set', name: 'זהי' })).toBeTruthy();
  });
  it('never the same line again within the last NO_REPEAT lines', () => {
    const m = createMotivation();
    const said = [];
    for (let i = 0; i < 12; i++) said.push(motivationLine(m, { now: i * (MIN_GAP_MS + 1), moment: 'start', name: 'זהי' }));
    for (let i = 1; i < said.length; i++) expect(said.slice(Math.max(0, i - NO_REPEAT), i)).not.toContain(said[i]);
    expect(said.join(' ')).toMatch(/יאללה|בוא נתחיל/);
  });
  it('a strained trainee gets a calm line, not hype; the name is filled in', () => {
    const m = createMotivation();
    const line = motivationLine(m, { now: 0, moment: 'start', name: 'זהי', strained: true });
    expect(line).not.toMatch(/יאללה|חזק/);
    expect(motivationLine(createMotivation(), { now: 0, moment: 'start', name: 'זהי' })).toContain('זהי');
    expect(motivationLine(createMotivation(), { now: 0, moment: 'start', name: '' })).not.toContain('{name}');
  });
});
