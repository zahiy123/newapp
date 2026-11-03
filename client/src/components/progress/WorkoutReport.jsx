// The workout report (Stage 4 #1): per exercise — the accuracy of every set, the problems, what was fixed, pain.
// Used at the end of a workout (WorkoutSummary) and for any past workout (the progress page).
import { workoutReport } from '../../engine/progress/progress';
import { painLight, zoneName } from '../../engine/training/painTrafficLight';

const accColor = (a) => (a == null ? 'bg-gray-300' : a >= 85 ? 'bg-emerald-500' : a >= 70 ? 'bg-amber-500' : 'bg-rose-500');
const lightColor = (l) => (l === 'green' ? 'bg-emerald-600' : l === 'yellow' ? 'bg-amber-500' : 'bg-red-600');


export default function WorkoutReport({ workout, isHe }) {
  const r = workoutReport(workout);
  if (!r.exercises.length) return null;
  return (
    <div className="space-y-3" dir={isHe ? 'rtl' : 'ltr'}>
      {!r.detailed && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          {isHe ? 'אימון מלפני שמירת הנתונים המפורטים — מוצגים רק חזרות וסטים.' : 'A workout from before the detailed data — reps and sets only.'}
        </div>
      )}
      {r.exercises.map((e, i) => (
        <div key={`${e.key}-${i}`} className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900">{e.name}</div>
              <div className="text-xs text-gray-500 tabular-nums">
                {e.reps ?? '–'}/{e.repsTarget ?? '–'} {isHe ? 'חזרות' : 'reps'} · {e.setsDone ?? '–'}/{e.setsTarget ?? '–'} {isHe ? 'סטים' : 'sets'}
                {e.safeMode && <span className="ms-2 text-sky-700 font-semibold">{'🛡️'} {isHe ? 'מצב בטוח' : 'safe mode'}</span>}
                {e.lighter && !e.safeMode && <span className="ms-2 text-amber-700 font-semibold">{'🚦'} {isHe ? 'עומס מופחת' : 'lighter'}</span>}
              </div>
            </div>
            {e.accuracy != null && (
              <div className="text-end shrink-0">
                <div className="text-xl font-extrabold text-gray-900 tabular-nums">{e.accuracy}%</div>
                <div className="text-[11px] text-gray-500">{isHe ? 'דיוק' : 'accuracy'}</div>
              </div>
            )}
          </div>
          {e.setAccuracy.length > 0 && (
            <div className="flex items-end gap-1.5 h-12" aria-label={isHe ? 'דיוק לפי סט' : 'accuracy per set'}>
              {e.setAccuracy.map((a, k) => (
                <div key={k} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className={`w-full rounded-t ${accColor(a)}`} style={{ height: `${Math.max(8, a)}%` }} />
                  <div className="text-[10px] text-gray-500 tabular-nums">{isHe ? `סט ${k + 1}` : `Set ${k + 1}`} · {a}%</div>
                </div>
              ))}
            </div>
          )}
          {e.trend != null && e.trend !== 0 && (
            <div className={`text-xs font-semibold ${e.trend > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {e.trend > 0 ? '↑' : '↓'} {isHe ? `${Math.abs(e.trend)}% מהסט הראשון לאחרון` : `${Math.abs(e.trend)}% from the first set to the last`}
            </div>
          )}
          {e.problems.length > 0 && (
            <div className="space-y-1">
              {e.problems.slice(0, 3).map(p => (
                <div key={p.key} className="text-sm text-gray-800 flex gap-2">
                  <span>{p.critical ? '🔧' : '•'}</span>
                  <span className="flex-1">{p.what}</span>
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">{isHe ? `${p.times} פעמים` : `${p.times}×`}</span>
                </div>
              ))}
            </div>
          )}
          {e.fixed.length > 0 && (
            <div className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-2.5 py-1.5">
              {'✅'} {isHe ? 'תוקן אחרי עצירה: ' : 'Fixed after a stop: '}{e.fixed.map(f => f.what).join(' · ')}
            </div>
          )}
          {e.measured && !e.problems.length && !e.fixed.length && (
            <div className="text-sm text-emerald-800">{'✅'} {isHe ? 'בלי טעויות חוזרות' : 'No repeated errors'}</div>
          )}
        </div>
      ))}
      {((workout?.loadAdjustments || []).length > 0 || workout?.loadStep > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1 text-sm text-gray-800">
          <div className="text-sm font-semibold text-gray-700">{'⚖️'} {isHe ? 'התאמת עומס' : 'Load adaptation'}</div>
          {workout?.loadStep > 0 && <div>{'📈'} {isHe ? `רמת עומס: +${workout.loadStep * 10}% (בזכות אימונים ברצף בקלות ובדיוק)` : `Load level: +${workout.loadStep * 10}% (earned by easy, accurate workouts in a row)`}</div>}
          {(workout?.loadAdjustments || []).map((a, i) => (
            <div key={i}>{'🔽'} {a.reason === 'quality_drop'
              ? (isHe ? `הדיוק ירד לאורך "${a.exercise}" (${(a.accuracy || []).join(' → ')}%) — התרגילים הבאים הוקלו` : `The accuracy fell across "${a.exercise}" (${(a.accuracy || []).join(' → ')}%) — the next exercises were lighter`)
              : (isHe ? 'התחלת עייף — מהתרגיל השני העומס הוקל' : 'You started tired — lighter from the second exercise')}</div>
          ))}
        </div>
      )}
      {r.pain.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5">
          <div className="text-sm font-semibold text-gray-700">{'🚦'} {isHe ? 'דיווחי כאב באימון' : 'Pain reports'}</div>
          {r.pain.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-gray-800">
              <span className={`${lightColor(painLight(p.level))} text-white rounded-md px-1.5 text-xs font-bold tabular-nums`}>{p.level}</span>
              <span>{zoneName(p.zone, isHe)}</span>
              <span className="text-gray-500 text-xs">{p.exercise === 'opening' ? (isHe ? 'בפתיחת האימון' : 'at the start') : p.exercise === 'warm-up' ? (isHe ? 'בחימום' : 'warm-up') : p.exercise}</span>
              {p.choice === 'safe_mode' && <span className="text-sky-700 text-xs font-semibold">{'🛡️'} {isHe ? 'מצב בטוח' : 'safe mode'}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
