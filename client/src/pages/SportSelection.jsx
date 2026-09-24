import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { db } from '../services/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getAvailableSports } from '../utils/sportLogic';
import OnboardingProgress from '../components/OnboardingProgress';

export default function SportSelection() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const { isRTL } = useLanguage();
  const navigate = useNavigate();

  const [selected, setSelected] = useState('');
  const [disability, setDisability] = useState('none');
  const [scanData, setScanData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (profileDoc.exists()) {
        const data = profileDoc.data();
        setDisability(data.disability || 'none');
        if (data.scanData) setScanData(data.scanData);
        if (data.sport) setSelected(data.sport);
      }
      setLoading(false);
    }
    load();
  }, [user]);

  // Iron Rule: scanData-driven filtering (falls back to disability string)
  const availableSports = getAvailableSports(disability, scanData);

  // If the previously selected sport is no longer available, clear it
  useEffect(() => {
    if (!loading && selected && !availableSports.find(s => s.key === selected)) {
      setSelected('');
    }
  }, [loading, selected, availableSports]);

  const isAdapted = scanData?.classification && scanData.classification !== 'NATURAL';

  async function handleContinue() {
    if (!selected) return;
    const profileDoc = await getDoc(doc(db, 'users', user.uid));
    const prevSport = profileDoc.exists() ? profileDoc.data().sport : null;
    const updates = { sport: selected };
    if (prevSport && prevSport !== selected) {
      updates.trainingPlan = null;
    }
    await setDoc(doc(db, 'users', user.uid), updates, { merge: true });
    await refreshProfile();
    if (selected === 'rehab') {
      navigate('/rehab-selection');
    } else {
      navigate('/goals');
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto" dir={isRTL ? 'rtl' : 'ltr'}>
      <OnboardingProgress currentStep="sport" isHe={isRTL} />
      <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('sport.title')}</h1>
      <p className="text-gray-500 mb-4">{t('sport.subtitle')}</p>

      {isAdapted && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
          {t('sport.adaptedNote')}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {availableSports.map((sport) => (
          <button
            key={sport.key}
            onClick={() => setSelected(sport.key)}
            className={`p-6 rounded-xl border-2 text-center transition hover:shadow-lg ${
              selected === sport.key
                ? 'border-blue-500 bg-blue-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-4xl mb-2">{sport.icon}</div>
            <div className="font-medium text-gray-800">{t(`sport.${sport.key}`)}</div>
          </button>
        ))}
      </div>

      <button
        onClick={handleContinue}
        disabled={!selected}
        className="w-full mt-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
      >
        {t('sport.continue')}
      </button>
    </div>
  );
}
