import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PlanBuilder from '../PlanBuilder';

describe('The plan builder renders', () => {
  it('the modes, the chosen plan in order, the groups', () => {
    const html = renderToString(<PlanBuilder isHe traineeId="T1"
      profile={{ amputationSide: 'left', amputationLevel: 'below_knee', disability: 'amputee' }}
      limits={{ blockedPatterns: ['jumpSquat'] }}
      plan={{ mode: 'manual', exercises: [{ pattern: 'squat', variation: 'partial', sets: 3, reps: 8, rest: 60 }, { pattern: 'plank', variation: 'standard', sets: 3, reps: 30, rest: 45 }] }} />);
    for (const s of ['ידני + אוטומטי', 'התוכנית — 2 תרגילים', 'סקוואט', 'פלאנק', 'שנ׳', 'כתף', 'ברך', 'ליבה ויציבה', 'שמירת התוכנית']) expect(html).toContain(s);
  });
  it('automatic mode: no exercise list', () => {
    const html = renderToString(<PlanBuilder isHe={false} traineeId="T1" profile={{}} plan={null} limits={null} />);
    expect(html).toContain('Automatic');
    expect(html).not.toContain('The plan —');
  });
});
