import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

const STEPS = { CONDITION: 0, PROSTHESIS: 1, TARGET: 2 };

const CONDITIONS = [
  { key: 'amputationSingle', icon: '🦿', needsProsthesisQ: true },
  { key: 'amputationDouble', icon: '🦿🦿', needsProsthesisQ: true },
  { key: 'wheelchair', icon: '♿', needsProsthesisQ: false },
  { key: 'injuryRecovery', icon: '🩹', needsProsthesisQ: false },
];

// Target areas depend on condition
function getTargetAreas(condition, hasProsthesis) {
  if (condition === 'amputationSingle' || condition === 'amputationDouble') {
    const areas = [
      { key: 'core', icon: '🎯' },
      { key: 'back', icon: '🔙' },
      { key: 'residualLimb', icon: '💪' },
      { key: 'remainingLimbs', icon: '🦵' },
    ];
    if (hasProsthesis) {
      // Prosthesis users also get balance/gait training
      areas.push({ key: 'functional', icon: '🚶' });
    }
    return areas;
  }
  if (condition === 'wheelchair') {
    return [
      { key: 'shoulders', icon: '🦴' },
      { key: 'arms', icon: '💪' },
      { key: 'core', icon: '🎯' },
      { key: 'back', icon: '🔙' },
      { key: 'functional', icon: '♿' },
    ];
  }
  // injuryRecovery
  return [
    { key: 'shoulders', icon: '🦴' },
    { key: 'arms', icon: '💪' },
    { key: 'back', icon: '🔙' },
    { key: 'legs', icon: '🦵' },
    { key: 'functional', icon: '🏥' },
  ];
}

export default function RehabSelection() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(STEPS.CONDITION);
  const [condition, setCondition] = useState('');
  const [hasProsthesis, setHasProsthesis] = useState(null);
  const [targetArea, setTargetArea] = useState('');
  const [disability, setDisability] = useState('none');

  useEffect(() => {
    async function load() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (profileDoc.exists()) {
        setDisability(profileDoc.data().disability || 'none');
      }
    }
    load();
  }, [user]);

  function handleConditionSelect(cond) {
    setCondition(cond.key);
    if (cond.needsProsthesisQ) {
      setStep(STEPS.PROSTHESIS);
    } else {
      setHasProsthesis(false);
      setStep(STEPS.TARGET);
    }
  }

  function handleProsthesisAnswer(answer) {
    setHasProsthesis(answer);
    setStep(STEPS.TARGET);
  }

  async function handleContinue() {
    if (!targetArea) return;
    await setDoc(doc(db, 'users', user.uid), {
      rehabCondition: condition,
      rehabHasProsthesis: hasProsthesis,
      rehabTargetArea: targetArea,
      trainingPlan: null, // Force plan regeneration
    }, { merge: true });
    await refreshProfile();
    navigate('/goals');
  }

  const isHe = (localStorage.getItem('lang') || 'he') === 'he';
  const targetAreas = getTargetAreas(condition, hasProsthesis);

  return (
    <div className="max-w-lg mx-auto" dir={isHe ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{t('rehab.title')}</h1>
      <p className="text-gray-500 mb-6">{t('rehab.subtitle')}</p>

      {/* Progress indicator */}
      <div className="flex gap-2 mb-6">
        {[0, 1, 2].map(i => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition ${i <= step ? 'bg-teal-500' : 'bg-gray-200'}`} />
        ))}
      </div>

      {/* Step A: Condition */}
      {step === STEPS.CONDITION && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">{t('rehab.stepCondition')}</h2>
          <div className="grid grid-cols-2 gap-4">
            {CONDITIONS.map(cond => (
              <button
                key={cond.key}
                onClick={() => handleConditionSelect(cond)}
                className={`p-5 rounded-xl border-2 text-center transition hover:shadow-lg ${
                  condition === cond.key
                    ? 'border-teal-500 bg-teal-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="text-3xl mb-2">{cond.icon}</div>
                <div className="font-medium text-gray-800 text-sm">{t(`rehab.${cond.key}`)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step B: Prosthesis question */}
      {step === STEPS.PROSTHESIS && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">{t('rehab.hasProsthesis')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleProsthesisAnswer(true)}
              className={`p-6 rounded-xl border-2 text-center transition hover:shadow-lg ${
                hasProsthesis === true ? 'border-teal-500 bg-teal-50 shadow-md' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="text-3xl mb-2">🦿</div>
              <div className="font-medium text-gray-800">{t('rehab.yes')}</div>
            </button>
            <button
              onClick={() => handleProsthesisAnswer(false)}
              className={`p-6 rounded-xl border-2 text-center transition hover:shadow-lg ${
                hasProsthesis === false ? 'border-teal-500 bg-teal-50 shadow-md' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="text-3xl mb-2">🩼</div>
              <div className="font-medium text-gray-800">{t('rehab.no')}</div>
            </button>
          </div>
          <button onClick={() => setStep(STEPS.CONDITION)} className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline">
            {isHe ? 'חזרה' : 'Back'}
          </button>
        </div>
      )}

      {/* Step C: Target area */}
      {step === STEPS.TARGET && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">{t('rehab.selectArea')}</h2>
          <div className="grid grid-cols-2 gap-3">
            {targetAreas.map(area => (
              <button
                key={area.key}
                onClick={() => setTargetArea(area.key)}
                className={`p-4 rounded-xl border-2 text-center transition hover:shadow-lg ${
                  targetArea === area.key
                    ? 'border-teal-500 bg-teal-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">{area.icon}</div>
                <div className="font-medium text-gray-800 text-sm">{t(`rehab.${area.key}`)}</div>
              </button>
            ))}
          </div>

          <button
            onClick={handleContinue}
            disabled={!targetArea}
            className="w-full mt-6 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {t('rehab.continue')}
          </button>
          <button onClick={() => setStep(condition.includes('amputation') ? STEPS.PROSTHESIS : STEPS.CONDITION)} className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700 underline">
            {isHe ? 'חזרה' : 'Back'}
          </button>
        </div>
      )}
    </div>
  );
}
