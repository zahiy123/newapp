// The clinician's patient page (Stage 4B step 3): the profile essentials, the red flags, the SAME progress view
// the trainee sees (exercises, range of motion by the owner's rule, pain, every workout's report), and the coach
// notebook. The data comes from the server only (an active assignment, audited).
import { useEffect, useState } from 'react';
import { clinic, clinicError } from '../../utils/clinicApi';
import { ProgressView } from '../../pages/Progress';
import FlagChips from './FlagChips';

const fmt = (ms, isHe) => (ms ? new Date(ms).toLocaleDateString(isHe ? 'he-IL' : 'en-GB') : '');
const TRACK_HE = { rehab_only: 'שיקום', rehab_sport: 'שיקום + ענף', sport_only: 'ענף' };

export default function PatientView({ traineeId, isHe, onBack }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
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
