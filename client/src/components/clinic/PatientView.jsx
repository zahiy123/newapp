// The clinician's patient page (Stage 4B step 3): the profile essentials, the red flags, the SAME progress view
// the trainee sees (exercises, range of motion by the owner's rule, pain, every workout's report), and the coach
// notebook. The data comes from the server only (an active assignment, audited).
import { useEffect, useState } from 'react';
import { clinic, clinicError } from '../../utils/clinicApi';
import { ProgressView } from '../../pages/Progress';
import FlagChips from './FlagChips';
import ClinicalLimitsEditor from './ClinicalLimitsEditor';
import { ROM_JOINTS } from '../../engine/progress/rom';

const fmt = (ms, isHe) => (ms ? new Date(ms).toLocaleDateString(isHe ? 'he-IL' : 'en-GB') : '');
const TRACK_HE = { rehab_only: 'שיקום', rehab_sport: 'שיקום + ענף', sport_only: 'ענף' };

export default function PatientView({ traineeId, isHe, onBack }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [unlockNote, setUnlockNote] = useState('');
  const jName = (key) => { const [s, j] = String(key || '').split('_'); return ROM_JOINTS[j] ? (isHe ? `${ROM_JOINTS[j].he} ${s === 'left' ? 'שמאל' : 'ימין'}` : `${s} ${ROM_JOINTS[j].en.toLowerCase()}`) : key; };
  async function approveContinue() {
    const r = await clinic('POST', `/patients/${encodeURIComponent(traineeId)}/unlock`, { note: unlockNote });
    setConfirmUnlock(false);
    if (r.ok) setD(prev => ({ ...prev, lock: { ...(prev.lock || {}), locked: false }, flags: prev.flags.filter(f => f.code !== 'locked') }));
    else setErr(clinicError(r.error, isHe));
  }
  useEffect(() => {
    clinic('GET', `/patients/${encodeURIComponent(traineeId)}`).then(r => (r.ok ? setD(r.data) : setErr(clinicError(r.error, isHe))));
  }, [traineeId, isHe]);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-teal-800 underline">{isHe ? '→ חזרה לרשימה' : '← Back to the list'}</button>
      {err && <div className="text-sm text-rose-700">{err}</div>}
      {!d && !err && <div className="text-gray-500 text-sm">{isHe ? 'טוען…' : 'Loading…'}</div>}
      {d && (
        <>
          <section className="bg-white rounded-xl shadow p-5 space-y-2">
            <h2 className="text-xl font-extrabold text-gray-900">{d.profile.name || (isHe ? 'ללא שם' : 'No name')}</h2>
            <div className="text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
              {d.profile.age != null && <span>{isHe ? 'גיל' : 'Age'} {d.profile.age}</span>}
              {d.profile.sport && <span>{d.profile.sport}</span>}
              {d.profile.trainingTrack && <span>{isHe ? (TRACK_HE[d.profile.trainingTrack] || d.profile.trainingTrack) : d.profile.trainingTrack}</span>}
              {d.profile.amputationSide && <span>{isHe ? `קטיעה ${d.profile.amputationSide === 'left' ? 'שמאל' : 'ימין'}${d.profile.amputationLevel === 'below_knee' ? ' מתחת לברך' : d.profile.amputationLevel === 'above_knee' ? ' מעל הברך' : ''}` : `${d.profile.amputationSide} ${d.profile.amputationLevel || ''} amputation`}</span>}
              {d.profile.mobilityAid && <span>{d.profile.mobilityAid}</span>}
            </div>
            <FlagChips flags={d.flags} isHe={isHe} />
          </section>

          {d.lock?.locked && (
            <section className="bg-red-50 border-2 border-red-600 rounded-xl p-5 space-y-3">
              <h2 className="text-lg font-extrabold text-red-800">{'🔒'} {isHe ? 'האימונים של המטופל נעולים' : 'The patient’s training is locked'}</h2>
              <p className="text-sm text-red-900">
                {isHe
                  ? `${d.lock.crossings || 3} חציות בסט של הגבול ל${jName(d.lock.joint)} (${d.lock.limit}°, נמדד ${d.lock.value}°)${d.lock.exercise ? ` בתרגיל ${d.lock.exercise}` : ''} · ${fmt(d.lock.at, isHe)}`
                  : `${d.lock.crossings || 3} crossings of the ${jName(d.lock.joint)} limit (${d.lock.limit}°, measured ${d.lock.value}°)${d.lock.exercise ? ` in ${d.lock.exercise}` : ''} · ${fmt(d.lock.at, isHe)}`}
              </p>
              {confirmUnlock ? (
                <div className="space-y-2">
                  <label htmlFor="unlock-note" className="block text-sm text-red-900">{isHe ? 'הערה (לא חובה)' : 'A note (optional)'}</label>
                  <input id="unlock-note" value={unlockNote} onChange={e => setUnlockNote(e.target.value)} maxLength={300} className="w-full px-3 py-2 border rounded-lg" />
                  <div className="flex gap-2">
                    <button onClick={approveContinue} className="px-4 py-2 rounded-lg bg-red-700 text-white font-bold">{isHe ? 'אני מאשר: המטופל כשיר להמשיך' : 'I approve: fit to continue'}</button>
                    <button onClick={() => setConfirmUnlock(false)} className="px-4 py-2 rounded-lg border">{isHe ? 'ביטול' : 'Cancel'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmUnlock(true)} className="px-4 py-2 rounded-lg bg-red-700 text-white font-bold">{isHe ? 'בדקתי — לאשר המשך' : 'I checked — approve continuing'}</button>
              )}
            </section>
          )}

          <ClinicalLimitsEditor traineeId={traineeId} limits={d.limits} isHe={isHe} onSaved={(limits) => setD(prev => ({ ...prev, limits }))} />

          {d.violations?.length > 0 && (
            <section className="bg-white rounded-xl shadow p-5 space-y-2">
              <h2 className="font-bold text-gray-900">{isHe ? 'חציות גבול שנעלו אימון' : 'Limit crossings that locked a workout'}</h2>
              {d.violations.map(v => (
                <div key={v.id} className="text-sm text-gray-800 border-t pt-2">
                  {fmt(v.at, isHe)} · {jName(v.joint)} {v.value}° / {v.limit}°{v.exercise ? ` · ${v.exercise}` : ''}
                </div>
              ))}
            </section>
          )}

          <ProgressView workouts={d.workouts} scanData={d.profile.scanData} isHe={isHe} forClinician />

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800">{'🗒️'} {isHe ? 'יומן המאמן' : 'The coach notebook'}</h2>
            {!d.notebook.length && <div className="text-sm text-gray-500">{isHe ? 'עוד אין רשומות.' : 'No entries yet.'}</div>}
            {d.notebook.map(n => (
              <div key={n.id} className="bg-white rounded-xl shadow p-4 space-y-1 text-sm text-gray-800">
                <div className="text-xs text-gray-500">{fmt(n.at || n.date, isHe)}</div>
                {n.summary && <p>{n.summary}</p>}
                {n.performance && <p>{'💪'} {n.performance}</p>}
                {n.pain && <p>{'🚦'} {n.pain}</p>}
                {n.focusNext && <p>{'🎯'} {isHe ? 'המיקוד הבא: ' : 'Next focus: '}{n.focusNext}</p>}
                {n.followUp && <p>{'❓'} {isHe ? 'לשאול: ' : 'Ask: '}{n.followUp}</p>}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
