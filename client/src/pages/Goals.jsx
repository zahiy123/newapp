import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { GOALS } from '../utils/sportLogic';

const GOAL_ICONS = {
  technique: '\uD83C\uDFAF',
  aerobic: '\uD83D\uDCAA',
  strength: '\uD83C\uDFCB\uFE0F',
  weightLoss: '\u2696\uFE0F',
  speed: '\u26A1',
  flexibility: '\uD83E\uDDD8'
};

export default function Goals() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [selectedGoals, setSelectedGoals] = useState([]);
  const [storedGoals, setStoredGoals] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (profileDoc.exists() && profileDoc.data().goals) {
        setSelectedGoals(profileDoc.data().goals);
        setStoredGoals(profileDoc.data().goals);
      }
    }
    load();
  }, [user]);

  function toggleGoal(goal) {
    setError('');
    setSelectedGoals((prev) =>
      prev.includes(goal)
        ? prev.filter((g) => g !== goal)
        : [...prev, goal]
    );
  }

  async function handleContinue() {
    if (selectedGoals.length === 0) {
      setError(t('goals.selectAtLeast'));
      return;
    }
    setLoading(true);
    try {
      const goalsChanged = selectedGoals.length !== storedGoals.length ||
        selectedGoals.some(g => !storedGoals.includes(g));
      const update = { goals: selectedGoals };
      if (goalsChanged) {
        update.trainingPlan = null;
      }
      await updateDoc(doc(db, 'users', user.uid), update);
      await refreshProfile();
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('goals.title')}</h1>
      <p className="text-gray-500 mb-6">{t('goals.subtitle')}</p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {GOALS.map((goal) => (
          <button
            key={goal}
            onClick={() => toggleGoal(goal)}
            className={`p-5 rounded-xl border-2 text-center transition hover:shadow-lg ${
              selectedGoals.includes(goal)
                ? 'border-blue-500 bg-blue-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-3xl mb-2">{GOAL_ICONS[goal]}</div>
            <div className="font-medium text-gray-800 text-sm">{t(`goals.${goal}`)}</div>
          </button>
        ))}
      </div>

      <button
        onClick={handleContinue}
        disabled={loading || selectedGoals.length === 0}
        className="w-full mt-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
      >
        {loading ? t('app.loading') : t('goals.continue')}
      </button>
    </div>
  );
}
