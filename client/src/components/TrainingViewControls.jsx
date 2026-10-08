// TrainingViewControls — the Ghost and coach controls, in a strip OUTSIDE the camera view.
//
// Field test (2026-10-08): on a phone the camera view is 40% of the screen, and the small Ghost panel
// sat exactly over the old "Ghost: big" / 👻 buttons inside it — the trainee could neither see nor
// press them, so the big Ghost "never appeared". Here nothing can cover the controls.

import { COACH_IDS, COACH_INFO } from '../engine/coachAvatar';

function Seg({ active, onClick, children, tone = 'blue' }) {
  const on = tone === 'pink' ? 'bg-pink-600 text-white' : tone === 'purple' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white';
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${active ? on : 'bg-gray-800 text-white/70 hover:bg-gray-700'}`}>
      {children}
    </button>
  );
}

/**
 * @param {'off'|'small'|'big'} ghost
 * @param {'male'|'female'|'none'} coach
 */
export default function TrainingViewControls({ ghost, onGhost, coach, onCoach, isHe, bigAvailable = true, floating = false, status = null, onVoice = null }) {
  return (
    <div className={floating ? 'fixed inset-x-0 bottom-0 z-[45] pb-[env(safe-area-inset-bottom)]' : 'flex-shrink-0'}>
    <div className={`bg-gray-950 border-t border-white/10 px-2 py-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1`} dir={isHe ? 'rtl' : 'ltr'}>
      <span className="text-white/60 text-xs font-semibold whitespace-nowrap">{'👻'} {isHe ? 'צללית' : 'Ghost'}</span>
      <div className="flex rounded-lg overflow-hidden border border-white/15 flex-shrink-0">
        <Seg active={ghost === 'off'} onClick={() => onGhost('off')}>{isHe ? 'כבויה' : 'Off'}</Seg>
        <Seg active={ghost === 'small'} onClick={() => onGhost('small')}>{isHe ? 'קטנה' : 'Small'}</Seg>
        {bigAvailable && <Seg active={ghost === 'big'} onClick={() => onGhost('big')} tone="purple">{isHe ? 'גדולה' : 'Big'}</Seg>}
      </div>
      <span className="text-white/60 text-xs font-semibold whitespace-nowrap ms-1">{'🎽'} {isHe ? 'מאמן' : 'Coach'}</span>
      <div className="flex rounded-lg overflow-hidden border border-white/15 flex-shrink-0">
        {COACH_IDS.map(c => (
          <Seg key={c} active={coach === c} onClick={() => onCoach(c)} tone={c === 'female' ? 'pink' : 'blue'}>
            {COACH_INFO[c].icon} {isHe ? COACH_INFO[c].choice.he : COACH_INFO[c].choice.en}
          </Seg>
        ))}
        <Seg active={coach === 'none'} onClick={() => onCoach('none')}>{isHe ? 'ללא' : 'None'}</Seg>
      </div>
      {onVoice && coach !== 'none' && (
        <button type="button" onClick={onVoice}
          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-800 text-white/80 border border-white/15 whitespace-nowrap">
          {'🔊'} {isHe ? 'קול' : 'Voice'}
        </button>
      )}
    </div>
    {status && (
      <div className="bg-gray-950 text-center text-[11px] text-white/60 pb-1" dir={isHe ? 'rtl' : 'ltr'}>{status}</div>
    )}
    </div>
  );
}
