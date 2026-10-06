// ExecutionHud — on-screen feedback of the Expert Execution Profile during an exercise (Stage 3.1)
//   • not positioned right → ONE precise instruction (step back / tilt the camera / move left /
//     turn side-on…); counting waits. Positioned right → a short green "now I can see you".
//   • the most important persisting error (amber) / DANGER (red, pulsing)
//   • the correction + WHY it matters (in the sport's terms)
//   • execution accuracy %, live cadence (running), the sport's top emphasis, the measuring view hint

import { accuracyLevel } from '../engine/movementAccuracy';
import { cameraViewHint } from '../engine/training/viewPrompts';

export default function ExecutionHud({ execution, isHe }) {
  if (!execution?.active) return null;
  const { profile, setup, readyFlash, issue, accuracy, cadence, unsure } = execution;
  // The most specific sport's first focus (rehab + sport → the sport's)
  const lastSport = profile.sportContexts?.[profile.sportContexts.length - 1];
  const emphasis = profile.sportEmphasis?.find(e => e.sport === lastSport);
  const level = accuracy !== null ? accuracyLevel(accuracy) : null;

  return (
    <>
      {setup && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[16] pointer-events-none bg-amber-500 text-white rounded-2xl px-4 py-3 text-base sm:text-lg font-bold shadow-lg text-center max-w-[92%]">
          {'📷'} {isHe ? setup.he : setup.en}
          <div className="text-xs font-medium opacity-90 mt-0.5">{isHe ? 'מתחילים ברגע שאראה אותך נכון' : "We start as soon as I see you right"}</div>
        </div>
      )}
      {!setup && readyFlash && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[16] pointer-events-none bg-green-600 text-white rounded-2xl px-4 py-3 text-base sm:text-lg font-bold shadow-lg text-center max-w-[92%]">
          {'✅'} {isHe ? readyFlash.he : readyFlash.en}
        </div>
      )}

      {/* Silence when unsure: no corrections — say what would make the measurement reliable */}
      {!setup && !readyFlash && !issue && unsure && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[16] pointer-events-none bg-sky-700/90 text-white rounded-2xl px-4 py-2 text-sm font-bold shadow-lg text-center max-w-[90%]">
          {'📐'} {unsure === 'view'
            ? cameraViewHint(profile.cameraView, isHe)
            : (isHe ? 'לא רואה אותך מספיק טוב — התקרב או הוסף אור' : "I can't see you clearly — move closer or add light")}
          <div className="text-xs font-medium opacity-90">{isHe ? 'ממשיכים ברגע שאראה אותך ברור' : 'We continue as soon as I see you clearly'}</div>
        </div>
      )}

      {!setup && issue && (
        <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-[16] pointer-events-none text-white rounded-2xl px-4 py-2 text-sm sm:text-base font-bold shadow-lg text-center max-w-[90%] ${
          issue.severity === 'danger' ? 'bg-red-600 animate-pulse' : 'bg-amber-500/95'}`}>
          {issue.severity === 'danger' ? '⛔' : '⚠️'} {isHe ? issue.msg.he : issue.msg.en}
          {issue.why && (
            <div className="text-xs font-medium opacity-90 mt-0.5">{isHe ? issue.why.he : issue.why.en}</div>
          )}
        </div>
      )}

      <div className="absolute left-3 top-[62%] z-[15] pointer-events-none flex flex-col items-start gap-1">
        {profile.precision === 'expert' && (
          <div className="rounded-full px-3 py-1 text-xs font-bold bg-black/55 text-white">
            {'🎯'} {isHe ? profile.name.he : profile.name.en}
            {accuracy !== null && (
              <span className={`mx-1 px-2 py-0.5 rounded-full ${
                level === 'good' ? 'bg-green-600' : level === 'mid' ? 'bg-yellow-500' : 'bg-red-600'}`}>
                {isHe ? `${accuracy}% דיוק` : `${accuracy}% accuracy`}
              </span>
            )}
          </div>
        )}
        {cadence !== null && (
          <div className="rounded-full px-3 py-1 text-xs font-bold bg-black/55 text-white">
            {'👟'} {isHe ? `${cadence} צעדים/דקה` : `${cadence} steps/min`}
          </div>
        )}
        {profile.precision === 'expert' && emphasis && (
          <div className="rounded-full px-3 py-1 text-[11px] font-semibold bg-indigo-700/80 text-white max-w-[70vw] truncate">
            {'🏅'} {isHe ? `דגש: ${emphasis.he}` : `Focus: ${emphasis.en}`}
          </div>
        )}
        {profile.precision === 'expert' && profile.cameraView === 'side' && !setup && unsure !== 'view' && (
          <div className="rounded-full px-3 py-1 text-[11px] font-semibold bg-sky-700/80 text-white">
            {'📐'} {cameraViewHint('side', isHe)}
          </div>
        )}
      </div>
    </>
  );
}
