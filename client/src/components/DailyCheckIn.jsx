// DailyCheckIn — today's reality before the workout: where, ball, prosthesis or crutches.
// Prefilled with the last answers (one tap to confirm). The workout is rebuilt from these answers.

import { useState } from 'react';
import { CHECKIN_LOCATIONS, CHECKIN_MOBILITY, checkInQuestions, checkInDefaults, checkInComplete } from '../engine/training/dailyCheckIn';

function Choice({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 min-w-[45%] py-2.5 px-2 rounded-xl border-2 text-sm font-semibold transition ${
        active ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
      {children}
    </button>
  );
}

export default function DailyCheckIn({ profile, isHe, onDone }) {
  const q = checkInQuestions(profile);
  const [status, setStatus] = useState(() => checkInDefaults(profile));
  const set = (k, v) => setStatus(s => ({ ...s, [k]: v }));
  const ready = checkInComplete(profile, status);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 space-y-4" dir={isHe ? 'rtl' : 'ltr'}>
      <div>
        <div className="text-lg font-bold text-gray-800">{'📋'} {isHe ? 'צ\'ק-אין להיום' : "Today's check-in"}</div>
        <div className="text-xs text-gray-500">{isHe ? 'האימון של היום נבנה בדיוק לפי התשובות האלה' : "Today's workout is built exactly from these answers"}</div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-gray-700">{isHe ? 'איפה מתאמנים היום?' : 'Where are you training today?'}</div>
        <div className="flex flex-wrap gap-2">
          {CHECKIN_LOCATIONS.map(l => (
            <Choice key={l.id} active={status.location === l.id} onClick={() => set('location', l.id)}>
              {l.icon} {isHe ? l.label.he : l.label.en}
            </Choice>
          ))}
        </div>
      </div>

      {q.ball && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-700">{'⚽'} {isHe ? 'יש כדור זמין היום?' : 'Is a ball available today?'}</div>
          <div className="flex gap-2">
            <Choice active={status.hasBall === true} onClick={() => set('hasBall', true)}>{isHe ? 'כן' : 'Yes'}</Choice>
            <Choice active={status.hasBall === false} onClick={() => set('hasBall', false)}>{isHe ? 'לא' : 'No'}</Choice>
          </div>
        </div>
      )}

      {q.mobility && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-700">{isHe ? 'איך אתה מתאמן היום?' : 'How are you training today?'}</div>
          <div className="flex flex-wrap gap-2">
            {CHECKIN_MOBILITY.map(m => (
              <Choice key={m.id} active={status.mobility === m.id} onClick={() => set('mobility', m.id)}>
                {m.icon} {isHe ? m.label.he : m.label.en}
              </Choice>
            ))}
          </div>
          {status.mobility === 'crutches' && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              {isHe ? 'על קביים: עבודה רק על הרגל המתפקדת ובתמיכת הקביים — בלי עמידה או החלפה לצד השני.'
                : 'On crutches: work only on the working leg, crutch-supported — no standing on or switching to the other side.'}
            </div>
          )}
        </div>
      )}

      <button type="button" disabled={!ready} onClick={() => onDone?.(status)}
        className="w-full py-3 rounded-xl bg-green-600 text-white font-bold text-lg disabled:opacity-40 hover:bg-green-700 transition">
        {isHe ? 'יאללה, בונים את האימון של היום' : "Let's build today's workout"}
      </button>
    </div>
  );
}
