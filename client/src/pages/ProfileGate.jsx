// ============================================================
// ProfileGate — Onboarding stepper
//
// Step 1: No name yet → personal details form (name, gender, age, height, weight)
// Step 2: No scan yet → AnatomicScan
// Step 3: Scan complete → Profile form (with auto-filled disability fields)
// ============================================================

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import Profile from './Profile';
import AnatomicScan from './AnatomicScan';

export default function ProfileGate() {
  const { t } = useTranslation();
  const { user, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // --- If scan is complete, show the full Profile form ---
  if (userProfile?.scanComplete) {
    return <Profile />;
  }

  // --- If personal details already filled, show the scan ---
  if (userProfile?.name) {
    return <AnatomicScan />;
  }

  // --- Step 1: Personal details form ---
  return <OnboardingForm user={user} refreshProfile={refreshProfile} navigate={navigate} t={t} />;
}

function OnboardingForm({ user, refreshProfile, navigate, t }) {
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

    const ageNum = Number(form.age);
    if (ageNum < 5 || ageNum > 99) {
      setError(t('onboarding.ageError'));
      setLoading(false);
      return;
    }

    try {
      await setDoc(doc(db, 'users', user.uid), {
        name: form.name,
        gender: form.gender,
        age: ageNum,
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
