import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getAvailableSports } from '../utils/sportLogic';

export default function SportSelection() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [selected, setSelected] = useState('');
  const [disability, setDisability] = useState('none');

  useEffect(() => {
    async function load() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (profileDoc.exists()) {
        const data = profileDoc.data();
        setDisability(data.disability || 'none');
        if (data.sport) setSelected(data.sport);
      }
    }
    load();
  }, [user]);

  const availableSports = getAvailableSports(disability);

  async function handleContinue() {
    if (!selected) return;
    // Clear old training plan when sport changes so Dashboard regenerates
    const profileDoc = await getDoc(doc(db, 'users', user.uid));
    const prevSport = profileDoc.exists() ? profileDoc.data().sport : null;
    const updates = { sport: selected };
    if (prevSport && prevSport !== selected) {
      updates.trainingPlan = null;
    }
    await updateDoc(doc(db, 'users', user.uid), updates);
    await refreshProfile();
    navigate('/goals');
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('sport.title')}</h1>
      <p className="text-gray-500 mb-6">{t('sport.subtitle')}</p>

      <div className="grid grid-cols-2 gap-4">
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
