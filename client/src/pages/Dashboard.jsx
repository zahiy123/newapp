import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { apiUrl } from '../utils/api';
import { Link, useNavigate } from 'react-router-dom';
import {
  buildFingerprint, savePlan, loadPlan, clearPlan, sanitizePlan,
  loadProgress, isDayCompleted, areAllWeeksComplete, getNextWorkoutDay, clearProgress,
  loadActiveWorkout, clearActiveWorkout
} from '../utils/workoutStorage';
import { loadWeeklyProgress, checkWeeklyReminder } from '../utils/weeklyGoals';


const LOCATIONS = [
  { key: 'home', icon: '\uD83C\uDFE0' },
  { key: 'yard', icon: '\uD83C\uDF33' },
  { key: 'field', icon: '\u26BD' },
  { key: 'gym', icon: '\uD83C\uDFCB\uFE0F' }
];

const EQUIPMENT = [
  { key: 'none', icon: '\uD83E\uDDBE' },
  { key: 'dumbbells', icon: '\uD83C\uDFCB\uFE0F' },
  { key: 'resistance_bands', icon: '\uD83E\uDD3C' }
];

export default function Dashboard() {
  const { t } = useTranslation();
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();

  const [trainingPlan, setTrainingPlan] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [generatingWeek, setGeneratingWeek] = useState(0);
  const [error, setError] = useState('');
  const [activeWeek, setActiveWeek] = useState(0);
  const [currentLocation, setCurrentLocation] = useState('field');
  const [currentEquipment, setCurrentEquipment] = useState('none');
  const [workoutCount, setWorkoutCount] = useState(0);
  const [progress, setProgress] = useState({ completedDays: [] });
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [weeklyProgress, setWeeklyProgress] = useState({ sessions: 0 });
  const [weeklyReminder, setWeeklyReminder] = useState(null);
  const generatingRef = useRef(false);

  const name = userProfile?.name || '';
  const sport = userProfile?.sport;
  const goals = userProfile?.goals;
  const setupComplete = sport && goals?.length > 0 && name;

  const fingerprint = useMemo(() => userProfile ? buildFingerprint(userProfile) : '', [userProfile]);

  // Auto-redirect to onboarding if profile incomplete
  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.name) { navigate('/profile'); return; }
    if (!userProfile.sport) { navigate('/sport-selection'); return; }
    if (!userProfile.goals?.length) { navigate('/goals'); return; }
  }, [userProfile, navigate]);

  useEffect(() => {
    if (userProfile?.trainingLocation) setCurrentLocation(userProfile.trainingLocation);
    if (userProfile?.equipment) setCurrentEquipment(userProfile.equipment);
  }, [userProfile]);

  // Early server warm-up: wake Render instance while user browses dashboard
  useEffect(() => {
    fetch('https://newapp-nujg.onrender.com/api/coach/analyze-rep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: [], exercise: 'calibration', sport: 'warmup', playerName: 'warmup', repNumber: 0 })
    }).catch(() => {});
  }, []);

  // Load workout count
  useEffect(() => {
    async function loadCount() {
      if (!user) return;
      try {
        const snap = await getDocs(collection(db, 'users', user.uid, 'workouts'));
        setWorkoutCount(snap.size);
      } catch {}
    }
    loadCount();
  }, [user]);

  // Refresh progress from localStorage
  function refreshProgress() {
    setProgress(loadProgress());
  }

  useEffect(() => {
    refreshProgress();
  }, [trainingPlan]);

  // Check for active (resumable) workout
  useEffect(() => {
    setActiveWorkout(loadActiveWorkout());
  }, []);

  // Weekly goals tracking
  useEffect(() => {
    setWeeklyProgress(loadWeeklyProgress());
    const target = userProfile?.trainingDays || 3;
    setWeeklyReminder(checkWeeklyReminder(target));
  }, [userProfile]);

  // Load existing plan: localStorage first, then Firestore
  useEffect(() => {
    async function loadExistingPlan() {
      if (!user || !userProfile) return;
      const fp = buildFingerprint(userProfile);

      // 1. Try localStorage
      const cached = loadPlan(fp);
      if (cached?.weeks?.length > 0) {
        const clean = sanitizePlan(cached, userProfile.sport, userProfile.age);
        setTrainingPlan(clean);
        savePlan(clean, fp); // re-save sanitized version
        return;
      }

      // 2. Try Firestore
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.trainingPlan?.weeks?.length > 0) {
        if (data.trainingPlan.sport && data.trainingPlan.sport !== data.sport) {
          await setDoc(doc(db, 'users', user.uid), { trainingPlan: null }, { merge: true });
        } else {
          const clean = sanitizePlan(data.trainingPlan, userProfile.sport, userProfile.age);
          setTrainingPlan(clean);
          savePlan(clean, fp);
        }
      }
      if (data.currentLocation) setCurrentLocation(data.currentLocation);
    }
    loadExistingPlan();
  }, [user, userProfile]);

  // Auto-generate only once on initial mount when setup is complete and no plan loaded
  const autoGenTriggeredRef = useRef(false);
  const planLoadedRef = useRef(false);

  // Track whether plan was loaded from cache/Firestore
  useEffect(() => {
    if (trainingPlan) planLoadedRef.current = true;
  }, [trainingPlan]);

  // Fire auto-gen after a short delay — gives loadExistingPlan time to set the plan
  useEffect(() => {
    if (!setupComplete || autoGenTriggeredRef.current) return;
    const timer = setTimeout(() => {
      if (!planLoadedRef.current && !generatingRef.current) {
        autoGenTriggeredRef.current = true;
        generatePlan();
      }
    }, 1500); // wait 1.5s for cache/Firestore to load
    return () => clearTimeout(timer);
  }, [setupComplete]);

  function getPayload(loc) {
    return {
      profile: {
        name: userProfile.name,
        age: userProfile.age,
        gender: userProfile.gender,
        height: userProfile.height,
        weight: userProfile.weight,
        disability: userProfile.disability,
        skillLevel: userProfile.skillLevel || 'beginner',
        mobilityAid: userProfile.mobilityAid || 'none'
      },
      sport: userProfile.sport,
      goals: userProfile.goals,
      daysPerWeek: userProfile.trainingDays || 3,
      location: loc || currentLocation,
      equipment: currentEquipment
    };
  }

  async function fetchWeek(payload, weekNumber, retries = 1) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const res = await fetch(apiUrl('/api/coach/training-week'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, weekNumber }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Week ${weekNumber} failed`);
        }
        return res.json();
      } catch (err) {
        clearTimeout(timeout);
        if (attempt < retries) {
          console.log(`Week ${weekNumber} attempt ${attempt + 1} failed, retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw err;
      }
    }
  }

  async function fetchTips(payload) {
    const res = await fetch(apiUrl('/api/coach/training-tips'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return { generalTips: [], safetyNotes: [] };
    return res.json();
  }

  async function generatePlan(locationOverride) {
    if (!userProfile || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGeneratingWeek(1);
    setError('');
    const loc = locationOverride || currentLocation;
    const payload = getPayload(loc);
    const fp = buildFingerprint(userProfile);

    // Cache-first: check if we already have weeks cached
    const cached = loadPlan(fp);
    const cachedWeeks = cached?.weeks || [];
    let plan;
    let startFromWeek = 1;

    if (cachedWeeks.length > 0 && cached.sport === userProfile.sport) {
      plan = { ...cached, weeks: [...cachedWeeks] };
      startFromWeek = cachedWeeks.length + 1;
      setTrainingPlan(plan);
      setActiveWeek(0);
      if (startFromWeek > 4) {
        // All weeks cached, skip generation
        setGenerating(false);
        setGeneratingWeek(0);
        generatingRef.current = false;
        return;
      }
      setGenerating(false);
      setLoadingMore(true);
      setGeneratingWeek(startFromWeek);
    }

    try {
      if (startFromWeek === 1) {
        // No cache — generate Week 1
        setGeneratingWeek(1);
        let week1;
        try {
          week1 = await fetchWeek(payload, 1);
        } catch (err) {
          // Auto-retry once
          console.log('Week 1 failed, auto-retrying once...');
          await new Promise(r => setTimeout(r, 3000));
          week1 = await fetchWeek(payload, 1, 0);
        }
        plan = { weeks: [week1], generalTips: [], safetyNotes: [], sport: userProfile.sport };
        setTrainingPlan(plan);
        setActiveWeek(0);
        setGenerating(false);

        await setDoc(doc(db, 'users', user.uid), {
          trainingPlan: plan,
          planCreatedAt: new Date().toISOString()
        }, { merge: true });
        savePlan(plan, fp);
        startFromWeek = 2;
      }

      // Load remaining weeks in background
      setLoadingMore(true);
      for (let w = startFromWeek; w <= 4; w++) {
        setGeneratingWeek(w);
        try {
          const week = await fetchWeek(payload, w);
          plan.weeks.push(week);
          setTrainingPlan({ ...plan });
          await setDoc(doc(db, 'users', user.uid), { trainingPlan: { ...plan } }, { merge: true });
          savePlan({ ...plan }, fp);
        } catch (err) {
          console.error(`Week ${w} failed:`, err.message);
        }
      }

      try {
        const tips = await fetchTips(payload);
        plan.generalTips = tips.generalTips || [];
        plan.safetyNotes = tips.safetyNotes || [];
        setTrainingPlan({ ...plan });
        await setDoc(doc(db, 'users', user.uid), { trainingPlan: { ...plan } }, { merge: true });
        savePlan({ ...plan }, fp);
      } catch {}

      setLoadingMore(false);
      setGeneratingWeek(0);
    } catch (err) {
      console.error(err);
      setError(t('dashboard.planError'));
      setGenerating(false);
      setGeneratingWeek(0);
    }
    generatingRef.current = false;
  }

  function handleRegenerate() {
    if (generatingRef.current) return;
    clearPlan();
    clearProgress();
    setTrainingPlan(null);
    planLoadedRef.current = false;
    generatePlan();
  }

  async function handleLocationChange(loc) {
    if (loc === currentLocation || generatingRef.current) return;
    setCurrentLocation(loc);
    await setDoc(doc(db, 'users', user.uid), { currentLocation: loc }, { merge: true });
    clearPlan();
    clearProgress();
    setTrainingPlan(null);
    planLoadedRef.current = false;
    generatePlan(loc);
  }

  async function handleEquipmentChange(eq) {
    if (eq === currentEquipment || generatingRef.current) return;
    setCurrentEquipment(eq);
    await setDoc(doc(db, 'users', user.uid), { equipment: eq }, { merge: true });
    clearPlan();
    clearProgress();
    setTrainingPlan(null);
    planLoadedRef.current = false;
    generatePlan();
  }

  const weeks = trainingPlan?.weeks || [];
  const currentWeek = weeks[activeWeek];
  const allComplete = trainingPlan && areAllWeeksComplete(trainingPlan);
  const nextWorkout = trainingPlan ? getNextWorkoutDay(trainingPlan) : null;

  // Check if user is on Hebrew
  const isHe = (userProfile?.language || 'he') === 'he';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">
          {t('dashboard.welcome')}, {name}!
        </h1>
        {setupComplete && (
          <Link to="/profile?edit=1" className="text-sm text-gray-500 hover:text-blue-600 transition">
            {t('dashboard.editProfile')}
          </Link>
        )}
      </div>

      {!setupComplete && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-yellow-800">Setup</h2>
          {!userProfile?.name && (
            <Link to="/profile" className="block text-blue-600 hover:underline">1. {t('profile.title')}</Link>
          )}
          {!sport && (
            <Link to="/sport-selection" className="block text-blue-600 hover:underline">2. {t('sport.title')}</Link>
          )}
          {!goals?.length && (
            <Link to="/goals" className="block text-blue-600 hover:underline">3. {t('goals.title')}</Link>
          )}
        </div>
      )}

      {/* Location toggle */}
      {setupComplete && (
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">{t('dashboard.currentLocation')}</h3>
            <span className="text-xs text-gray-400">{t('dashboard.changeLocationHint')}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {LOCATIONS.map((loc) => (
              <button
                key={loc.key}
                onClick={() => handleLocationChange(loc.key)}
                disabled={generating}
                className={`py-3 rounded-lg text-center transition border-2 ${
                  currentLocation === loc.key
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                <div className="text-xl">{loc.icon}</div>
                <div className="text-xs font-medium mt-1 text-gray-700">
                  {t(`dashboard.location${loc.key.charAt(0).toUpperCase() + loc.key.slice(1)}`)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Equipment toggle */}
      {setupComplete && (
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">{t('dashboard.currentEquipment')}</h3>
            <span className="text-xs text-gray-400">{t('dashboard.changeEquipmentHint')}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {EQUIPMENT.map((eq) => (
              <button
                key={eq.key}
                onClick={() => handleEquipmentChange(eq.key)}
                disabled={generating}
                className={`py-3 rounded-lg text-center transition border-2 ${
                  currentEquipment === eq.key
                    ? 'border-green-500 bg-green-50 shadow-sm'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                <div className="text-xl">{eq.icon}</div>
                <div className="text-xs font-medium mt-1 text-gray-700">
                  {t(`dashboard.equipment${eq.key === 'none' ? 'None' : eq.key === 'dumbbells' ? 'Dumbbells' : 'Bands'}`)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Goal Progress */}
      {setupComplete && (
        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">
              {isHe ? 'מטרה שבועית' : 'Weekly Goal'}
            </h3>
            <span className="text-xs text-gray-400">
              {new Date().toLocaleDateString(isHe ? 'he-IL' : 'en-US', { weekday: 'long' })}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">
                  {weeklyProgress.sessions} / {userProfile?.trainingDays || 3} {isHe ? 'אימונים' : 'sessions'}
                </span>
                <span className="text-gray-600">
                  {Math.round((weeklyProgress.sessions / (userProfile?.trainingDays || 3)) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-green-500 to-blue-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((weeklyProgress.sessions / (userProfile?.trainingDays || 3)) * 100, 100)}%` }}
                />
              </div>
            </div>
            <span className="text-2xl">
              {weeklyProgress.sessions >= (userProfile?.trainingDays || 3) ? '🎉' : '💪'}
            </span>
          </div>
        </div>
      )}

      {/* Thursday reminder */}
      {weeklyReminder && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-center">
          <p className="text-yellow-800 text-sm font-medium">{weeklyReminder}</p>
        </div>
      )}

      {generating && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center space-y-3">
          <div className="animate-spin inline-block w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full"></div>
          <p className="text-blue-700 font-medium">
            {generatingWeek > 0
              ? (isHe ? `יוצר שבוע ${generatingWeek} מתוך 4...` : `Creating week ${generatingWeek} of 4...`)
              : t('dashboard.generating')}
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center space-y-3">
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={() => { setError(''); generatePlan(); }}
            className="px-6 py-3 min-h-[48px] bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg font-bold text-base hover:opacity-90 transition"
          >
            {isHe ? 'נסה שוב' : 'Try Again'}
          </button>
        </div>
      )}

      {/* Plan complete banner */}
      {allComplete && !generating && (
        <div className="bg-green-50 border-2 border-green-400 rounded-xl p-5 text-center space-y-3">
          <div className="text-3xl">&#127942;</div>
          <h2 className="font-bold text-green-800 text-lg">
            {isHe ? 'סיימת את כל התוכנית!' : 'Plan Complete!'}
          </h2>
          <p className="text-sm text-green-700">
            {isHe ? 'כל הכבוד! השלמת את כל האימונים בתוכנית השבועית.' : 'Amazing! You completed all workouts in the plan.'}
          </p>
          <button
            onClick={handleRegenerate}
            className="px-6 py-3 min-h-[48px] bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-medium hover:opacity-90 transition"
          >
            {isHe ? 'צור תוכנית חדשה' : 'Generate New Plan'}
          </button>
        </div>
      )}

      {/* Resume interrupted workout */}
      {activeWorkout && (
        <div className="space-y-1">
          <button
            onClick={() => navigate(`/training?week=${activeWorkout.week}&day=${activeWorkout.day}&resume=true`)}
            className="w-full py-4 min-h-[56px] bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-lg hover:opacity-90 transition shadow-lg animate-pulse"
          >
            {isHe ? 'חזור לאימון' : 'Resume Workout'} &#9654;
          </button>
          <button
            onClick={() => { clearActiveWorkout(); setActiveWorkout(null); }}
            className="w-full text-sm text-gray-500 hover:text-gray-700 underline"
          >
            {isHe ? 'בטל' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Continue training shortcut */}
      {nextWorkout && trainingPlan && !generating && !allComplete && (
        <button
          onClick={() => navigate(`/training?week=${nextWorkout.week}&day=${nextWorkout.day}`)}
          className="w-full py-4 min-h-[56px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold text-lg hover:opacity-90 transition shadow-lg"
        >
          {isHe ? 'המשך אימון' : 'Continue Training'} &#8594;
        </button>
      )}

      {trainingPlan && !generating && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">{t('dashboard.yourPlan')}</h2>
            <button onClick={handleRegenerate} className="text-sm text-blue-600 hover:underline">
              {t('dashboard.regenerate')}
            </button>
          </div>

          {/* Week tabs */}
          {weeks.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {weeks.map((week, i) => (
                <button
                  key={i}
                  onClick={() => setActiveWeek(i)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                    activeWeek === i
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {t('dashboard.week')} {week.weekNumber}
                </button>
              ))}
              {loadingMore && (
                <div className="px-4 py-2 text-gray-400 text-sm flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full"></div>
                  {generatingWeek > 0
                    ? (isHe ? `שבוע ${generatingWeek}/4...` : `Week ${generatingWeek}/4...`)
                    : t('app.loading')}
                </div>
              )}
            </div>
          )}

          {currentWeek && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <div className="font-bold text-purple-800">
                {t('dashboard.week')} {currentWeek.weekNumber}: {currentWeek.theme}
              </div>
            </div>
          )}

          {currentWeek?.days?.map((day, i) => {
            const completed = isDayCompleted(activeWeek, i);
            const isNext = nextWorkout && nextWorkout.week === activeWeek && nextWorkout.day === i;

            return (
              <div
                key={i}
                className={`rounded-xl shadow p-3 sm:p-5 space-y-3 transition ${
                  completed
                    ? 'bg-gray-50 border-2 border-green-300 opacity-75'
                    : isNext
                    ? 'bg-white border-2 border-blue-400 shadow-lg'
                    : 'bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2">
                    {completed && <span className="text-green-500 text-lg">&#10003;</span>}
                    {day.day}
                    {isNext && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {isHe ? 'הבא' : 'Next'}
                      </span>
                    )}
                  </h3>
                  <span className="text-sm text-gray-500">{day.durationMinutes} {t('dashboard.minutes')}</span>
                </div>
                <p className="text-sm text-purple-600 font-medium">{day.focus}</p>

                {day.warmup && (
                  <div className="bg-orange-50 rounded-lg p-3 text-sm">
                    <span className="font-medium text-orange-700">{t('dashboard.warmup')}:</span>{' '}
                    {typeof day.warmup === 'string' ? day.warmup : day.warmup.text || ''}
                    {typeof day.warmup === 'object' && day.warmup.instructions && (
                      <ul className="mt-1 space-y-0.5 text-orange-600">
                        {day.warmup.instructions.map((step, si) => (
                          <li key={si} className="flex items-start gap-1">
                            <span className="font-bold">{si + 1}.</span> {step}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {day.exercises?.map((ex, j) => (
                    <div key={j} className="border border-gray-100 rounded-lg p-3">
                      <div className="font-medium text-gray-800">{ex.name}</div>
                      <p className="text-sm text-gray-500">{ex.description}</p>
                      <div className="flex gap-4 mt-1 text-xs text-gray-400">
                        {ex.sets && <span>{ex.sets} {t('dashboard.sets')}</span>}
                        {ex.reps && <span>{ex.reps} {t('dashboard.reps')}</span>}
                        {ex.restSeconds && <span>{ex.restSeconds}{t('dashboard.secRest')}</span>}
                      </div>
                      {ex.tips && <p className="text-xs text-blue-500 mt-1">{ex.tips}</p>}
                    </div>
                  ))}
                </div>

                {day.cooldown && (
                  <div className="bg-blue-50 rounded-lg p-3 text-sm">
                    <span className="font-medium text-blue-700">{t('dashboard.cooldown')}:</span> {day.cooldown}
                  </div>
                )}

                <button
                  onClick={() => navigate(`/training?week=${activeWeek}&day=${i}`)}
                  className={`w-full py-3 min-h-[48px] rounded-lg font-medium transition ${
                    completed
                      ? 'bg-gray-200 text-gray-500'
                      : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:opacity-90'
                  }`}
                >
                  {completed
                    ? (isHe ? 'הושלם - תרגל שוב' : 'Completed - Train Again')
                    : t('dashboard.startTraining')
                  }
                </button>
              </div>
            );
          })}

          {trainingPlan.safetyNotes?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5">
              <h3 className="font-semibold text-red-800 mb-2">{t('dashboard.safety')}</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
                {trainingPlan.safetyNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {trainingPlan.generalTips?.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <h3 className="font-semibold text-green-800 mb-2">{t('dashboard.tips')}</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-green-700">
                {trainingPlan.generalTips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Link to="/stats" className="block bg-white rounded-xl shadow p-6 hover:shadow-md transition">
        <h2 className="font-semibold text-gray-800 mb-3">{t('dashboard.stats')}</h2>
        <div className="text-3xl font-bold text-blue-600">{workoutCount}</div>
        <div className="text-gray-500 text-sm">{t('dashboard.trainingsCompleted')}</div>
      </Link>
    </div>
  );
}
