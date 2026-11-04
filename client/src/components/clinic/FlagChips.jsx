// A patient's red flags as chips (server/services/clinicFlags.js decides them).
import { zoneName } from '../../engine/training/painTrafficLight';

export default function FlagChips({ flags = [], isHe }) {
  if (!flags.length) return <div className="text-xs text-emerald-700">{'✓'} {isHe ? 'אין דגלים' : 'No flags'}</div>;
  const label = (f) => {
    const d = f.detail || {};
    switch (f.code) {
      case 'locked': return isHe ? 'נעול — ממתין לאישורך' : 'Locked — waiting for your approval';
      case 'red_pain': return isHe ? `כאב אדום ${d.level}${d.zone ? ` ב${zoneName(d.zone, true)}` : ''}` : `Red pain ${d.level}${d.zone ? ` (${zoneName(d.zone, false)})` : ''}`;
      case 'repeated_yellow': return isHe ? `${d.count} כאבים צהובים השבוע` : `${d.count} yellow pains this week`;
      case 'safe_mode': return isHe ? 'מצב בטוח השבוע' : 'Safe mode this week';
      case 'rom_drop': return isHe ? `ירידת טווח: ${d.joint} ${d.best}° ← ${d.latest}°` : `ROM drop: ${d.joint} ${d.best}° → ${d.latest}°`;
      case 'stepped_down': return isHe ? 'ירידת רמת מורכבות' : 'Complexity stepped down';
      case 'inactive': return isHe ? `${d.days} ימים בלי אימון` : `${d.days} days without a workout`;
      default: return f.code;
    }
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f, i) => (
        <span key={i} className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${f.severity === 'red' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900'}`}>
          {f.severity === 'red' ? '⚠️ ' : ''}{label(f)}
        </span>
      ))}
    </div>
  );
}
