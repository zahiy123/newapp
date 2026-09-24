import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { db } from '../services/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { getAvailableGoals, getAvailableMuscleGroups } from '../utils/sportLogic';
import OnboardingProgress from '../components/OnboardingProgress';

const GOAL_ICONS = {
  technique: '\uD83C\uDFAF',
  aerobic: '\uD83D\uDCAA',
  strength: '\uD83C\uDFCB\uFE0F',
  weightLoss: '\u2696\uFE0F',
  speed: '\u26A1',
  flexibility: '\uD83E\uDDD8',
};

const MUSCLE_ICONS = {
  full_body: '\uD83E\uDDD1\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1',
  upper_body: '\uD83D\uDCAA',
  lower_body: '\uD83E\uDDB5',
  core: '\uD83E\uDDE0',
  shoulders_arms: '\uD83D\uDE4C',
};

export default function Goals() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const { isRTL } = useLanguage();
  const navigate = useNavigate();

  const [selectedGoals, setSelectedGoals] = useState([]);
  const [storedGoals, setStoredGoals] = useState([]);
  const [muscleGroupFocus, setMuscleGroupFocus] = useState('full_body');
  const [scanData, setScanData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (profileDoc.exists()) {
        const data = profileDoc.data();
        if (data.goals) {
          setSelectedGoals(data.goals);
          setStoredGoals(data.goals);
        }
        if (data.muscleGroupFocus) {
          setMuscleGroupFocus(data.muscleGroupFocus);
        }
        if (data.scanData) {
          setScanData(data.scanData);
        }
      }
    }
    load();
  }, [user]);

  // Iron Rule: filter goals and muscle groups based on scanData
  const availableGoals = getAvailableGoals(scanData);
  const availableMuscleGroups = getAvailableMuscleGroups(scanData);

  // If selected muscle group became blocked, reset to full_body
  useEffect(() => {
    const currentGroup = availableMuscleGroups.find(g => g.key === muscleGroupFocus);
    if (currentGroup?.blocked) {
      setMuscleGroupFocus('full_body');
    }
  }, [availableMuscleGroups, muscleGroupFocus]);

  // Remove blocked goals from selection
  useEffect(() => {
    const blockedKeys = new Set(availableGoals.filter(g => g.blocked).map(g => g.key));
    if (selectedGoals.some(g => blockedKeys.has(g))) {
      setSelectedGoals(prev => prev.filter(g => !blockedKeys.has(g)));
    }
  }, [availableGoals, selectedGoals]);

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
      const update = { goals: selectedGoals, muscleGroupFocus };
      if (goalsChanged) {
        update.trainingPlan = null;
      }
      await setDoc(doc(db, 'users', user.uid), update, { merge: true });
      await refreshProfile();
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg mx-auto" dir={isRTL ? 'rtl' : 'ltr'}>
      <OnboardingProgress currentStep="goals" isHe={isRTL} />
      <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('goals.title')}</h1>
      <p className="text-gray-500 mb-6">{t('goals.subtitle')}</p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {availableGoals.map(({ key, blocked }) => (
          <button
            key={key}
            onClick={() => !blocked && toggleGoal(key)}
            disabled={blocked}
            className={`p-5 rounded-xl border-2 text-center transition ${
              blocked
                ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                : selectedGoals.includes(key)
                  ? 'border-blue-500 bg-blue-50 shadow-md hover:shadow-lg'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-lg'
            }`}
          >
            <div className="text-3xl mb-2">{GOAL_ICONS[key]}</div>
            <div className="font-medium text-gray-800 text-sm">{t(`goals.${key}`)}</div>
            {blocked && (
              <div className="text-xs text-red-400 mt-1">{t('goals.blocked')}</div>
            )}
          </button>
        ))}
      </div>

      <h2 className="text-lg font-bold text-gray-800 mt-8 mb-2">{t('goals.muscleGroupTitle')}</h2>
      <p className="text-gray-500 mb-4 text-sm">{t('goals.muscleGroupSubtitle')}</p>

      <div className="flex flex-wrap gap-3">
        {availableMuscleGroups.map(({ key, blocked, reason }) => (
          <button
            key={key}
            onClick={() => !blocked && setMuscleGroupFocus(key)}
            disabled={blocked}
            className={`px-4 py-2 rounded-full border-2 text-sm font-medium transition ${
              blocked
                ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                : muscleGroupFocus === key
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
            title={blocked && reason ? t(`goals.${reason}`) : undefined}
          >
            <span className={isRTL ? 'ml-1' : 'mr-1'}>{MUSCLE_ICONS[key]}</span>
            {t(`goals.muscle_${key}`)}
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
