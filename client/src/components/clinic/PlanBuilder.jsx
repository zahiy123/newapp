// The clinician builds the patient's plan BY HAND (Stage 4B step 5): the catalog grouped by joint / area; pick a
// movement, its version, sets / reps (or seconds) / rest and a note — or write YOUR OWN exercise (free text) under
// any group or the general area — or keep the automatic plan as the backup. The patient's body and the clinician's
// own limits decide what can be chosen (shown, never hidden).
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
const keyOf = (c) => (c.custom ? c.id : c.pattern);
const newCustom = (group) => ({ custom: true, id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`, name: '', instructions: '', group, basedOn: null, variation: 'standard', unit: 'reps', sets: 3, reps: 10, rest: 60, note: '' });

function NumberField({ id, label, value, min, max, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] text-gray-500">{label}</label>
      <input id={id} type="number" min={min} max={max} inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
        className="w-20 border rounded px-2 py-1 text-sm text-center tabular-nums" />
    </div>
  );
}

export default function PlanBuilder({ traineeId, plan, limits, profile, isHe, onSaved }) {
  const lp = useMemo(() => getLimbProfile(profile || {}), [profile]);
  const groups = useMemo(() => planCatalog(lp, activeConstraints(limits), isHe), [lp, limits, isHe]);
  const byId = useMemo(() => Object.fromEntries(groups.flatMap(g => g.patterns.map(p => [p.id, p]))), [groups]);
  const allChoosable = useMemo(() => groups.flatMap(g => g.patterns).filter(p => p.fits && p.verdict !== 'blocked'), [groups]);
  const [mode, setMode] = useState(plan?.mode || 'auto');
  const [chosen, setChosen] = useState(() => (plan?.exercises || []).filter(e => e.custom || byId[e.pattern]));
  const [open, setOpen] = useState(() => new Set(['general']));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const isChosen = (id) => chosen.some(c => !c.custom && c.pattern === id);
  const toggle = (p) => {
    if (isChosen(p.id)) setChosen(chosen.filter(c => c.custom || c.pattern !== p.id));
    else setChosen([...chosen, { pattern: p.id, variation: p.variations[0]?.id || 'standard', ...p.defaults, note: '' }]);
  };
  const edit = (key, patch) => setChosen(chosen.map(c => (keyOf(c) === key ? { ...c, ...patch } : c)));
  const remove = (key) => setChosen(chosen.filter(c => keyOf(c) !== key));
  const move = (i, d) => { const n = [...chosen]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setChosen(n); };
  const addCustom = (group) => { setChosen([...chosen, newCustom(group)]); setOpen(new Set([...open, group])); };
  const nameOf = (c) => (c.custom ? (c.name || (isHe ? '(תרגיל ללא שם)' : '(unnamed)')) : byId[c.pattern]?.name);
  const unitOf = (c) => (c.custom ? (c.basedOn ? byId[c.basedOn]?.unit : c.unit) : byId[c.pattern]?.unit);

  async function save() {
    setMsg('');
    if (mode !== 'auto' && !chosen.length) { setMsg(isHe ? 'בחר לפחות תרגיל אחד, או השאר "אוטומטי".' : 'Choose at least one exercise, or keep "Automatic".'); return; }
    if (chosen.some(c => c.custom && String(c.name || '').trim().length < 2)) { setMsg(isHe ? 'לכל תרגיל משלך צריך שם.' : 'Every custom exercise needs a name.'); return; }
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

  // one custom exercise's editor
  const CustomEditor = (c, g) => {
    const k = keyOf(c);
    const bases = (g.id === 'general' ? allChoosable : g.patterns.filter(p => p.fits && p.verdict !== 'blocked'));
    const base = c.basedOn ? byId[c.basedOn] : null;
    return (
      <div key={k} className="px-4 py-3 space-y-2 bg-amber-50/40">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-amber-900">{'✍️'} {isHe ? 'תרגיל משלך' : 'Your own exercise'}</span>
          <button type="button" onClick={() => remove(k)} className="text-xs text-rose-700 underline">{isHe ? 'הסר' : 'Remove'}</button>
        </div>
        <div>
          <label htmlFor={`cn-${k}`} className="block text-[11px] text-gray-500">{isHe ? 'שם התרגיל' : 'Exercise name'}</label>
          <input id={`cn-${k}`} value={c.name} maxLength={60} onChange={e => edit(k, { name: e.target.value })} className="w-full border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label htmlFor={`ci-${k}`} className="block text-[11px] text-gray-500">{isHe ? 'הוראות ביצוע (כל משפט — שלב)' : 'Instructions (each sentence a step)'}</label>
          <textarea id={`ci-${k}`} value={c.instructions} maxLength={600} rows={2} onChange={e => edit(k, { instructions: e.target.value })} className="w-full border rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`cb-${k}`} className="block text-[11px] text-gray-500">{isHe ? 'מבוסס על (צללית ומדידה)' : 'Based on (Ghost + measurement)'}</label>
            <select id={`cb-${k}`} value={c.basedOn || ''} onChange={e => edit(k, { basedOn: e.target.value || null, variation: 'standard' })} className="border rounded px-2 py-1 text-sm max-w-[14rem]">
              <option value="">{isHe ? 'ללא — ביצוע ידני' : 'None — manual'}</option>
              {bases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {base && base.variations.length > 1 && (
            <div>
              <label htmlFor={`cv-${k}`} className="block text-[11px] text-gray-500">{isHe ? 'גרסה' : 'Version'}</label>
              <select id={`cv-${k}`} value={c.variation} onChange={e => edit(k, { variation: e.target.value })} className="border rounded px-2 py-1 text-sm">
                {base.variations.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
          )}
          {!base && (
            <div>
              <label htmlFor={`cu-${k}`} className="block text-[11px] text-gray-500">{isHe ? 'נמדד ב' : 'Measured in'}</label>
              <select id={`cu-${k}`} value={c.unit} onChange={e => edit(k, { unit: e.target.value })} className="border rounded px-2 py-1 text-sm">
                <option value="reps">{isHe ? 'חזרות' : 'Reps'}</option>
                <option value="sec">{isHe ? 'שניות' : 'Seconds'}</option>
              </select>
            </div>
          )}
          <NumberField id={`cs-${k}`} label={isHe ? 'סטים' : 'Sets'} value={c.sets} min={1} max={10} onChange={v => edit(k, { sets: v })} />
          <NumberField id={`cr-${k}`} label={unitOf(c) === 'sec' ? (isHe ? 'שניות' : 'Seconds') : (isHe ? 'חזרות' : 'Reps')} value={c.reps} min={1} max={300} onChange={v => edit(k, { reps: v })} />
          <NumberField id={`ct-${k}`} label={isHe ? 'מנוחה (שנ׳)' : 'Rest (s)'} value={c.rest} min={0} max={600} onChange={v => edit(k, { rest: v })} />
        </div>
        <p className="text-[11px] text-gray-600">{base
          ? (isHe ? `הצללית והמדידה של "${base.name}", עם השם וההוראות שלך.` : `The Ghost and measurement of "${base.name}", with your name and instructions.`)
          : (isHe ? 'ביצוע ידני: המטופל רואה את ההוראות ומסמן "סיימתי את הסט" (בשניות — עם שעון). אין ספירה או תיקוני טכניקה אוטומטיים.' : 'Manual: the patient sees the instructions and taps "Set done" (seconds — with a timer). No automatic counting / technique corrections.')}</p>
      </div>
    );
  };

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
                <div key={keyOf(c)} className="flex items-center gap-2 text-sm">
                  <span className="tabular-nums text-gray-500 w-5">{i + 1}.</span>
                  <span className="flex-1 text-gray-900">{c.custom ? '✍️ ' : ''}{nameOf(c)} <span className="text-gray-500 tabular-nums">· {c.sets}×{c.reps}{unitOf(c) === 'sec' ? (isHe ? ' שנ׳' : ' s') : ''}</span></span>
                  <button type="button" onClick={() => move(i, -1)} aria-label={isHe ? 'למעלה' : 'Up'} className="px-1.5 text-gray-600">{'▲'}</button>
                  <button type="button" onClick={() => move(i, 1)} aria-label={isHe ? 'למטה' : 'Down'} className="px-1.5 text-gray-600">{'▼'}</button>
                  <button type="button" onClick={() => remove(keyOf(c))} className="text-xs text-rose-700 underline">{isHe ? 'הסר' : 'Remove'}</button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {groups.map(g => {
              const customs = chosen.filter(c => c.custom && (c.group || 'general') === g.id);
              const n = g.patterns.filter(p => isChosen(p.id)).length + customs.length;
              const isOpen = open.has(g.id);
              return (
                <div key={g.id} className="border rounded-xl">
                  <button type="button" onClick={() => { const s = new Set(open); if (isOpen) s.delete(g.id); else s.add(g.id); setOpen(s); }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-start" aria-expanded={isOpen}>
                    <span className="font-semibold text-gray-900">{isHe ? g.he : g.en}</span>
                    <span className="text-xs text-gray-500">{n > 0 ? (isHe ? `${n} נבחרו · ` : `${n} chosen · `) : ''}{g.patterns.length ? `${g.patterns.length} ${isHe ? 'תרגילים' : 'exercises'} ` : ''}{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="divide-y border-t">
                      {g.patterns.map(p => {
                        const reason = reasonOf(p);
                        const disabled = !p.fits || p.verdict === 'blocked';
                        const c = chosen.find(x => !x.custom && x.pattern === p.id);
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
                                <NumberField id={`sets-${p.id}`} label={isHe ? 'סטים' : 'Sets'} value={c.sets} min={1} max={10} onChange={v => edit(p.id, { sets: v })} />
                                <NumberField id={`reps-${p.id}`} label={p.unit === 'sec' ? (isHe ? 'שניות' : 'Seconds') : (isHe ? 'חזרות' : 'Reps')} value={c.reps} min={1} max={300} onChange={v => edit(p.id, { reps: v })} />
                                <NumberField id={`rest-${p.id}`} label={isHe ? 'מנוחה (שנ׳)' : 'Rest (s)'} value={c.rest} min={0} max={600} onChange={v => edit(p.id, { rest: v })} />
                                <div className="flex-1 min-w-[10rem]">
                                  <label htmlFor={`n-${p.id}`} className="block text-[11px] text-gray-500">{isHe ? 'הערה למטופל' : 'A note'}</label>
                                  <input id={`n-${p.id}`} value={c.note || ''} maxLength={200} onChange={e => edit(p.id, { note: e.target.value })} className="w-full border rounded px-2 py-1 text-sm" />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {customs.map(c => CustomEditor(c, g))}
                      <div className="px-4 py-2.5">
                        <button type="button" onClick={() => addCustom(g.id)} className="text-sm font-semibold text-teal-800 underline">
                          {'✍️'} {isHe ? `+ תרגיל משלך${g.id === 'general' ? '' : ` (${g.he})`}` : `+ Your own exercise${g.id === 'general' ? '' : ` (${g.en})`}`}
                        </button>
                      </div>
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
