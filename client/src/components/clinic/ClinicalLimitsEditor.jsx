// The clinician's limits for ONE patient (Stage 4B step 4): the max range per joint, a blocked joint, forbidden
// movements, an optional end date. Saved by the server only (the patient reads, never writes).
import { useState } from 'react';
import { clinic, clinicError } from '../../utils/clinicApi';
import { PATTERNS } from '../../engine/catalog/patterns';
import { ROM_JOINTS } from '../../engine/progress/rom';

const JOINTS = ['knee', 'hip', 'shoulder', 'elbow'];
const SIDES = ['left', 'right'];
const dateInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

export default function ClinicalLimitsEditor({ traineeId, limits, isHe, onSaved }) {
  const [rom, setRom] = useState(() => ({ ...(limits?.romLimits || {}) }));
  const [blockedJoints, setBlockedJoints] = useState(() => new Set(limits?.blockedJoints || []));
  const [blocked, setBlocked] = useState(() => new Set(limits?.blockedPatterns || []));
  const [until, setUntil] = useState(() => dateInput(limits?.expiresAt));
  const [note, setNote] = useState(limits?.note || '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (set, setter, k) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); setter(n); };
  const jointName = (side, j) => (isHe ? `${ROM_JOINTS[j].he} ${side === 'left' ? 'שמאל' : 'ימין'}` : `${side} ${ROM_JOINTS[j].en.toLowerCase()}`);

  async function save() {
    setBusy(true); setMsg('');
    const romLimits = Object.fromEntries(Object.entries(rom).filter(([, v]) => v !== '' && v != null && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const r = await clinic('PUT', `/patients/${encodeURIComponent(traineeId)}/limits`, {
      romLimits, blockedJoints: [...blockedJoints], blockedPatterns: [...blocked],
      expiresAt: until ? new Date(`${until}T23:59:59`).getTime() : null, note,
    });
    setBusy(false);
    if (!r.ok) { setMsg(r.error === 'bad_limit' ? (isHe ? 'טווח חייב להיות בין 5° ל-180°' : 'A limit must be 5°–180°') : clinicError(r.error, isHe)); return; }
    setMsg(isHe ? 'נשמר. ייכנס לתוקף באימון הבא של המטופל.' : 'Saved. In force from the patient’s next workout.');
    onSaved?.(r.data.limits);
  }

  return (
    <section className="bg-white rounded-xl shadow p-5 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">{'🛑'} {isHe ? 'מגבלות קליניות' : 'Clinical limits'}</h2>
      <div className="space-y-2">
        <div className="text-sm font-semibold text-gray-700">{isHe ? 'טווח מקסימלי למפרק (מעלות) או חסימה מלאה' : 'Max range per joint (degrees) or a full block'}</div>
        <div className="grid sm:grid-cols-2 gap-2">
          {JOINTS.flatMap(j => SIDES.map(side => {
            const key = `${side}_${j}`;
            const isBlocked = blockedJoints.has(key);
            return (
              <div key={key} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                <label htmlFor={`lim-${key}`} className="flex-1 text-sm text-gray-800">{jointName(side, j)}</label>
                <input id={`lim-${key}`} type="number" min="5" max="180" inputMode="numeric" disabled={isBlocked}
                  value={rom[key] ?? ''} onChange={e => setRom({ ...rom, [key]: e.target.value })}
                  placeholder={isHe ? 'ללא' : 'none'} className="w-20 px-2 py-1 border rounded text-center tabular-nums disabled:opacity-40" />
                <span className="text-xs text-gray-500">°</span>
                <label className="flex items-center gap-1 text-xs text-rose-700">
                  <input type="checkbox" checked={isBlocked} onChange={() => toggle(blockedJoints, setBlockedJoints, key)} />
                  {isHe ? 'חסום' : 'block'}
                </label>
              </div>
            );
          }))}
        </div>
        <p className="text-xs text-gray-500">{isHe ? 'ברך / ירך / מרפק = כפיפה, כתף = הרמה. חציית הטווח באימון → התראה מיידית; 3 חציות בסט → האימון נעצר וננעל עד שתאשר.' : 'Knee / hip / elbow = flexion, shoulder = elevation. Crossing → an immediate alert; 3 in a set → the workout stops and locks until you approve.'}</p>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-semibold text-gray-700">{isHe ? 'תנועות אסורות' : 'Forbidden movements'}</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PATTERNS).map(([id, p]) => (
            <button key={id} type="button" onClick={() => toggle(blocked, setBlocked, id)}
              className={`text-xs rounded-full px-2.5 py-1 border ${blocked.has(id) ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-700 border-gray-300'}`}>
              {blocked.has(id) ? '⛔ ' : ''}{isHe ? p.name.he : p.name.en}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{isHe ? 'תרגיל אסור מוחלף בגרסה הקלה הקרובה שמותרת, ואם אין — יוצא מהאימון.' : 'A forbidden exercise is replaced by the nearest allowed easier version, else removed.'}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="lim-until" className="block text-sm text-gray-700">{isHe ? 'בתוקף עד (לא חובה)' : 'Valid until (optional)'}</label>
          <input id="lim-until" type="date" value={until} onChange={e => setUntil(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
        </div>
        <div>
          <label htmlFor="lim-note" className="block text-sm text-gray-700">{isHe ? 'הערה למטופל (לא חובה)' : 'A note (optional)'}</label>
          <input id="lim-note" value={note} onChange={e => setNote(e.target.value)} maxLength={300} className="w-full px-3 py-2 border rounded-lg" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={busy} onClick={save} className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50">{isHe ? 'שמירת המגבלות' : 'Save the limits'}</button>
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
      </div>
      {limits?.updatedAt && <div className="text-xs text-gray-500">{isHe ? 'עודכן' : 'Updated'} {new Date(limits.updatedAt).toLocaleString(isHe ? 'he-IL' : 'en-GB')}{limits.byName ? ` · ${limits.byName}` : ''}</div>}
    </section>
  );
}
