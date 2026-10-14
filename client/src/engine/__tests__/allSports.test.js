// ============================================================
// ALL SPORTS — the pre-production verification (owner, 2026-10-14: "verify unequivocally that the coach
// brain, the virtual ball, the camera calibration and the kinematics work globally and fit EVERY
// sport on the platform, exactly by the sport the trainee chose")
//
// For every sport (and the body it is designed for) and every track:
//   1. the plan builds, every exercise has an analyzer + an expert profile + a Ghost that draws
//   2. the cross-sport filter keeps the sport's own drills and removes the other sports' drills
//   3. the virtual ball: the sport's ball, a behaviour that fits the sport (no foot ball in a hand
//      sport, no hand dribble in football), and a seated trainee is never sent a standing drill
//   4. the coach brain runs on every exercise profile (attempts → decisions → summary)
//   5. the kinematics are CAMERA-INVARIANT: the same real pose measures the same in a portrait and
//      a landscape camera, for every exercise's primary metric
//   6. the warm-up builds for every sport / body
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { getLimbProfile, trainingLimbs } from '../limbProfile.js';
import { rebuildPlanFromCatalog, planContext } from '../catalog/planBuilder.js';
import { catalogGhostSpec, parseCatalogId } from '../catalog/catalog.js';
import { getAnalyzer } from '../../utils/exerciseAnalysis.js';
import { buildExecutionProfile } from '../../hooks/training/useExpertExecution.js';
import { sportContextsFor } from '../sports/sportLibrary.js';
import { drawGhostOverlay } from '../warmupGhost.js';
import { ballModeFor, ballLook, virtualBallWanted } from '../virtualBall.js';
import { createCoachBrain, brainAttempt, brainDecide, brainSummary, brainFrame } from '../coachBrain/brain.js';
import { measureMetric } from '../exercise/kinematics.js';
import { setFrameAspect } from '../../utils/motionEngine.js';
import { sanitizePlan } from '../../utils/workoutStorage.js';
import { planWarmUp } from '../warmupPlanner.js';

const NATURAL = { scanData: { classification: 'NATURAL' } };
const BODIES = {
  fitness: NATURAL,
  rehab: { scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } },
  football: NATURAL,
  footballAmputee: { mobilityAid: 'crutches', scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } },
  footballAmputeeGK: { scanData: { classification: 'ARM_AMPUTEE', prostheticSide: 'left' } },
  basketball: NATURAL,
  basketballWheelchair: { mobilityAid: 'wheelchair', scanData: { classification: 'WHEELCHAIR' } },
  tennis: NATURAL,
  tennisWheelchair: { mobilityAid: 'wheelchair', scanData: { classification: 'WHEELCHAIR' } },
};
const SPORTS = Object.keys(BODIES);
const HAND_SPORTS = new Set(['basketball', 'basketballWheelchair', 'tennis', 'tennisWheelchair']);
const SEATED_SPORTS = new Set(['basketballWheelchair', 'tennisWheelchair']);
const FOOT_MODES = new Set(['dribble', 'juggle']);
const plan4 = { weeks: Array.from({ length: 4 }, () => ({ days: [{}, {}, {}] })) };

function profileOf(sport, extra = {}) {
  return { sport, age: 30, trainingTrack: sport === 'rehab' ? 'rehab_only' : 'sport_only', trainingLocation: 'home', ...BODIES[sport], ...extra };
}
function exercisesOf(p) {
  const lp = trainingLimbs(getLimbProfile(p));
  return { lp, list: rebuildPlanFromCatalog(plan4, planContext(p, lp, 'verify'), true).weeks.flatMap(w => w.days.flatMap(d => d.exercises)) };
}
const analyzerOf = (ex, lp = {}) => getAnalyzer(ex.analyzerName || ex.name, { seated: !!lp.wheelchair });
function strictCtx() {
  const fin = (...a) => a.every(Number.isFinite);
  const g = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { if (!fin(...a)) throw new Error(`${k}`); return g; };
      if (k === 'arc') return (x, y, r) => { if (!fin(x, y, r) || r < 0) throw new Error('arc'); };
      if (k === 'ellipse') return (x, y, rx, ry) => { if (!fin(x, y, rx, ry) || rx < 0 || ry < 0) throw new Error('ellipse'); };
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => { if (!fin(x, y)) throw new Error(k); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// typical drill names of each sport (AI plans / older plans — not only the catalog)
const SPORT_DRILLS = {
  football: { keep: ['דריבל בין קונוסים', 'סלאלום עם כדור', 'מסירה לקיר', 'בעיטה לשער', "ג'אגלינג", 'נגיחות ראש', 'שליטה ראשונית'], drop: ['קליעה לסל', 'פורהנד לקיר'] },
  footballAmputee: { keep: ['דריבל בקביים', 'מסירה בקביים', 'בעיטה לשער בקביים', 'סלאלום בקביים עם כדור'], drop: ['קליעה לסל', 'כדרור ביד'] },
  footballAmputeeGK: { keep: ['תגובת שוער', 'הטלת כדור שוער', 'עמידת מוכנות שוער'], drop: ['פורהנד לקיר', 'קליעה לסל'] },
  basketball: { keep: ['כדרור כדורסל במקום', 'קליעה לסל', 'מסירת חזה', 'עליה לסל', 'קרוסאובר'], drop: ['בעיטה לשער', 'נגיחות ראש'] },
  basketballWheelchair: { keep: ['כדרור כיסא גלגלים', 'מסירה כיסא גלגלים', 'זריקה לסל מהכיסא'], drop: ['בעיטה לשער', 'פנדל'] },
  tennis: { keep: ['פורהנד לקיר', 'בקהנד', 'הגשה', 'ווליי'], drop: ['בעיטה לשער', 'קליעה לסל'] },
  tennisWheelchair: { keep: ['פורהנד מהכיסא', 'הגשה מהכיסא'], drop: ['בעיטה לשער', 'קליעה לסל'] },
};

describe('ALL SPORTS — 1. plan, analyzer, expert profile, Ghost', () => {
  for (const sport of SPORTS) {
    it(`${sport}: every exercise is analysed, profiled and demonstrated`, () => {
      const p = profileOf(sport);
      const { lp, list } = exercisesOf(p);
      expect(list.length, sport).toBeGreaterThan(5);
      const ctx = sportContextsFor(p);
      for (const ex of list) {
        const an = analyzerOf(ex, lp);
        expect(typeof an.analyze, `${sport} / ${ex.name}`).toBe('function');
        const prof = buildExecutionProfile(an.cueKey, ex.name, lp, ctx, ex.catalogId);
        expect(prof, `${sport} / ${ex.name} has no expert profile`).toBeTruthy();
        const spec = catalogGhostSpec(ex.catalogId);
        for (let ms = 0; ms < 2400; ms += 397) drawGhostOverlay(strictCtx(), spec, lp, ms, { x: 300, y: 600 }, 200, 0.6, 1000);
        // a seated sport never gets a standing-only drill
        if (SEATED_SPORTS.has(sport)) expect(prof.posture === 'standing' && prof.needs?.includes?.('standing'), `${sport} / ${ex.name}`).not.toBe(true);
      }
    });
  }
});

describe('ALL SPORTS — 2. the cross-sport filter fits the chosen sport', () => {
  for (const [sport, { keep, drop }] of Object.entries(SPORT_DRILLS)) {
    it(`${sport}: keeps its own drills, removes the other sports'`, () => {
      const plan = { weeks: [{ days: [{ exercises: [...keep, ...drop].map(name => ({ name })) }] }] };
      const names = sanitizePlan(plan, sport, 30).weeks[0].days[0].exercises.map(e => e.name);
      for (const n of keep) expect(names, `${sport} must keep "${n}"`).toContain(n);
      for (const n of drop) expect(names, `${sport} must drop "${n}"`).not.toContain(n);
    });
  }
});

describe('ALL SPORTS — 3. the virtual ball is the sport\'s ball, behaving the sport\'s way', () => {
  for (const [sport, { keep }] of Object.entries(SPORT_DRILLS)) {
    it(`${sport}: the ball's look and behaviour fit the sport`, () => {
      const look = ballLook(sport);
      expect(look).toBe(sport.startsWith('basket') ? 'basketball' : sport.startsWith('tennis') ? 'tennis' : 'football');
      const seated = SEATED_SPORTS.has(sport);
      for (const name of keep) {
        const an = getAnalyzer(name, { seated });
        // a seated trainee's ball-sport drill is analysed SEATED
        if (seated && an.type === 'form') expect(an.orientation, `${sport} / ${name} → ${an.cueKey}`).toBe('sitting');
        const m = ballModeFor({ cueKey: an.cueKey, name, sport });
        if (!m) continue;                                   // e.g. a ready stance — no ball
        if (HAND_SPORTS.has(sport)) {
          expect(FOOT_MODES.has(m.mode) || (m.mode === 'incoming' && m.target === 'foot'), `${sport} / ${name} → ${m.mode}:${m.target}`).toBe(false);
        } else if (sport !== 'footballAmputeeGK') {
          expect(m.mode === 'handDribble', `${sport} / ${name} → ${m.mode}`).toBe(false);
        }
        expect(virtualBallWanted({ mode: m.mode, hasBall: false })).toBe(true);
        expect(virtualBallWanted({ mode: m.mode, hasBall: true })).toBe(false);
      }
    });
  }
  it('every catalog ball drill of every sport gets a ball that fits', () => {
    for (const sport of SPORTS) {
      const { lp, list } = exercisesOf(profileOf(sport));
      for (const ex of list) {
        const pid = parseCatalogId(ex.catalogId)?.pattern;
        const m = ballModeFor({ cueKey: analyzerOf(ex, lp).cueKey, pattern: pid, name: ex.name, sport });
        if (!m) continue;
        if (HAND_SPORTS.has(sport)) expect(FOOT_MODES.has(m.mode) || m.target === 'foot', `${sport} / ${ex.name}`).toBe(false);
      }
    }
  });
});

describe('ALL SPORTS — 4. the coach brain runs on every exercise profile', () => {
  for (const sport of SPORTS) {
    it(`${sport}: attempts → decisions → summary, never praise`, () => {
      const p = profileOf(sport);
      const { lp, list } = exercisesOf(p);
      const ctx = sportContextsFor(p);
      const seen = new Set();
      for (const ex of list) {
        if (seen.has(ex.catalogId)) continue;
        seen.add(ex.catalogId);
        const an = analyzerOf(ex, lp);
        const prof = buildExecutionProfile(an.cueKey, ex.name, lp, ctx, ex.catalogId);
        const brain = createCoachBrain({ profile: prof, exerciseName: ex.name });
        const ids = [...(prof.rules || []), ...(prof.dynamics || [])].map(r => r.id).filter(Boolean);
        let t = 0;
        for (let i = 0; i < 8; i++) {
          brainFrame(brain, null, t);
          brainAttempt(brain, { type: prof.kind === 'strike' ? 'strike' : 'rep', side: 'right', toPeakMs: 900 + i * 120, returnMs: 900 }, { now: (t += 2500), accuracy: 90 - i * 5, errorIds: i % 2 && ids[0] ? [ids[0]] : [] });
          const say = brainDecide(brain, { now: t + 400, sinceVoiceMs: 10000, effort: 0.3 + i * 0.05, he: true, rnd: () => 0.42 });
          if (say) expect(say.text, `${sport} / ${ex.name}`).not.toMatch(/מעולה|מצוין|כל הכבוד|אלוף/);
        }
        const sum = brainSummary(brain, 0.5);
        expect(sum.state, `${sport} / ${ex.name}`).toBeTruthy();
        expect(['ease', 'normal', 'push']).toContain(sum.adaptation.pace);
      }
    });
  }
});

describe('ALL SPORTS — 5. the kinematics are camera-invariant (calibrated to the device camera)', () => {
  afterEach(() => setFrameAspect(1));
  // one real pose in px (a person ~1000 px tall, knees bent, arms forward, trunk leaning)
  const REAL = {
    0: [500, 140], 11: [440, 260], 12: [560, 262], 13: [420, 400], 14: [590, 390], 15: [470, 480], 16: [560, 470],
    23: [460, 560], 24: [545, 565], 25: [430, 760], 26: [580, 750], 27: [450, 960], 28: [560, 955],
    29: [440, 985], 30: [570, 980], 31: [470, 1000], 32: [585, 995],
  };
  // the SAME scene seen by two cameras: portrait 1080×1440 and landscape 1600×1200 (person centered)
  const frame = (W, H) => {
    const ox = (W - 1080) / 2, oy = (H - 1200) / 2 + 60;
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
    for (const [i, [x, y]] of Object.entries(REAL)) lm[i] = { x: (x + ox) / W, y: (y + oy) / H, z: 0, visibility: 1 };
    return lm;
  };
  for (const sport of SPORTS) {
    it(`${sport}: every exercise's primary measure is the same in a portrait and a landscape camera`, () => {
      const p = profileOf(sport);
      const { lp, list } = exercisesOf(p);
      const ctx = sportContextsFor(p);
      const portrait = frame(1080, 1440), landscape = frame(1600, 1200);
      for (const ex of list) {
        const prof = buildExecutionProfile(analyzerOf(ex, lp).cueKey, ex.name, lp, ctx, ex.catalogId);
        const metric = prof?.primary;
        if (!metric) continue;
        setFrameAspect(1080 / 1440);
        const a = measureMetric(portrait, metric, lp);
        setFrameAspect(1600 / 1200);
        const b = measureMetric(landscape, metric, lp);
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        expect(Math.abs(a - b), `${sport} / ${ex.name} / ${metric}: ${a} vs ${b}`).toBeLessThan(0.5);
      }
    });
  }
});

describe('ALL SPORTS — 6. the warm-up builds for every sport and body', () => {
  for (const sport of SPORTS) {
    it(`${sport}`, () => {
      const w = planWarmUp(profileOf(sport), { hasBall: false });
      expect(w.length, sport).toBeGreaterThanOrEqual(2);
      for (const e of w) expect(typeof e.analyze, `${sport} / ${e.id}`).toBe('function');
      if (SEATED_SPORTS.has(sport)) for (const e of w) expect(['high_knees', 'single_knee', 'side_steps', 'kick'], `${sport} / ${e.id}`).not.toContain(e.ghost?.move);
    });
  }
});
