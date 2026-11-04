// THE PROGRESS SCREEN (Stage 4, built 2026-11-03): per exercise the accuracy across workouts and every problem
// (fixed / still there), the range of motion against the owner's reference rule, the pain history, and every
// workout's report. Reads users/{uid}/workouts (dataVersion 2 = the detailed data, saved from 2026-11-03).
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { db } from '../services/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { exerciseTrends, painHistory } from '../engine/progress/progress';
import { romProgress, ROM_JOINTS, REFERENCE_AFTER } from '../engine/progress/rom';
import { painLight, zoneName } from '../engine/training/painTrafficLight';
import WorkoutReport from '../components/progress/WorkoutReport';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

// (a workout from Firestore has a Timestamp; from the clinician's server a plain number)
const atOf = (w) => Number(w?.at) || (w?.date?.toMillis ? w.date.toMillis() : Number(w?.date) || 0);
const fmtDate = (ms, isHe) => (ms ? new Date(ms).toLocaleDateString(isHe ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric' }) : '');

function Spark({ points, isHe, unit = '%', min = 0, max = 100, refLine = null }) {
  const data = {
    labels: points.map(p => fmtDate(p.at, isHe)),
    datasets: [
      { data: points.map(p => p.value), borderColor: '#1E7A4C', backgroundColor: 'rgba(30,122,76,0.12)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#1E7A4C' },
      ...(refLine != null ? [{ data: points.map(() => refLine), borderColor: '#B9791A', borderDash: [5, 4], pointRadius: 0, fill: false }] : []),
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y}${unit}` } } },
    scales: { y: { min, max, ticks: { stepSize: (max - min) / 4 } }, x: { ticks: { maxTicksLimit: 6 } } },
  };
  return <div style={{ height: 120 }}><Line data={data} options={options} /></div>;
}

export default function Progress() {
  const { user, userProfile } = useAuth();
  const { lang } = useLanguage();
  const isHe = (lang || userProfile?.language || 'he') === 'he';
  const [workouts, setWorkouts] = useState(null);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, 'users', user.uid, 'workouts'), orderBy('date', 'desc'), limit(60)))
      .then(snap => setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(err => { console.error('[Progress] load failed:', err); setWorkouts([]); });
  }, [user]);

  if (workouts === null) return <div className="text-center py-16 text-gray-500">{isHe ? 'טוען…' : 'Loading…'}</div>;
  return <ProgressView workouts={workouts} scanData={userProfile?.scanData} isHe={isHe} />;
}

/** The progress view itself — the trainee's own page, and the clinician's patient page (Stage 4B) reuse it. */
export function ProgressView({ workouts, scanData, isHe, forClinician = false }) {
  const [open, setOpen] = useState(null);
  const oldestFirst = useMemo(() => [...(workouts || [])].sort((a, b) => atOf(a) - atOf(b)), [workouts]);
  const trends = useMemo(() => exerciseTrends(oldestFirst), [oldestFirst]);
  const rom = useMemo(() => romProgress(scanData, oldestFirst.filter(w => w.rom && Object.keys(w.rom).length).map(w => ({ at: atOf(w), rom: w.rom }))), [scanData, oldestFirst]);
  const pains = useMemo(() => painHistory(workouts || []), [workouts]);
  const detailedCount = (workouts || []).filter(w => w.dataVersion >= 2).length;

  const sideName = (key) => {
    const [side, j] = key.split('_');
    const d = ROM_JOINTS[j];
    return isHe ? `${d.he} ${side === 'left' ? 'שמאל' : 'ימין'}` : `${side === 'left' ? 'Left' : 'Right'} ${d.en.toLowerCase()}`;
  };

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-6" dir={isHe ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">{'📈'} {forClinician ? (isHe ? 'התקדמות' : 'Progress') : (isHe ? 'ההתקדמות שלי' : 'My progress')}</h1>
        <p className="text-sm text-gray-500">
          {isHe ? 'כל מספר כאן נמדד באימונים שלך — ומושווה רק אליך.' : 'Every number here was measured in your workouts — compared only with you.'}
        </p>
      </div>

      {detailedCount < 2 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          {isHe
            ? `הנתונים המפורטים נשמרים מהיום (${detailedCount} אימונים עד עכשיו). אחרי 2–3 אימונים יופיעו כאן המגמות.`
            : `The detailed data is saved from today (${detailedCount} workouts so far). Trends appear after 2–3 workouts.`}
        </div>
      )}

      {(() => {
        const last = [...oldestFirst].reverse().find(w => w.dataVersion >= 2);
        const step = Number(last?.loadStep) || 0;
        return last ? (
          <div className="rounded-xl bg-white shadow px-4 py-3 text-sm text-gray-800">
            {'📈'} {isHe ? 'רמת מורכבות התרגילים: ' : 'Exercise complexity: '}<span className="font-bold tabular-nums">{step > 0 ? (isHe ? `שלב ${step}` : `level ${step}`) : step < 0 ? (isHe ? `שלב ${step} (גרסאות קלות יותר)` : `level ${step} (easier versions)`) : (isHe ? 'בסיס' : 'base')}</span>
            <span className="text-gray-500"> · {isHe ? 'עולה שלב אחרי 2 אימונים ברצף בקלות ובדיוק מלא (90%+, בלי כאב); יורד שלב אחרי 2 אימונים ברצף שהיו קשים מדי (מתחת ל-65%) — תמיד שלב אחד בכל פעם' : 'one step up after 2 easy, fully accurate workouts in a row (90%+, no pain); one step down after 2 workouts in a row that were too hard (under 65%) — always one step at a time'}</span>
            {(last.exercises || []).some(e => e.easedFrom) && (
              <div className="mt-1 text-slate-700">
                {(last.exercises || []).filter(e => e.easedFrom).map((e, i) => (
                  <div key={i}>{'📉'} {isHe ? 'הורדת רמת מורכבות התרגיל: ' : 'Complexity down: '}{e.easedFrom.name !== e.name ? `${e.easedFrom.name} ← ${e.name}` : e.name}</div>
                ))}
              </div>
            )}
            {(last.exercises || []).some(e => e.upgradedFrom) && (
              <div className="mt-1 text-emerald-800">
                {(last.exercises || []).filter(e => e.upgradedFrom).map((e, i) => (
                  <div key={i}>{'📈'} {isHe ? 'העלאת רמת מורכבות התרגיל: ' : 'Complexity up: '}{e.upgradedFrom.name !== e.name ? `${e.upgradedFrom.name} ← ${e.name}` : e.name}</div>
                ))}
              </div>
            )}
          </div>
        ) : null;
      })()}

      {/* 1. Per exercise */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-gray-800">{isHe ? 'תרגילים' : 'Exercises'}</h2>
        {!trends.length && <div className="text-sm text-gray-500">{isHe ? 'עוד אין תרגילים עם נתונים מפורטים.' : 'No exercises with detailed data yet.'}</div>}
        {trends.map(t => {
          const recurring = t.problems.filter(p => p.status === 'recurring');
          const fixed = t.problems.filter(p => p.status === 'fixed');
          const delta = t.firstAccuracy != null && t.lastAccuracy != null && t.workouts >= 2 ? t.lastAccuracy - t.firstAccuracy : null;
          return (
            <div key={t.key} className="bg-white rounded-xl shadow p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-500 tabular-nums">{isHe ? `${t.workouts} אימונים` : `${t.workouts} workouts`}</div>
                </div>
                {t.lastAccuracy != null && (
                  <div className="text-end">
                    <div className="text-2xl font-extrabold tabular-nums text-gray-900">{t.lastAccuracy}%</div>
                    {delta != null && delta !== 0 && (
                      <div className={`text-xs font-semibold tabular-nums ${delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}% {isHe ? 'מהאימון הראשון' : 'since the first'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {t.series.filter(s => s.accuracy != null).length >= 2 && (
                <Spark points={t.series.filter(s => s.accuracy != null).map(s => ({ at: s.at, value: s.accuracy }))} isHe={isHe} />
              )}
              {recurring.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">{isHe ? 'עוד חוזר — המיקוד' : 'Still there — the focus'}</div>
                  {recurring.slice(0, 3).map(p => (
                    <div key={p.key} className="text-sm text-gray-800 flex gap-2">
                      <span>{'🎯'}</span><span className="flex-1">{p.what}</span>
                      <span className="text-xs text-gray-500 tabular-nums">{isHe ? `ב-${p.count} אימונים` : `in ${p.count} workouts`}</span>
                    </div>
                  ))}
                </div>
              )}
              {fixed.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-emerald-700">{isHe ? 'תוקן' : 'Fixed'}</div>
                  {fixed.slice(0, 4).map(p => (
                    <div key={p.key} className="text-sm text-emerald-900 flex gap-2">
                      <span>{'✅'}</span><span className="flex-1">{p.what}</span>
                      <span className="text-xs text-emerald-700 tabular-nums">{isHe ? `לא חזר ב-${p.workoutsSinceLast} אימונים` : `not back in ${p.workoutsSinceLast} workouts`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* 2. Range of motion — the owner's reference rule */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-gray-800">{isHe ? 'טווחי תנועה' : 'Range of motion'}</h2>
        <p className="text-xs text-gray-500">
          {isHe
            ? `ההשוואה היא לסריקה הראשונית. נקודת הייחוס מתעדכנת רק אחרי ${REFERENCE_AFTER} אימונים — או מוקדם יותר כשהטווח בסריקה היה נמוך במיוחד והייתה קפיצה גדולה ב-2 אימונים. ברך וירך לא נמדדו במעלות בסריקה — שם נקודת ההתחלה היא האימון הראשון.`
            : `Compared with the initial scan. The reference moves only after ${REFERENCE_AFTER} workouts — or earlier when the scan's range was especially low and a big jump showed in 2 workouts. The knee and hip were not measured in degrees in the scan — they start from the first workout.`}
        </p>
        {!Object.keys(rom).length && <div className="text-sm text-gray-500">{isHe ? 'עוד אין מדידות טווח תנועה.' : 'No range-of-motion measurements yet.'}</div>}
        <div className="grid sm:grid-cols-2 gap-3">
          {Object.entries(rom).sort(([a], [b]) => a.localeCompare(b)).map(([key, r]) => {
            const change = r.latest != null ? r.latest - r.initial : null;
            return (
              <div key={key} className="bg-white rounded-xl shadow p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="font-bold text-gray-900">{sideName(key)}</div>
                  {r.latest != null && <div className="text-xl font-extrabold tabular-nums">{r.latest}°</div>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-gray-50 rounded-lg py-1.5">
                    <div className="font-bold tabular-nums text-gray-900">{r.initial}°</div>
                    <div className="text-gray-500">{r.initialSource === 'scan' ? (isHe ? 'בסריקה' : 'scan') : (isHe ? 'אימון ראשון' : 'first workout')}</div>
                  </div>
                  <div className="bg-amber-50 rounded-lg py-1.5">
                    <div className="font-bold tabular-nums text-amber-900">{r.reference}°</div>
                    <div className="text-amber-800">{isHe ? 'נקודת ייחוס' : 'reference'}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg py-1.5">
                    <div className="font-bold tabular-nums text-emerald-900">{r.best}°</div>
                    <div className="text-emerald-800">{isHe ? 'הכי גבוה' : 'best'}</div>
                  </div>
                </div>
                {change != null && change !== 0 && (
                  <div className={`text-xs font-semibold ${change > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {change > 0 ? '↑' : '↓'} {Math.abs(change)}° {r.initialSource === 'scan' ? (isHe ? 'מהסריקה הראשונית' : 'since the initial scan') : (isHe ? 'מהאימון הראשון' : 'since the first workout')}
                  </div>
                )}
                {r.stages.length > 0 && (
                  <div className="text-xs text-amber-800">
                    {r.stages.map((s, i) => (
                      <div key={i}>{isHe
                        ? `נקודת הייחוס עודכנה ל-${s.value}° אחרי אימון ${s.afterWorkout} (${s.reason === 'early_jump' ? 'קפיצה משמעותית מטווח נמוך' : `${REFERENCE_AFTER} אימונים`})`
                        : `Reference moved to ${s.value}° after workout ${s.afterWorkout} (${s.reason === 'early_jump' ? 'a big jump from a low start' : `${REFERENCE_AFTER} workouts`})`}</div>
                    ))}
                  </div>
                )}
                {r.series.length >= 2 && <Spark points={r.series} isHe={isHe} unit="°" min={0} max={Math.max(r.norm, r.best + 10)} refLine={r.reference} />}
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Pain history */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-gray-800">{isHe ? 'היסטוריית כאב' : 'Pain history'}</h2>
        {!pains.length && <div className="text-sm text-gray-500">{isHe ? 'לא דווח כאב.' : 'No pain reported.'}</div>}
        {pains.length > 0 && (
          <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
            {pains.slice(0, 20).map((p, i) => {
              const l = painLight(p.level);
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="text-xs text-gray-500 tabular-nums w-12">{fmtDate(p.at, isHe)}</span>
                  <span className={`${l === 'green' ? 'bg-emerald-600' : l === 'yellow' ? 'bg-amber-500' : 'bg-red-600'} text-white rounded-md px-1.5 text-xs font-bold tabular-nums`}>{p.level}</span>
                  <span className="text-gray-900">{zoneName(p.zone, isHe)}</span>
                  <span className="text-gray-500 text-xs flex-1 truncate">{p.exercise === 'opening' ? (isHe ? 'בפתיחת האימון' : 'at the start') : p.exercise === 'warm-up' ? (isHe ? 'בחימום' : 'warm-up') : p.exercise}</span>
                  {p.choice === 'safe_mode' && <span className="text-sky-700 text-xs font-semibold">{'🛡️'}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Every workout's report */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-gray-800">{isHe ? 'האימונים שלי' : 'My workouts'}</h2>
        {!workouts.length && <div className="text-sm text-gray-500">{isHe ? 'עוד אין אימונים.' : 'No workouts yet.'}</div>}
        <div className="space-y-2">
          {workouts.slice(0, 30).map(w => (
            <div key={w.id} className="bg-white rounded-xl shadow">
              <button onClick={() => setOpen(open === w.id ? null : w.id)} className="w-full flex items-center justify-between px-4 py-3 text-start">
                <span className="font-semibold text-gray-900">{fmtDate(atOf(w), isHe)} · {(w.exercises || []).length} {isHe ? 'תרגילים' : 'exercises'}</span>
                <span className="text-xs text-gray-500">{w.dataVersion >= 2 ? (isHe ? 'דוח מלא' : 'full report') : ''} {open === w.id ? '▲' : '▼'}</span>
              </button>
              {open === w.id && <div className="px-3 pb-3"><WorkoutReport workout={w} isHe={isHe} /></div>}
            </div>
          ))}
        </div>
      </section>

      {!forClinician && <Link to="/" className="block text-center text-sm text-gray-500 underline">{isHe ? 'חזרה' : 'Back'}</Link>}
    </div>
  );
}
