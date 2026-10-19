// ============================================================
// debrief — the REST between sets: the coach as the expert in the locker room (owner, 2026-10-18)
//
// PURE. During the set the coach gives only short, immediate sideline cues (policy.liveCue). In the
// rest he turns into the expert: from the set's measured log (profileEvaluator tr.log — every
// attempt, every rule judged / violated, the measured values) he builds a professional analysis:
//   1. the set in numbers (reps / seconds, the real accuracy — "—" never invented)
//   2. THE main fix: what happened, how often (n of N), the measured value vs. the target, WHY it
//      matters (biomechanics / injury) and HOW to fix it (the feel / the drill cue)
//   3. a second point, short
//   4. what was GOOD — only what was measured clean in enough attempts (never invented praise)
//   5. ONE goal for the next set
// For exercises analysed by the older analyzers (no expert rules), the same structure from the
// corrections they saw (utils/techniqueWhy). Safety first: a danger leads the analysis.
// ============================================================

import { EXTERNAL_CUES } from './brain.js';
import { liveCue } from './policy.js';

const DEG = new Set(['knee', 'hip', 'elbow', 'shoulder', 'bodyLine', 'trunkLean', 'pelvisDrop', 'ankleDeg', 'absorptionDeg', 'trunkRange']);
const L = (o, he) => (o ? (he ? o.he : o.en) : '');

// what a CLEAN measure means, said only when it was measured clean (by the rule's measure)
export const GOOD_BY_MEASURE = Object.freeze({
  trunkLean: { he: 'הגב נשאר יציב וזקוף', en: 'your back stayed tall and still' },
  kneeTrack: { he: 'הברכיים נשארו בקו האצבעות', en: 'your knees stayed over your toes' },
  kneeIn: { he: 'ברך רגל העמידה נשארה בקו', en: 'your standing knee stayed in line' },
  heelLift: { he: 'העקבים נשארו על הרצפה', en: 'your heels stayed down' },
  bodyLine: { he: 'קו הגוף נשאר ישר', en: 'your body line stayed straight' },
  knee: { he: 'הטווח בברך היה מלא', en: 'your knee range was full' },
  hip: { he: 'הטווח באגן היה מלא', en: 'your hip range was full' },
  elbow: { he: 'הטווח במרפק היה מלא', en: 'your elbow range was full' },
  shoulder: { he: 'הטווח בכתף היה נכון', en: 'your shoulder range was right' },
  contactToe: { he: 'לא פגעת עם האצבעות', en: 'no toe-pokes' },
  contactLaces: { he: 'המגע היה עם פנים כף הרגל', en: 'you met the ball with the inside of the foot' },
  ankleDeg: { he: 'הקרסול היה נעול ברגע המגע', en: 'your ankle was locked at contact' },
  balance: { he: 'המשקל היה מעל רגל התמיכה', en: 'your weight was over the support foot' },
  chainLeadMs: { he: 'התנועה התחילה מהירך', en: 'the swing started from the hip' },
  absorptionDeg: { he: 'הנחיתות היו רכות', en: 'your landings were soft' },
  swayRatio: { he: 'הגוף היה יציב', en: 'your body was stable' },
  cadence: { he: 'הקצב היה נכון', en: 'your cadence was right' },
});

const measureOf = (r) => r.metric || r.feature;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** "the knee reached 128° on average; the target at the bottom: 65–105°" (degrees only; null otherwise). */
export function measuredLine(r, values, profile, he = true) {
  const m = measureOf(r);
  const v = avg(values);
  if (v === null || !DEG.has(m)) return null;
  const val = Math.round(v);
  const j = profile?.joints?.[m];
  let target;
  if (r.when === 'peak' && j?.peak) target = he ? `בין ${j.peak[0]} ל-${j.peak[1]} מעלות` : `${j.peak[0]}–${j.peak[1]}°`;
  else target = r.op === '>' ? (he ? `עד ${r.value} מעלות` : `up to ${r.value}°`) : (he ? `לפחות ${r.value} מעלות` : `at least ${r.value}°`);
  return he ? `מדדתי בממוצע ${val} מעלות; היעד: ${target}` : `I measured ${val}° on average; the target: ${target}`;
}

const howOf = (r, he) => L(r.how, he) || L(EXTERNAL_CUES[measureOf(r)], he) || '';

/**
 * The rest's analysis.
 * @param {{ log?, profile?, reps?: number, accuracy?: number|null, setNo?: number, he?: boolean, name?: string,
 *           legacy?: { counts: Object<string, number>, reps?: number }|null, whyOf?: (text) => {he,en}|null,
 *           lastSet?: boolean, extra?: string[] }} o
 * @returns {{ speech: string, card: { headline: string, items: Array<{ kind: 'fix'|'note'|'good'|'focus', title: string, detail?: string[] }> } }}
 */
export function buildDebrief(o) {
  const he = o.he !== false;
  const log = o.log || null;
  const unitSec = log?.unit === 'sec';
  const N = (n, k) => (he ? `${n} מתוך ${k} ${unitSec ? 'שניות' : 'חזרות'}` : `${n} of ${k} ${unitSec ? 'seconds' : 'reps'}`);
  const items = [];
  const said = [];

  // 1. The set in numbers
  const acc = typeof o.accuracy === 'number' ? Math.round(o.accuracy) : null;
  const who = o.name ? `${o.name}, ` : '';
  const headline = he
    ? `${who}סט ${o.setNo || ''} מאחורינו: ${unitSec ? `${log?.attempts || 0} שניות עבודה` : `${o.reps ?? 0} חזרות`}${acc !== null ? `, דיוק ${acc} אחוז` : ''}.`
    : `${who}set ${o.setNo || ''} done: ${unitSec ? `${log?.attempts || 0} seconds of work` : `${o.reps ?? 0} reps`}${acc !== null ? `, ${acc}% accuracy` : ''}.`;
  said.push(headline.replace(/ {2,}/g, ' '));
  if (log && !unitSec && log.partial > 0) {
    const t = he ? `${log.partial} חזרות נעצרו לפני הטווח המלא ולא נספרו.` : `${log.partial} reps stopped short of the full range and did not count.`;
    said.push(t); items.push({ kind: 'note', title: t });
  }

  // nothing was seen to count: say WHY, honestly (never "good set")
  const nothingSeen = !unitSec && !(o.reps > 0) && !(log?.attempts > 0) && !Object.keys(o.legacy?.counts || {}).length;
  if (nothingSeen) {
    const t = he ? 'לא ספרתי אף חזרה — לא ראיתי את התנועה בבירור במצלמה' : "I counted no reps — I couldn't see the movement clearly on camera";
    const f = he ? 'בסט הבא: ודא שאני רואה אותך, ורק אז מתחילים' : 'Next set: make sure I can see you, then we start';
    items.push({ kind: 'note', title: t }, { kind: 'focus', title: f });
    said.push(`${t}.`, `${f}.`);
    for (const x of o.extra || []) if (x) said.push(x);
    return { speech: said.join(' '), card: { headline: said[0], items } };
  }

  // 2–3. The fixes, from the measured log (safety first, then how often)
  const entries = Object.values(log?.rules || {}).filter(e => e.judged > 0);
  const faults = entries.filter(e => e.n > 0)
    .sort((a, b) => ((a.rule.severity === 'danger' ? 0 : 1) - (b.rule.severity === 'danger' ? 0 : 1)) || (b.n / b.judged - a.n / a.judged) || (b.n - a.n));
  let focus = null;
  if (faults.length) {
    const e = faults[0], r = e.rule;
    focus = liveCue(r, he);
    const detail = [];
    const ml = measuredLine(r, e.values, o.profile, he);
    if (ml) detail.push(ml);
    if (r.why) detail.push((he ? 'למה זה חשוב: ' : 'Why it matters: ') + L(r.why, he));
    const how = howOf(r, he);
    if (how) detail.push((he ? 'איך מתקנים: ' : 'How to fix it: ') + how);
    const title = he ? `הדבר המרכזי לתיקון: ${L(r.msg, he)}. זה קרה ב-${N(e.n, e.judged)}` : `The main fix: ${L(r.msg, he)}. It happened in ${N(e.n, e.judged)}`;
    items.push({ kind: 'fix', title, detail });
    said.push(`${title}.`, ...detail.map(d => `${d}.`));
    const e2 = faults[1];
    if (e2 && e2.n / e2.judged >= 0.3) {
      const t2 = he ? `ועוד נקודה: ${L(e2.rule.msg, he)}. ב-${N(e2.n, e2.judged)}` : `One more point: ${L(e2.rule.msg, he)}. In ${N(e2.n, e2.judged)}`;
      const d2 = e2.rule.why ? [L(e2.rule.why, he)] : [];
      items.push({ kind: 'fix', title: t2, detail: d2 });
      said.push(`${t2}.`);
    }
  } else if (o.legacy && Object.keys(o.legacy.counts || {}).length) {
    // an exercise of the older analyzers: their own corrections, with the why
    const [text, n] = Object.entries(o.legacy.counts).sort((a, b) => b[1] - a[1])[0];
    focus = text.split(/!|—/)[0].trim() || text;
    const why = o.whyOf?.(text);
    const title = he ? `הדבר המרכזי לתיקון: ${text} — ב-${n} חזרות` : `The main fix: ${text} — in ${n} reps`;
    const detail = why ? [(he ? 'למה זה חשוב: ' : 'Why it matters: ') + L(why, he)] : [];
    items.push({ kind: 'fix', title, detail });
    said.push(`${title}.`, ...detail.map(d => `${d}.`));
  }

  // 4. What was good — measured clean in enough attempts (never invented)
  const enough = Math.max(3, Math.ceil(0.5 * (log?.attempts || 0)));
  // (never praise a measure that had an error this set — a clean "too deep" is not a full range)
  const faulted = new Set(faults.map(e => measureOf(e.rule)));
  const goods = [...new Set(entries.filter(e => e.n === 0 && e.judged >= enough && !faulted.has(measureOf(e.rule)))
    .map(e => L(GOOD_BY_MEASURE[measureOf(e.rule)], he)).filter(Boolean))].slice(0, 2);
  if (goods.length) {
    const t = (he ? 'מה היה טוב: ' : 'What was good: ') + goods.join(he ? ', ו' : ', and ');
    items.push({ kind: 'good', title: t });
    said.push(`${t}.`);
  }

  // 5. ONE goal for the next set
  const ft = focus
    ? (o.lastSet ? (he ? `על זה נעבוד בפעם הבאה: ${focus}` : `Next time we work on: ${focus}`) : (he ? `בסט הבא — מטרה אחת: ${focus}` : `Next set — one goal: ${focus}`))
    : ((log?.attempts || 0) >= 3 ? (he ? 'בסט הבא: אותה איכות, באותו קצב' : 'Next set: the same quality, the same pace') : null);
  if (ft && !(o.lastSet && !focus)) { items.push({ kind: 'focus', title: ft }); said.push(`${ft}.`); }
  for (const x of o.extra || []) if (x) said.push(x);

  return { speech: said.join(' '), card: { headline: said[0], items } };
}
