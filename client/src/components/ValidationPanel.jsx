// ValidationPanel — label the reps of the last set "good / fault" (validation mode, Stage 3.1)
// Shown after a set (rest / exercise done). Each clip shows what the SYSTEM said; the person
// says what really happened. A fault can name the rule(s) it was. Saved together on "Done"
// (re-clicking a rep changes its label, it never creates a duplicate).

import { useState } from 'react';
import { getProfileById } from '../engine/exercise/exerciseProfiles';

export default function ValidationPanel({ clips, profile, isHe, onDone }) {
  const [labels, setLabels] = useState({});          // clip id → { label, faults }
  const [openFault, setOpenFault] = useState(null);  // clip id whose fault chips are open
  if (!clips?.length) return null;
  const prof = profile || getProfileById(clips[0].profileId);
  const rules = [...(prof?.rules || []), ...(prof?.dynamics || [])];
  const ruleName = (id) => {
    const r = rules.find(x => x.id === id);
    return r ? (isHe ? r.msg.he : r.msg.en) : id;
  };
  const kindWord = (c) => (c.kind === 'strike' ? (isHe ? 'בעיטה' : 'Kick') : c.kind === 'reps' ? (isHe ? 'חזרה' : 'Rep') : (isHe ? 'קטע' : 'Clip'));

  const save = (clip, label, faults = []) => setLabels(l => ({ ...l, [clip.id]: { label, faults } }));
  const toggleFault = (clip, id) => {
    const cur = labels[clip.id]?.faults || [];
    save(clip, 'fault', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  };
  const done = Object.keys(labels).length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] overflow-y-auto bg-slate-900/95 text-white rounded-t-2xl shadow-2xl p-4 space-y-3" dir={isHe ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <div className="font-bold">{'🧪'} {isHe ? 'מאגר אימות — סמן כל חזרה' : 'Validation — label each rep'}</div>
        <button onClick={() => onDone?.(clips.filter(c => labels[c.id]).map(c => ({ clip: c, ...labels[c.id] })))} className="text-sm px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25">
          {isHe ? `סיום (${done}/${clips.length})` : `Done (${done}/${clips.length})`}
        </button>
      </div>
      {clips.map((c, k) => {
        const l = labels[c.id];
        return (
          <div key={c.id} className="rounded-xl bg-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{kindWord(c)} {k + 1}</span>
              <span className={c.verdict.issues.length ? 'text-amber-300' : 'text-green-300'}>
                {isHe ? 'המערכת: ' : 'System: '}
                {c.verdict.issues.length ? c.verdict.issues.map(ruleName).join(' · ') : (isHe ? '✅ תקין' : '✅ clean')}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { save(c, 'good'); setOpenFault(null); }}
                className={`flex-1 py-2 rounded-lg text-sm font-bold ${l?.label === 'good' ? 'bg-green-600' : 'bg-white/15 hover:bg-white/25'}`}>
                {'👍'} {isHe ? 'טוב' : 'Good'}
              </button>
              <button onClick={() => { save(c, 'fault', l?.faults || []); setOpenFault(c.id); }}
                className={`flex-1 py-2 rounded-lg text-sm font-bold ${l?.label === 'fault' ? 'bg-red-600' : 'bg-white/15 hover:bg-white/25'}`}>
                {'👎'} {isHe ? 'טעות' : 'Fault'}
              </button>
            </div>
            {openFault === c.id && rules.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs opacity-80 w-full">{isHe ? 'איזו טעות? (לא חובה)' : 'Which fault? (optional)'}</span>
                {rules.map(r => (
                  <button key={r.id} onClick={() => toggleFault(c, r.id)}
                    className={`text-xs px-2 py-1 rounded-full ${l?.faults?.includes(r.id) ? 'bg-red-500' : 'bg-white/15'}`}>
                    {isHe ? r.msg.he : r.msg.en}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
