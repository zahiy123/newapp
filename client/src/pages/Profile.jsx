import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function Profile() {
  const { t } = useTranslation();
  const { user, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditMode = searchParams.get('edit') === '1';

  const [form, setForm] = useState({
    name: '',
    gender: '',
    age: '',
    height: '',
    weight: '',
    disability: 'none',
    disabilityOther: '',
    amputationSide: 'none',
    amputationLevel: '',
    skillLevel: 'beginner',
    mobilityAid: 'none',
    trainingDays: 3,
    trainingLocation: 'field',
    equipment: 'none'
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadProfile() {
      if (!user) return;
      const profileDoc = await getDoc(doc(db, 'users', user.uid));
      if (profileDoc.exists()) {
        setForm((prev) => ({ ...prev, ...profileDoc.data() }));
      }
    }
    loadProfile();
  }, [user]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setSaved(false);
  }

  const showMobilityAid = form.disability !== 'none';

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const ageNum = Number(form.age);
    if (ageNum < 5 || ageNum > 99) {
      const isHe = (userProfile?.language || 'he') === 'he';
      setError(isHe ? 'האימונים זמינים לגילאי 5 עד 99 בלבד.' : 'Training is available for ages 5 to 99 only.');
      setLoading(false);
      return;
    }
    try {
      await setDoc(doc(db, 'users', user.uid), {
        ...form,
        age: Number(form.age),
        height: Number(form.height),
        weight: Number(form.weight),
        trainingDays: Number(form.trainingDays),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => navigate(isEditMode ? '/' : '/sport-selection'), 1500);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">{t('profile.title')}</h1>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {saved && (
        <div className="bg-green-50 text-green-600 p-3 rounded-lg mb-4 text-sm">
          {t('profile.saved')}
        </div>
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

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.disability')}</label>
          <select
            name="disability"
            value={form.disability}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="none">{t('profile.disabilityNone')}</option>
            <option value="one_leg">{t('profile.disabilityOneLeg')}</option>
            <option value="one_arm">{t('profile.disabilityOneArm')}</option>
            <option value="two_legs">{t('profile.disabilityTwoLegs')}</option>
            <option value="other">{t('profile.disabilityOther')}</option>
          </select>
        </div>

        {form.disability === 'other' && (
          <div>
            <input
              name="disabilityOther"
              value={form.disabilityOther}
              onChange={handleChange}
              placeholder={t('profile.disabilityOther')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        )}

        {/* Amputation Side + Level - only for one_leg / one_arm */}
        {(form.disability === 'one_leg' || form.disability === 'one_arm') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.amputationSide')}</label>
              <select
                name="amputationSide"
                value={form.amputationSide}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="none">---</option>
                <option value="left">{t('profile.amputationLeft')}</option>
                <option value="right">{t('profile.amputationRight')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.amputationLevel')}</label>
              <select
                name="amputationLevel"
                value={form.amputationLevel}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">---</option>
                {form.disability === 'one_leg' ? (
                  <>
                    <option value="above_knee">{t('profile.aboveKnee')}</option>
                    <option value="below_knee">{t('profile.belowKnee')}</option>
                  </>
                ) : (
                  <>
                    <option value="above_elbow">{t('profile.aboveElbow')}</option>
                    <option value="below_elbow">{t('profile.belowElbow')}</option>
                  </>
                )}
              </select>
            </div>
          </div>
        )}

        {/* Mobility Aid - only shown when disability is set */}
        {showMobilityAid && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.mobilityAid')}</label>
            <select
              name="mobilityAid"
              value={form.mobilityAid}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="none">{t('profile.noneAid')}</option>
              <option value="crutches">{t('profile.crutches')}</option>
              <option value="prosthesis">{t('profile.prosthesis')}</option>
              <option value="wheelchair">{t('profile.wheelchair')}</option>
            </select>
          </div>
        )}

        {/* Skill Level */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('profile.skillLevel')}</label>
          <div className="grid grid-cols-3 gap-2">
            {['beginner', 'intermediate', 'pro'].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => { setForm((prev) => ({ ...prev, skillLevel: level })); setSaved(false); }}
                className={`py-3 px-2 rounded-lg text-sm font-medium border-2 transition ${
                  form.skillLevel === level
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {t(`profile.${level}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Training Days */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('profile.trainingDays')}</label>
          <div className="flex gap-2">
            {[2, 3, 4, 5, 6].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => { setForm((prev) => ({ ...prev, trainingDays: days })); setSaved(false); }}
                className={`flex-1 py-3 rounded-lg text-sm font-bold border-2 transition ${
                  Number(form.trainingDays) === days
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {days}
              </button>
            ))}
          </div>
        </div>

        {/* Training Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('profile.trainingLocation')}</label>
          <div className="grid grid-cols-4 gap-2">
            {['home', 'yard', 'field', 'gym'].map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => { setForm((prev) => ({ ...prev, trainingLocation: loc })); setSaved(false); }}
                className={`py-3 px-2 rounded-lg text-xs font-medium border-2 transition ${
                  form.trainingLocation === loc
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {t(`profile.location${loc.charAt(0).toUpperCase() + loc.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Equipment */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('profile.equipment')}</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'none', label: t('profile.equipmentNone') },
              { key: 'dumbbells', label: t('profile.equipmentDumbbells') },
              { key: 'resistance_bands', label: t('profile.equipmentBands') }
            ].map((eq) => (
              <button
                key={eq.key}
                type="button"
                onClick={() => { setForm((prev) => ({ ...prev, equipment: eq.key })); setSaved(false); }}
                className={`py-3 px-2 rounded-lg text-sm font-medium border-2 transition ${
                  form.equipment === eq.key
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {eq.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? t('app.loading') : t('profile.save')}
        </button>
      </form>
    </div>
  );
}
