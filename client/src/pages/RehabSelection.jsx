// RehabSelection — choose the rehab TRACK (Stage 2).
//
// The physical condition (amputation, side, level, aids) is NOT asked here — it was
// detected automatically by the kinetic scan and is shown read-only (ScanFindings).
// The user only chooses:
//   - rehab_only:  clean rehabilitation
//   - rehab_sport: rehabilitation combined with an adapted sport (picked from the
//                  sports the scan allows — Iron Rule filtering)

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getAvailableSports } from '../utils/sportLogic';
import ScanFindings from '../components/ScanFindings';

const TRACKS = [
  { key: 'rehab_only', icon: '🏥' },
  { key: 'rehab_sport', icon: '🏅' },
];

// "Fitness" and "rehab" are not sport branches to combine with
const NON_SPORT_KEYS = new Set(['rehab', 'fitness']);

export default function RehabSelection() {
  const { t } = useTranslation();
  const { user, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const isHe = (localStorage.getItem('lang') || 'he') === 'he';

  const [track, setTrack] = useState('');
  const [rehabSport, setRehabSport] = useState('');
  const [saving, setSaving] = useState(false);

  // Restore previous choices
  useEffect(() => {
    if (userProfile?.trainingTrack === 'rehab_only' || userProfile?.trainingTrack === 'rehab_sport') {
      setTrack(userProfile.trainingTrack);
    }
    if (userProfile?.rehabSport) setRehabSport(userProfile.rehabSport);
  }, [userProfile?.trainingTrack, userProfile?.rehabSport]);

  const sports = getAvailableSports(userProfile?.disability || 'none', userProfile?.scanData || null)
    .filter(s => !NON_SPORT_KEYS.has(s.key));

  // A previously chosen sport that the scan no longer allows is cleared
  useEffect(() => {
    if (rehabSport && !sports.find(s => s.key === rehabSport)) setRehabSport('');
  }, [rehabSport, sports]);

  const canContinue = track === 'rehab_only' || (track === 'rehab_sport' && !!rehabSport);

  async function handleContinue() {
    if (!canContinue || saving) return;
    setSaving(true);
    const changed = track !== userProfile?.trainingTrack ||
      (track === 'rehab_sport' && rehabSport !== userProfile?.rehabSport);
    await setDoc(doc(db, 'users', user.uid), {
      sport: 'rehab',
      trainingTrack: track,
      rehabSport: track === 'rehab_sport' ? rehabSport : null,
      ...(changed ? { trainingPlan: null } : {}),  // force plan regeneration
    }, { merge: true });
    await refreshProfile();
    navigate('/goals');
  }

  return (
    <div className="max-w-lg mx-auto" dir={isHe ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{t('rehab.title')}</h1>
      <p className="text-gray-500 mb-4">{t('rehab.trackSubtitle')}</p>

      <ScanFindings profile={userProfile} isHe={isHe} />

      <h2 className="text-lg font-semibold text-gray-700 mt-6 mb-3">{t('rehab.trackQuestion')}</h2>
      <div className="grid grid-cols-1 gap-3">
        {TRACKS.map(tr => (
          <button
            key={tr.key}
            onClick={() => setTrack(tr.key)}
            className={`p-4 rounded-xl border-2 text-start transition hover:shadow-lg flex items-center gap-4 ${
              track === tr.key ? 'border-teal-500 bg-teal-50 shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-3xl">{tr.icon}</div>
            <div>
              <div className="font-semibold text-gray-800">{t(`rehab.track_${tr.key}`)}</div>
              <div className="text-sm text-gray-500">{t(`rehab.track_${tr.key}_desc`)}</div>
            </div>
          </button>
        ))}
      </div>

      {track === 'rehab_sport' && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-1">{t('rehab.sportQuestion')}</h2>
          <p className="text-sm text-gray-500 mb-3">{t('rehab.sportFiltered')}</p>
          <div className="grid grid-cols-2 gap-3">
            {sports.map(sport => (
              <button
                key={sport.key}
                onClick={() => setRehabSport(sport.key)}
                className={`p-4 rounded-xl border-2 text-center transition hover:shadow-lg ${
                  rehabSport === sport.key ? 'border-teal-500 bg-teal-50 shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="text-3xl mb-1">{sport.icon}</div>
                <div className="font-medium text-gray-800 text-sm">{t(`sport.${sport.key}`)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={!canContinue || saving}
        className="w-full mt-6 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
      >
        {saving ? t('app.loading') : t('rehab.continue')}
      </button>
    </div>
  );
}
