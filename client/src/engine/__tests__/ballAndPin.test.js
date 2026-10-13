import { describe, it, expect } from 'vitest';
import { drawGhostOverlay } from '../warmupGhost';
import { catalogGhostSpec, buildCatalog } from '../catalog/catalog';
import { getLimbProfile } from '../limbProfile';

describe('the guide is pinned to the trainee pelvis', () => {
  // a recording 2d context: every x passed to moveTo / lineTo
  const rec = () => {
    const xs = [];
    const g = { addColorStop() {} };
    return { xs, ctx: new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'moveTo' || k === 'lineTo') return (x) => xs.push(x);
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => g;
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    }) };
  };
  const lp = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
  const kick = buildCatalog('field', lp).find(it => it.patternId === 'shadowKick');
  const pass = buildCatalog('field', lp).find(it => it.patternId === 'shadowPass');

  it('the Ghost moves with the pin by exactly the pin shift, at every moment of the kick / pass', () => {
    for (const item of [kick, pass]) {
      const spec = catalogGhostSpec(item.id);
      for (let ms = 0; ms < 3000; ms += 211) {
        const a = rec(), b = rec();
        drawGhostOverlay(a.ctx, spec, lp, ms, { x: 100, y: 300 }, 80, 1, 500, { pinX: 200, facing: 1 });
        drawGhostOverlay(b.ctx, spec, lp, ms, { x: 100, y: 300 }, 80, 1, 500, { pinX: 260, facing: 1 });
        expect(a.xs.length).toBeGreaterThan(10);
        a.xs.forEach((x, k) => expect(b.xs[k] - x).toBeCloseTo(60, 6));
      }
    }
  });

  it('the Ghost stays centered on the pelvis — its own sway never takes it sideways off the body', () => {
    const spec = catalogGhostSpec(kick.id);
    for (let ms = 0; ms < 3000; ms += 211) {
      const a = rec();
      drawGhostOverlay(a.ctx, spec, lp, ms, { x: 100, y: 300 }, 80, 1, 500, { pinX: 200, facing: 1 });
      const lo = Math.min(...a.xs), hi = Math.max(...a.xs);
      expect(lo).toBeLessThan(200);
      expect(hi).toBeGreaterThan(200);
    }
  });
});
