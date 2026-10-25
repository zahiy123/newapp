// ============================================================
// aiFacts — the MEASURED facts the AI coach words its corrections from (owner, 2026-10-19: "never a
// fixed bank of sentences — the AI words every correction for what the camera measured right now")
//
// PURE. The device measures (the expert profiles: WHAT is wrong, by how much, in which rep, how often);
// these builders hand the server's AI coach (server/services/liveCoach.js) exactly those facts + the
// expert knowledge of the rule (the technique truth it must not contradict). The AI decides the words.
// If it cannot answer in time, the device says its own measured line — never silence on a correction.
// ============================================================

import { analyzeLog, targetText, sayableValue, GOOD_BY_MEASURE } from './debrief.js';

const L = (o, he) => (o ? (he ? o.he : o.en) : '');

/** The trainee's body in plain words (the AI must respect a prosthesis / a missing limb precisely). */
export function bodyText(lp = {}) {
  const parts = [];
  for (const side of ['left', 'right']) {
    for (const limb of ['leg', 'arm']) {
      const l = lp?.[`${side}_${limb}`];
      if (l?.state === 'prosthetic') parts.push(`${side} ${limb}: ${l.level ? `${l.level.replace('_', '-')} ` : ''}prosthesis`);
      else if (l?.state === 'absent') parts.push(`${side} ${limb}: absent`);
    }
  }
  if (lp?.crutches) parts.push('trains on crutches today');
  if (lp?.wheelchair) parts.push('wheelchair');
  return parts.join('; ');
}

/**
 * A live cue's facts.
 * @param {{ rule, profile?, lp?, exercise?, sport?, name?, he?, rep?: number|null, times?: number|null, recent?: string[] }} o
 *   rule — the correction (msg / why / how / external; `measured` + `side` when the evaluator gave them)
 */
export function cueFacts(o) {
  const he = o.he !== false;
  const r = o.rule || {};
  return {
    lang: he ? 'he' : 'en', name: o.name || '', exercise: o.exercise || '', sport: o.sport || '', body: bodyText(o.lp),
    side: r.side === 'left' || r.side === 'right' ? r.side : null,
    rep: o.rep ?? null,
    error: {
      what: L(r.msg, he), why: L(r.why, he), how: L(r.how, he) || L(r.external, he),
      measured: sayableValue(r, r.measured), target: targetText(r, o.profile, he) || '', times: o.times ?? null,
    },
    recent: (o.recent || []).slice(-4),
  };
}

/** A cue's facts for a correction of the older analyzers (their text + its why). */
export function legacyCueFacts({ text, why = null, exercise = '', sport = '', lp = {}, name = '', he = true, recent = [] }) {
  return {
    lang: he ? 'he' : 'en', name, exercise, sport, body: bodyText(lp), side: null, rep: null,
    error: { what: text, why: L(why, he), how: '', measured: null, target: '', times: null },
    recent: recent.slice(-4),
  };
}

/** The rest analysis' facts, from the set's measured log (+ the older analyzers' corrections). */
export function debriefFacts(o) {
  const he = o.he !== false;
  const { faults, goods } = analyzeLog(o.log, he);
  const errors = faults.slice(0, 4).map(e => {
    const vals = e.values.filter(v => typeof v === 'number');
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return {
      what: L(e.rule.msg, he), n: e.n, judged: e.judged, severity: e.rule.severity,
      measured: sayableValue(e.rule, avg), target: targetText(e.rule, o.profile, he) || '',
      why: L(e.rule.why, he), how: L(e.rule.how, he),
    };
  });
  if (!errors.length && o.legacy?.counts) {
    for (const [text, n] of Object.entries(o.legacy.counts).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      errors.push({ what: text, n, judged: Math.max(n, o.reps || 0), severity: 'error', measured: null, target: '', why: L(o.whyOf?.(text), he), how: '' });
    }
  }
  return {
    lang: he ? 'he' : 'en', name: o.name || '', exercise: o.exercise || '', sport: o.sport || '', body: bodyText(o.lp),
    setNo: o.setNo ?? null, lastSet: !!o.lastSet, unit: o.log?.unit === 'sec' ? 'sec' : 'reps',
    reps: o.reps ?? 0, accuracy: typeof o.accuracy === 'number' ? Math.round(o.accuracy) : null,
    attempts: o.log?.attempts ?? 0, partial: o.log?.partial ?? 0,
    errors, clean: goods, extras: (o.extras || []).filter(Boolean),
    visual: (o.visual || []).filter(Boolean).slice(-4),
    oneOffs: (o.oneOffs || []).slice(0, 4),
    setProblems: (o.problems?.problems || []).slice(0, 6),
    fixedAfterStop: (o.problems?.fixed || []).slice(0, 4),
    judgedNothing: !errors.length && !goods.length,
  };
}

export { GOOD_BY_MEASURE };
