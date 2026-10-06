// ValidationReport — how well does the coach agree with people? (Stage 3.1 validation dataset)
// Per exercise profile: labelled reps, agreement %, false alarms (flagged a good rep), misses
// (a labelled fault the coach did not flag), per rule — and a data-driven threshold check that
// replays every stored rep with candidate thresholds (agreement.tuneRule).

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { loadLabelledClips } from '../services/validationStore';
import { agreementReport, tuneRule, candidatesAround } from '../engine/validation/agreement';
import { getProfileById, personalizeProfile } from '../engine/exercise/exerciseProfiles';
import { applySportContext } from '../engine/sports/sportLibrary';
import { getLimbProfile } from '../engine/limbProfile';

export default function ValidationReport() {
  const { user, userProfile } = useAuth();
  const { lang } = useLanguage();
  const isHe = (lang || 'he').startsWith('he');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [tuning, setTuning] = useState({});        // `${group}:${ruleId}` → ranked candidates | 'busy'
  const lp = useMemo(() => getLimbProfile(userProfile), [userProfile]);

  useEffect(() => {
    if (!user?.uid) return;
    loadLabelledClips(user.uid).then(setItems).catch((e) => { console.error(e); setError(String(e?.message || e)); });
  }, [user?.uid]);

  // Group by exercise profile + sport contexts (the rules differ per context)
  const groups = useMemo(() => {
    const g = new Map();
    for (const it of items || []) {
      const key = `${it.clip.profileId}|${(it.clip.sportContexts || []).join('+')}`;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(it);
    }
    return [...g.entries()].map(([key, list]) => {
      const [profileId, ctx] = key.split('|');
      const base = getProfileById(profileId);
      const profile = base && applySportContext(personalizeProfile(base, lp), ctx ? ctx.split('+') : ['fitness']);
      return { key, profile, ctx, list, report: agreementReport(list) };
    });
  }, [items, lp]);

  const runTune = (group, rule) => {
    const k = `${group.key}:${rule.id}`;
    setTuning(t => ({ ...t, [k]: 'busy' }));
    setTimeout(() => {
      const ranked = tuneRule(group.profile, rule.id, candidatesAround(rule.value), group.list, lp);
      setTuning(t => ({ ...t, [k]: ranked }));
    }, 30);
  };

  const ruleName = (profile, id) => {
    const r = [...(profile?.rules || []), ...(profile?.dynamics || [])].find(x => x.id === id);
    return r ? (isHe ? r.msg.he : r.msg.en) : id;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4" dir={isHe ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold">{'🧪'} {isHe ? 'מאגר אימות — דיוק המאמן' : 'Validation — coach accuracy'}</h1>
      <p className="text-sm text-gray-600">
        {isHe
          ? 'כל חזרה שסומנה "טוב / טעות" משמשת לבדוק את המאמן מול שיפוט אנושי. התרעת שווא = המאמן תיקן חזרה טובה (הכי פוגע באמון). החמצה = טעות שהמאמן לא זיהה. להקלטה: פתח אימון עם ‎?validate=1‎ בכתובת.'
          : 'Every rep labelled "good / fault" checks the coach against human judgement. False alarm = the coach corrected a good rep (worst for trust). Miss = a fault the coach did not flag. To record: open a workout with ?validate=1 in the URL.'}
      </p>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {items === null && !error && <div className="text-gray-500">{isHe ? 'טוען…' : 'Loading…'}</div>}
      {items && items.length === 0 && <div className="text-gray-500">{isHe ? 'עוד אין חזרות מסומנות.' : 'No labelled reps yet.'}</div>}

      {groups.map((g) => (
        <div key={g.key} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-bold text-lg">{g.profile ? (isHe ? g.profile.name.he : g.profile.name.en) : g.key}</div>
            <div className="text-xs text-gray-500">{g.ctx}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label={isHe ? 'חזרות מסומנות' : 'Labelled'} value={g.report.n} />
            <Stat label={isHe ? 'הסכמה' : 'Agreement'} value={g.report.agreementPct === null ? '—' : `${g.report.agreementPct}%`} />
            <Stat label={isHe ? 'התרעות שווא' : 'False alarms'} value={g.report.falseAlarms} warn={g.report.falseAlarms > 0} />
            <Stat label={isHe ? 'החמצות' : 'Misses'} value={g.report.misses} warn={g.report.misses > 0} />
          </div>
          {g.profile && [...g.profile.rules, ...g.profile.dynamics].map((rule) => {
            const pr = g.report.perRule[rule.id];
            const k = `${g.key}:${rule.id}`;
            const tuned = tuning[k];
            return (
              <div key={rule.id} className="text-sm border-t border-gray-100 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{ruleName(g.profile, rule.id)} <span className="text-gray-400">({rule.feature || rule.metric} {rule.op} {rule.value})</span></span>
                  <span className="text-gray-600">
                    {pr ? `${isHe ? 'סימן' : 'flagged'} ${pr.flagged} · ${isHe ? 'על טובות' : 'on good'} ${pr.flaggedOnGood} · ${isHe ? 'הוחמץ' : 'missed'} ${pr.missed}` : (isHe ? 'לא הופעל' : 'never fired')}
                  </span>
                  <button onClick={() => runTune(g, rule)} disabled={tuned === 'busy' || g.report.n < 4}
                    className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-xs disabled:opacity-40">
                    {tuned === 'busy' ? (isHe ? 'מחשב…' : 'Computing…') : (isHe ? 'בדוק ספים' : 'Check thresholds')}
                  </button>
                </div>
                {Array.isArray(tuned) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tuned.slice(0, 4).map((c, i) => (
                      <span key={c.value} className={`text-xs px-2 py-0.5 rounded-full ${i === 0 ? 'bg-green-100 text-green-800 font-bold' : 'bg-gray-100 text-gray-700'}`}>
                        {c.value}: {c.agreementPct}% · {isHe ? 'שווא' : 'FA'} {c.falseAlarms} · {isHe ? 'החמצה' : 'miss'} {c.misses}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {g.report.n < 4 && <div className="text-xs text-gray-500">{isHe ? 'צריך לפחות 4 חזרות מסומנות כדי לבדוק ספים.' : 'At least 4 labelled reps are needed to check thresholds.'}</div>}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, warn = false }) {
  return (
    <div className={`rounded-xl p-2 ${warn ? 'bg-amber-50 text-amber-800' : 'bg-gray-50'}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
