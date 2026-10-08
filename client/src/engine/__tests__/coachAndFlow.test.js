import { describe, it, expect } from 'vitest';
import { coachMode, coachPose, coachLook, drawCoach, COACH_IDS, COACH_INFO } from '../coachAvatar.js';
import { isNextCommand, acceptCommand } from '../training/voiceCommands.js';
import { genderizeCoachText } from '../coachVoiceText.js';
import { drawGhostOverlay } from '../warmupGhost.js';
import { catalogGhostSpec, buildCatalog } from '../catalog/catalog.js';
import { EXPERT_PROFILES } from '../exercise/exerciseProfiles.js';
import { getLimbProfile } from '../limbProfile.js';

const lpOk = getLimbProfile({ disability: 'none', scanData: { classification: 'NATURAL' } });
const lpBK = getLimbProfile({ scanData: { classification: 'TRANSTIBIAL_AMPUTEE', prostheticSide: 'left' } });

/** A canvas that fails like a real one on non-finite / negative values, and counts the work. */
function strictCtx() {
  const fin = (...a) => a.every(Number.isFinite);
  const g = { addColorStop() {} };
  const stats = { fills: 0, blurs: 0 };
  const ctx = new Proxy({ stats }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { if (!fin(...a)) throw new Error(`${k} ${a}`); return g; };
      if (k === 'arc') return (x, y, r) => { if (!fin(x, y, r) || r < 0) throw new Error(`arc ${x},${y},${r}`); };
      if (k === 'ellipse') return (x, y, rx, ry) => { if (!fin(x, y, rx, ry) || rx < 0 || ry < 0) throw new Error(`ellipse ${rx},${ry}`); };
      if (k === 'moveTo' || k === 'lineTo') return (x, y) => { if (!fin(x, y)) throw new Error(`${k} ${x},${y}`); };
      if (k === 'fill') return () => { stats.fills++; };
      return () => {};
    },
    set(t, k, v) { if (k === 'shadowBlur' && v > 0) stats.blurs++; t[k] = v; return true; },
  });
  return ctx;
}

describe('The big Ghost loads and runs on a phone', () => {
  it('draws every exercise without a runtime error (an error used to switch it off silently)', () => {
    for (const lp of [lpOk, lpBK]) {
      const seen = new Set();
      for (const item of buildCatalog('field', lp)) {
        if (seen.has(item.patternId)) continue;
        seen.add(item.patternId);
        for (let ms = 0; ms < 3000; ms += 97) drawGhostOverlay(strictCtx(), catalogGhostSpec(item.id), lp, ms, { x: 300, y: 600 }, 260, 0.55, 1100);
      }
    }
  });

  it('no canvas blur in the full-screen Ghost (it cost ~40 ms a frame on a phone)', () => {
    const ctx = strictCtx();
    const spec = catalogGhostSpec(buildCatalog('field', lpBK).find(i => i.patternId === 'shadowKick').id);
    for (let ms = 0; ms < 2000; ms += 100) drawGhostOverlay(ctx, spec, lpBK, ms, { x: 300, y: 600 }, 260, 0.55, 1100);
    expect(ctx.stats.fills).toBeGreaterThan(100);
    expect(ctx.stats.blurs).toBe(0);
  });
});

describe('Virtual coach — male / female, at the side of the screen', () => {
  it('both coaches exist with Hebrew + English labels', () => {
    expect(COACH_IDS).toEqual(['male', 'female']);
    for (const c of COACH_IDS) expect(COACH_INFO[c].label.he.length).toBeGreaterThan(3);
  });

  it('demonstrates while the trainee works, claps after a set, otherwise stands ready', () => {
    expect(coachMode({ phase: 'exercising', hasSpec: true })).toBe('demo');
    expect(coachMode({ phase: 'warm_up', hasSpec: true })).toBe('demo');
    expect(coachMode({ phase: 'resting', hasSpec: true, justFinished: true })).toBe('cheer');
    expect(coachMode({ phase: 'resting', hasSpec: true })).toBe('idle');
    expect(coachMode({ phase: 'exercising', hasSpec: false })).toBe('idle');
  });

  it('the demonstration is exactly the Ghost\'s movement (same profile, same leg)', () => {
    const spec = catalogGhostSpec(buildCatalog('field', lpBK).find(i => i.patternId === 'shadowKick').id);
    const pose = coachPose('demo', spec, lpBK, 0.48 * 2000);
    expect(pose.depth).toBe(true);
    expect(Object.values(pose.feet).some(f => f.style === 'laces')).toBe(true);
    expect(pose.segments.find(s => s.limb === 'left_leg' && s.part === 'shin').dashed).toBe(true);   // the prosthesis
  });

  it('breathes at rest and nods while talking', () => {
    const a = coachPose('idle', null, lpOk, 0), b = coachPose('idle', null, lpOk, 950);
    expect(a.head.y).not.toBeCloseTo(b.head.y, 4);
    const quiet = coachPose('idle', null, lpOk, 105, false), talk = coachPose('idle', null, lpOk, 105, true);
    expect(talk.head.y).not.toBeCloseTo(quiet.head.y, 4);
  });

  it('draws both coaches in every mode (tracksuit, face that talks, whistle) without errors', () => {
    const spec = { profile: EXPERT_PROFILES.squat };
    for (const coach of COACH_IDS) for (const mode of ['demo', 'idle', 'cheer']) for (const talk of [0, 0.8]) {
      const ctx = strictCtx();
      drawCoach(ctx, coach, { mode, spec, lp: lpOk, ms: 700, talk }, 288, 448);
      expect(ctx.stats.fills).toBeGreaterThan(15);
    }
    expect(coachLook('female').pants).toBe(true);
  });
});

describe('Manual moves only — "next exercise" by tap or an EXPLICIT voice request', () => {
  it('only the explicit "תרגיל הבא" / "next exercise" counts — single words do not', () => {
    for (const s of ['תרגיל הבא', 'יאללה תרגיל הבא', 'עבור לתרגיל הבא', 'Next exercise']) expect(isNextCommand(s), s).toBe(true);
    for (const s of ['', 'הבא', 'ממשיכים', 'עבור', 'next', 'הלאה', 'הבאתי את הכדור', 'כל הכבוד סיימת את התרגיל כשאתה מוכן לחץ על הכפתור או אמור תרגיל הבא']) {
      expect(isNextCommand(s), s).toBe(false);
    }
  });

  it('never accepts what was heard while (or right after) the coach spoke', () => {
    expect(acceptCommand({ coachSpeaking: true, sessionHeardCoach: false })).toBe(false);
    expect(acceptCommand({ coachSpeaking: false, sessionHeardCoach: true })).toBe(false);
    expect(acceptCommand({ coachSpeaking: false, sessionHeardCoach: false, isFinal: false })).toBe(false);
    expect(acceptCommand({ coachSpeaking: false, sessionHeardCoach: false, isFinal: true })).toBe(true);
  });
});

describe('The coach speaks in its own gender', () => {
  it('a female coach: feminine first person; words to the trainee unchanged', () => {
    expect(genderizeCoachText('יפה, התחלת! אני סופר איתך.', 'female')).toBe('יפה, התחלת! אני סופרת איתך.');
    expect(genderizeCoachText('אני עוקב אחריך!', 'female')).toBe('אני עוקבת אחריך!');
    expect(genderizeCoachText('אני לא מצליח לראות את הרגליים', 'female')).toBe('אני לא מצליחה לראות את הרגליים');
    expect(genderizeCoachText('אני מוכן כשאתה מוכן.', 'female')).toBe('אני מוכנה כשאתה מוכן.');
    expect(genderizeCoachText('אני צריך לראות אותך', 'female')).toBe('אני צריכה לראות אותך');
    expect(genderizeCoachText('תתחיל כשאתה מוכן', 'female')).toBe('תתחיל כשאתה מוכן');
  });

  it('a male coach (or none) is unchanged', () => {
    expect(genderizeCoachText('אני סופר איתך', 'male')).toBe('אני סופר איתך');
    expect(genderizeCoachText('אני סופר איתך', null)).toBe('אני סופר איתך');
  });
});
