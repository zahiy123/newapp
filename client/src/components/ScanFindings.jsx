// ScanFindings — read-only summary of what the kinetic scan detected.
// Disability / amputation data comes ONLY from the scan (no manual questionnaires);
// the user can rescan if something is wrong.

import { useNavigate } from 'react-router-dom';

const SIDE_HE = { left: 'שמאל', right: 'ימין' };
const LEVEL_HE = { above_knee: 'מעל הברך', below_knee: 'מתחת לברך', above_elbow: 'מעל המרפק', below_elbow: 'מתחת למרפק' };
const AID_HE = { crutches: 'קביים', cane: 'מקל הליכה', walker: 'הליכון', wheelchair: 'כיסא גלגלים', prosthesis: 'פרוטזה' };

/** Summary text for a profile, preferring the scan's own (deterministic) description. */
export function getScanSummary(profile, isHe) {
  const vision = profile?.visionDiagnosis;
  const fromScan = isHe ? vision?.description_he : vision?.description;
  if (fromScan) return fromScan;

  // Fallback: build from the profile fields the scan saved
  const d = profile?.disability;
  if (!d || d === 'none') return isHe ? 'לא זוהו קטיעות או מגבלות.' : 'No amputation or limitation detected.';
  const side = profile?.amputationSide && profile.amputationSide !== 'none' ? profile.amputationSide : null;
  const level = profile?.amputationLevel || null;
  if (isHe) {
    const limb = d === 'one_leg' ? 'רגל' : d === 'one_arm' ? 'יד' : null;
    if (limb) return `קטיעה ב${limb}${side ? ` ${SIDE_HE[side]}` : ''}${level ? ` ${LEVEL_HE[level] || ''}` : ''}.`;
    if (d === 'two_legs') return 'מגבלה בשתי הרגליים.';
    return 'זוהתה מגבלת תנועה.';
  }
  const limb = d === 'one_leg' ? 'leg' : d === 'one_arm' ? 'arm' : null;
  if (limb) return `Amputation of the ${side ? `${side} ` : ''}${limb}${level ? ` (${level.replace('_', ' ')})` : ''}.`;
  if (d === 'two_legs') return 'Limitation in both legs.';
  return 'Movement limitation detected.';
}

export default function ScanFindings({ profile, isHe }) {
  const navigate = useNavigate();
  const scanned = !!profile?.scanComplete;
  const aid = profile?.mobilityAid && profile.mobilityAid !== 'none' ? profile.mobilityAid : null;

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50 p-4" dir={isHe ? 'rtl' : 'ltr'}>
      <div className="text-sm font-semibold text-teal-800 mb-1">
        {isHe ? 'מה זיהתה הסריקה' : 'What the scan detected'}
      </div>
      {scanned ? (
        <>
          <p className="text-gray-800 text-sm">{getScanSummary(profile, isHe)}</p>
          {aid && (
            <p className="text-gray-600 text-xs mt-1">
              {isHe ? `עזר ניידות: ${AID_HE[aid] || aid}` : `Mobility aid: ${aid}`}
            </p>
          )}
        </>
      ) : (
        <p className="text-gray-600 text-sm">{isHe ? 'עדיין לא בוצעה סריקה.' : 'No scan has been done yet.'}</p>
      )}
      <button
        type="button"
        onClick={() => navigate('/scan')}
        className="mt-2 text-xs text-teal-700 underline hover:text-teal-900"
      >
        {scanned
          ? (isHe ? 'משהו לא נכון? סריקה חוזרת' : 'Something wrong? Rescan')
          : (isHe ? 'לסריקה' : 'Start scan')}
      </button>
    </div>
  );
}
