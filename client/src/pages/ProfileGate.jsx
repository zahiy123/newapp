// ============================================================
// ProfileGate — Onboarding stepper
//
// Step 1: Personal details form (name, gender, age, height, weight)
// Step 2: Anatomic Scan (disability detected automatically)
// Step 3: Profile completion (preferences, training settings)
// Step 4: Sport Selection
// Step 5: Goals
//
// Steps 4-5 are separate routes (/sport-selection, /goals)
// but the progress bar reflects the full onboarding flow.
// ============================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import Profile from './Profile';
import AnatomicScan from './AnatomicScan';
import OnboardingProgress from '../components/OnboardingProgress';

// ─── ProfileGate ───

export default function ProfileGate() {
  const { t } = useTranslation();
  const { user, userProfile, refreshProfile } = useAuth();
  const { isRTL } = useLanguage();
  const navigate = useNavigate();
  const isHe = isRTL;

  // Determine current onboarding step
  const hasBasicProfile = userProfile?.name
    && userProfile?.gender
    && userProfile?.age
    && userProfile?.height
    && userProfile?.weight;

  let currentStep = 'details';
  if (userProfile?.scanComplete) {
    currentStep = 'profile';
  } else if (hasBasicProfile) {
    currentStep = 'scan';
  }

  // --- Step 3: Scan complete → Profile form ---
  if (currentStep === 'profile') {
    return (
      <div dir={isRTL ? 'rtl' : 'ltr'}>
        <OnboardingProgress currentStep="profile" isHe={isHe} />
        <Profile />
      </div>
    );
  }

  // --- Step 2: Basic details filled → AnatomicScan ---
  if (currentStep === 'scan') {
    return (
      <div dir={isRTL ? 'rtl' : 'ltr'}>
        <OnboardingProgress currentStep="scan" isHe={isHe} />
        <AnatomicScan />
      </div>
    );
  }

  // --- Step 1: Personal details form ---
  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <OnboardingProgress currentStep="details" isHe={isHe} />
      <OnboardingForm user={user} refreshProfile={refreshProfile} t={t} isHe={isHe} />
    </div>
  );
}

// ─── Validation helpers ───

function validateProfile(form, t, isHe) {
  const name = form.name.trim();
  if (!name || name.length < 2) {
    return isHe ? 'שם חייב להכיל לפחות 2 תווים' : 'Name must be at least 2 characters';
  }
  if (!form.gender) {
    return isHe ? 'יש לבחור מגדר' : 'Please select gender';
  }
  const age = Number(form.age);
  if (!age || age < 5 || age > 99) {
    return t('onboarding.ageError');
  }
  const height = Number(form.height);
  if (!height || height < 50 || height > 250) {
    return isHe ? 'גובה חייב להיות בין 50 ל-250 ס"מ' : 'Height must be between 50 and 250 cm';
  }
  const weight = Number(form.weight);
  if (!weight || weight < 10 || weight > 300) {
    return isHe ? 'משקל חייב להיות בין 10 ל-300 ק"ג' : 'Weight must be between 10 and 300 kg';
  }
  return null;
}

// ─── OnboardingForm ───

function OnboardingForm({ user, refreshProfile, t, isHe }) {
  const [form, setForm] = useState({
    name: '',
    gender: '',
    age: '',
    height: '',
    weight: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const validationError = validateProfile(form, t, isHe);
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    try {
      await setDoc(doc(db, 'users', user.uid), {
        name: form.name.trim(),
        gender: form.gender,
        age: Number(form.age),
        height: Number(form.height),
        weight: Number(form.weight),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await refreshProfile();
      // After refresh, ProfileGate will re-render and show AnatomicScan
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">{t('onboarding.title')}</h1>
      <p className="text-gray-500 mb-6">{t('onboarding.subtitle')}</p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl shadow p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.name')}</label>
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            minLength={2}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.gender')}</label>
          <select
            name="gender"
            value={form.gender}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">---</option>
            <option value="male">{t('profile.male')}</option>
            <option value="female">{t('profile.female')}</option>
            <option value="other">{t('profile.other')}</option>
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.age')}</label>
            <input
              name="age"
              type="number"
              min="5"
              max="99"
              value={form.age}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.height')}</label>
            <input
              name="height"
              type="number"
              min="50"
              max="250"
              value={form.height}
              onChange={handleChange}
              required
              placeholder={isHe ? 'ס"מ' : 'cm'}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.weight')}</label>
            <input
              name="weight"
              type="number"
              min="10"
              max="300"
              value={form.weight}
              onChange={handleChange}
              required
              placeholder={isHe ? 'ק"ג' : 'kg'}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? t('app.loading') : t('onboarding.next')}
        </button>
      </form>
    </div>
  );
}
