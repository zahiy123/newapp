// The clinician builds the patient's plan BY HAND (Stage 4B step 5): the catalog grouped by joint / area; pick a
// movement, its version, sets / reps (or seconds) / rest and a note — or keep the automatic plan as the backup.
// The patient's body and the clinician's own limits decide what can be chosen (shown, never hidden).
import { useMemo, useState } from 'react';
import { clinic, clinicError } from '../../utils/clinicApi';
import { planCatalog } from '../../engine/clinical/clinicianPlan';
import { activeConstraints } from '../../engine/clinical/clinicalLimits';
import { getLimbProfile } from '../../engine/limbProfile';

const MODES = [
  { id: 'auto', he: 'אוטומטי', en: 'Automatic', hintHe: 'המערכת בונה את האימון (כמו היום)', hintEn: 'The system builds the workout (as today)' },
  { id: 'manual', he: 'ידני', en: 'Manual', hintHe: 'רק התרגילים שבחרת. אם אף אחד לא יכול לרוץ באותו יום — האוטומטי כגיבוי', hintEn: 'Only your exercises. If none can run that day — the automatic plan as the backup' },
  { id: 'manual_plus_auto', he: 'ידני + אוטומטי', en: 'Manual + automatic', hintHe: 'התרגילים שבחרת קודם, ואחריהם האימון האוטומטי', hintEn: 'Your exercises first, then the automatic workout' },
];

export default function PlanBuilder({ traineeId, plan, limits, profile, isHe, onSaved }) {
  const lp = useMemo(() => getLimbProfile(profile || {}), [profile]);
  const groups = useMemo(() => planCatalog(lp, activeConstraints(limits), isHe), [lp, limits, isHe]);
  const byId = useMemo(() => Object.fromEntries(groups.flatMap(g => g.patterns.map(p => [p.id, p]))), [groups]);
  const [mode, setMode] = useState(plan?.mode || 'auto');
  const [chosen, setChosen] = useState(() => (plan?.exercises || []).filter(e => byId[e.pattern]));
  const [open, setOpen] = useState(() => new Set());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const isChosen = (id) => chosen.some(c => c.pattern === id);
  const toggle = (p) => {
    if (isChosen(p.id)) setChosen(chosen.filter(c => c.pattern !== p.id));
    else setChosen([...chosen, { pattern: p.id, variation: p.variations[0]?.id || 'standard', ...p.defaults, note: '' }]);
  };
  const edit = (id, patch) => setChosen(chosen.map(c => (c.pattern === id ? { ...c, ...patch } : c)));
  const move = (i, d) => { const n = [...chosen]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setChosen(n); };

  async function save() {
    setMsg('');
    if (mode !== 'auto' && !chosen.length) { setMsg(isHe ? 'בחר לפחות תרגיל אחד, או השאר "אוטומטי".' : 'Choose at least one exercise, or keep "Automatic".'); return; }
    setBusy(true);
    const r = await clinic('PUT', `/patients/${encodeURIComponent(traineeId)}/plan`, { mode, exercises: mode === 'auto' ? [] : chosen });
    setBusy(false);
    if (!r.ok) { setMsg(r.error === 'bad_numbers' ? (isHe ? 'סטים 1–10, חזרות / שניות 1–300, מנוחה 0–600' : 'Sets 1–10, reps / seconds 1–300, rest 0–600') : clinicError(r.error, isHe)); return; }
    setMsg(isHe ? 'התוכנית נשמרה. תיכנס לתוקף באימון הבא של המטופל.' : 'Saved. In force from the patient’s next workout.');
    onSaved?.(r.data.plan);
  }

  const reasonOf = (p) => (!p.fits ? (isHe ? 'לא מתאים לגוף של המטופל' : 'Does not fit the patient’s body')
    : p.verdict === 'blocked' ? (isHe ? 'חסום במגבלות שקבעת' : 'Blocked by your limits')
      : p.verdict === 'partial' ? (isHe ? 'יבוצע בטווח חלקי (המגבלות שלך)' : 'Will run in a partial range (your limits)') : null);

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">{'📋'} {isHe ? 'תוכנית אימון' : 'Training plan'}</h2>

      <div className="grid sm:grid-cols-3 gap-2" role="radiogroup">
        {MODES.map(m => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
            className={`text-start rounded-xl border-2 px-3 py-2 ${mode === m.id ? 'border-teal-600 bg-teal-50' : 'border-gray-200'}`}>
            <div className="font-semibold text-gray-900 text-sm">{isHe ? m.he : m.en}</div>
            <div className="text-xs text-gray-600">{isHe ? m.hintHe : m.hintEn}</div>
          </button>
        ))}
      </div>

      {mode !== 'auto' && (
        <>
          {chosen.length > 0 && (
            <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 space-y-1">
              <div className="text-sm font-semibold text-teal-900">{isHe ? `התוכנית — ${chosen.length} תרגילים, לפי הסדר` : `The plan — ${chosen.length} exercises, in order`}</div>
              {chosen.map((c, i) => (
                <div key={c.pattern} className="flex items-center gap-2 text-sm">
                  <span className="tabular-nums text-gray-500 w-5">{i + 1}.</span>
                  <span className="flex-1 text-gray-900">{byId[c.pattern]?.name} <span className="text-gray-500 tabular-nums">· {c.sets}×{c.reps}{byId[c.pattern]?.unit === 'sec' ? (isHe ? ' שנ׳' : ' s') : ''}</span></span>
                  <button type="button" onClick={() => move(i, -1)} aria-label={isHe ? 'למעלה' : 'Up'} className="px-1.5 text-gray-600">{'▲'}</button>
                  <button type="button" onClick={() => move(i, 1)} aria-label={isHe ? 'למטה' : 'Down'} className="px-1.5 text-gray-600">{'▼'}</button>
                  <button type="button" onClick={() => setChosen(chosen.filter(x => x.pattern !== c.pattern))} className="text-xs text-rose-700 underline">{isHe ? 'הסר' : 'Remove'}</button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {groups.map(g => {
              const n = g.patterns.filter(p => isChosen(p.id)).length;
              const isOpen = open.has(g.id);
              return (
                <div key={g.id} className="border rounded-xl">
                  <button type="button" onClick={() => { const s = new Set(open); if (isOpen) s.delete(g.id); else s.add(g.id); setOpen(s); }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-start" aria-expanded={isOpen}>
                    <span className="font-semibold text-gray-900">{isHe ? g.he : g.en}</span>
                    <span className="text-xs text-gray-500">{n > 0 ? (isHe ? `${n} נבחרו · ` : `${n} chosen · `) : ''}{g.patterns.length} {isHe ? 'תרגילים' : 'exercises'} {isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="divide-y border-t">
                      {g.patterns.map(p => {
                        const reason = reasonOf(p);
                        const disabled = !p.fits || p.verdict === 'blocked';
                        const c = chosen.find(x => x.pattern === p.id);
                        return (
                          <div key={p.id} className={`px-4 py-2.5 space-y-2 ${disabled ? 'opacity-50' : ''}`}>
                            <label className="flex items-center gap-2">
                              <input type="checkbox" disabled={disabled} checked={!!c} onChange={() => toggle(p)} />
                              <span className="text-sm font-medium text-gray-900">{p.name}</span>
                              {reason && <span className={`text-[11px] rounded-full px-2 py-0.5 ${disabled ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-900'}`}>{reason}</span>}
                            </label>
                            {c && (
                              <div className="flex flex-wrap items-end gap-2 ps-6">
                                {p.variations.length > 1 && (
                                  <div>
                                    <label htmlFor={`v-${p.id}`} className="block text-[11px] text-gray-500">{isHe ? 'גרסה' : 'Version'}</label>
                                    <select id={`v-${p.id}`} value={c.variation} onChange={e => edit(p.id, { variation: e.target.value })} className="border rounded px-2 py-1 text-sm">
                                      {p.variations.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                                    </select>
                                  </div>
                                )}
                                {[['sets', isHe ? 'סטים' : 'Sets', 1, 10], ['reps', p.unit === 'sec' ? (isHe ? 'שניות' : 'Seconds') : (isHe ? 'חזרות' : 'Reps'), 1, 300], ['rest', isHe ? 'מנוחה (שנ׳)' : 'Rest (s)', 0, 600]].map(([k, label, min, max]) => (
                                  <div key={k}>
                                    <label htmlFor={`${k}-${p.id}`} className="block text-[11px] text-gray-500">{label}</label>
                                    <input id={`${k}-${p.id}`} type="number" min={min} max={max} inputMode="numeric" value={c[k]} onChange={e => edit(p.id, { [k]: e.target.value })}
                                      className="w-20 border rounded px-2 py-1 text-sm text-center tabular-nums" />
                                  </div>
                                ))}
                                <div className="flex-1 min-w-[10rem]">
                                  <label htmlFor={`n-${p.id}`} className="block text-[11px] text-gray-500">{isHe ? 'הערה למטופל' : 'A note'}</label>
                                  <input id={`n-${p.id}`} value={c.note || ''} maxLength={200} onChange={e => edit(p.id, { note: e.target.value })} className="w-full border rounded px-2 py-1 text-sm" />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button disabled={busy} onClick={save} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50">{isHe ? 'שמירת התוכנית' : 'Save the plan'}</button>
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
      </div>
      {plan?.updatedAt && <div className="text-xs text-gray-500">{isHe ? 'עודכן' : 'Updated'} {new Date(plan.updatedAt).toLocaleString(isHe ? 'he-IL' : 'en-GB')}{plan.byName ? ` · ${plan.byName}` : ''}</div>}
      <p className="text-xs text-gray-500">{isHe ? 'הגנת הכאב והמגבלות הקליניות חלות גם על התוכנית הזו. המערכת לא משנה את רמת התרגילים שבחרת.' : 'The pain protection and the clinical limits apply to this plan too. The system never changes the level you chose.'}</p>
    </section>
  );
}
