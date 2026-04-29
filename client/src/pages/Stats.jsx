import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { db } from '../services/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

export default function Stats() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [workouts, setWorkouts] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('training'); // 'training' | 'games'

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      try {
        const [workoutSnap, gameSnap] = await Promise.all([
          getDocs(query(collection(db, 'users', user.uid, 'workouts'), orderBy('date', 'desc'), limit(50))),
          getDocs(query(collection(db, 'users', user.uid, 'games'), orderBy('date', 'desc'), limit(50))),
        ]);
        setWorkouts(workoutSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setGames(gameSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load data:', err);
      }
      setLoading(false);
    }
    loadData();
  }, [user]);

  // === Computed Stats ===
  const stats = useMemo(() => {
    if (workouts.length === 0) return null;

    const completed = workouts.filter(w => w.status === 'completed').length;
    const partial = workouts.filter(w => w.status === 'partial').length;
    const totalCalories = workouts.reduce((s, w) => s + (w.totalCalories || 0), 0);
    const totalDuration = workouts.reduce((s, w) => s + (w.totalDuration || 0), 0);
    const avgDuration = workouts.length > 0 ? Math.round(totalDuration / workouts.length / 60) : 0;

    // Streak: consecutive days with workouts
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sortedDates = workouts
      .map(w => {
        const d = w.date?.toDate ? w.date.toDate() : new Date(w.date);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })
      .filter((v, i, a) => a.indexOf(v) === i) // unique days
      .sort((a, b) => b - a); // newest first

    if (sortedDates.length > 0) {
      const oneDay = 86400000;
      let checkDate = today.getTime();
      // Allow today or yesterday as start
      if (sortedDates[0] === checkDate || sortedDates[0] === checkDate - oneDay) {
        checkDate = sortedDates[0];
        streak = 1;
        for (let i = 1; i < sortedDates.length; i++) {
          if (sortedDates[i] === checkDate - oneDay) {
            streak++;
            checkDate = sortedDates[i];
          } else {
            break;
          }
        }
      }
    }

    return { completed, partial, total: workouts.length, totalCalories, avgDuration, streak };
  }, [workouts]);

  // === Personal Bests ===
  const personalBests = useMemo(() => {
    if (workouts.length === 0) return [];
    const bests = {};

    for (const workout of workouts) {
      for (const ex of (workout.exercises || [])) {
        const key = ex.name;
        if (!bests[key] || ex.repsActual > bests[key].value) {
          bests[key] = {
            name: ex.name,
            value: ex.repsActual,
            date: workout.date?.toDate ? workout.date.toDate() : new Date(workout.date),
            metric: 'reps',
          };
        }
      }
    }

    return Object.values(bests)
      .filter(b => b.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [workouts]);

  // === Chart Data ===
  const chartWorkouts = useMemo(() => [...workouts].reverse().slice(-20), [workouts]);

  const dateLabels = chartWorkouts.map(w => {
    const d = w.date?.toDate ? w.date.toDate() : new Date(w.date);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  });

  const repsChartData = {
    labels: dateLabels,
    datasets: [{
      label: t('stats.repsOverTime'),
      data: chartWorkouts.map(w => (w.exercises || []).reduce((s, e) => s + (e.repsActual || 0), 0)),
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      fill: true,
      tension: 0.3,
    }]
  };

  const caloriesChartData = {
    labels: dateLabels,
    datasets: [{
      label: t('stats.caloriesOverTime'),
      data: chartWorkouts.map(w => w.totalCalories || 0),
      backgroundColor: 'rgba(249, 115, 22, 0.7)',
      borderRadius: 6,
    }]
  };

  const durationChartData = {
    labels: dateLabels,
    datasets: [{
      label: t('stats.durationOverTime'),
      data: chartWorkouts.map(w => Math.round((w.totalDuration || 0) / 60)),
      borderColor: '#8B5CF6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      fill: true,
      tension: 0.3,
    }]
  };

  // AI Quality (technicalQuality) chart — only workouts that have a score
  const qualityWorkouts = chartWorkouts.filter(w => w.technicalQuality != null && w.technicalQuality > 0);
  const qualityLabels = qualityWorkouts.map(w => {
    const d = w.date?.toDate ? w.date.toDate() : new Date(w.date);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  });
  const qualityChartData = {
    labels: qualityLabels,
    datasets: [{
      label: t('stats.aiQualityOverTime'),
      data: qualityWorkouts.map(w => w.technicalQuality),
      borderColor: '#10B981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      tension: 0.3,
      pointBackgroundColor: qualityWorkouts.map(w => w.technicalQuality >= 8 ? '#10B981' : w.technicalQuality >= 5 ? '#F59E0B' : '#EF4444'),
      pointRadius: 5,
    }]
  };
  const qualityChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, max: 10, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  };
  const avgQuality = qualityWorkouts.length > 0
    ? Math.round((qualityWorkouts.reduce((s, w) => s + w.technicalQuality, 0) / qualityWorkouts.length) * 10) / 10
    : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  };

  // === Game Stats ===
  const gameStats = useMemo(() => {
    if (games.length === 0) return null;
    const totalGoals = games.reduce((s, g) => s + (g.totalGoals || 0), 0);
    const totalFouls = games.reduce((s, g) => s + (g.totalFouls || 0), 0);
    const totalDuration = games.reduce((s, g) => s + (g.duration || 0), 0);
    const avgDuration = Math.round(totalDuration / games.length / 60);
    return { total: games.length, totalGoals, totalFouls, avgDuration };
  }, [games]);

  const goalsChartData = useMemo(() => {
    const recent = [...games].reverse().slice(-15);
    return {
      labels: recent.map((g, i) => `#${i + 1}`),
      datasets: [{
        label: t('game.goal'),
        data: recent.map(g => g.totalGoals || 0),
        backgroundColor: 'rgba(34, 197, 94, 0.7)',
        borderRadius: 6,
      }]
    };
  }, [games, t]);

  // === AI Summaries ===
  const recentSummaries = useMemo(() =>
    workouts.filter(w => w.aiSummary).slice(0, 5),
  [workouts]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
        <p className="mt-3 text-gray-500">{t('app.loading')}</p>
      </div>
    );
  }

  if (!stats && !gameStats) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <div className="text-6xl">&#128202;</div>
        <h1 className="text-2xl font-bold text-gray-800">{t('stats.title')}</h1>
        <p className="text-gray-500">{t('stats.noWorkouts')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t('stats.title')}</h1>

      {/* Tabs */}
      {gameStats && (
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('training')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'training' ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
            }`}
          >
            {t('nav.training')}
          </button>
          <button
            onClick={() => setActiveTab('games')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'games' ? 'bg-green-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-200 hover:border-green-300'
            }`}
          >
            {t('nav.game')} ({games.length})
          </button>
        </div>
      )}

      {/* === GAME STATS TAB === */}
      {activeTab === 'games' && gameStats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl shadow p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{gameStats.total}</div>
              <div className="text-xs text-gray-500">{t('stats.gameTotal')}</div>
            </div>
            <div className="bg-white rounded-xl shadow p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{gameStats.totalGoals}</div>
              <div className="text-xs text-gray-500">{t('stats.goalsScored')}</div>
            </div>
            <div className="bg-white rounded-xl shadow p-4 text-center">
              <div className="text-3xl font-bold text-yellow-600">{gameStats.totalFouls}</div>
              <div className="text-xs text-gray-500">{t('stats.foulsTotal')}</div>
            </div>
            <div className="bg-white rounded-xl shadow p-4 text-center">
              <div className="text-3xl font-bold text-purple-600">{gameStats.avgDuration}</div>
              <div className="text-xs text-gray-500">{t('stats.avgDuration')} ({t('stats.minutes')})</div>
            </div>
          </div>

          {/* Goals per game chart */}
          {games.length > 1 && (
            <div className="bg-white rounded-xl shadow p-4">
              <h3 className="text-sm font-medium text-gray-600 mb-2">{t('stats.goalsPerGame')}</h3>
              <div style={{ height: 200 }}>
                <Bar data={goalsChartData} options={chartOptions} />
              </div>
            </div>
          )}

          {/* Game history cards */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">{t('stats.gameHistory')}</h2>
            <div className="space-y-3">
              {games.map((game, i) => {
                const d = game.date?.toDate ? game.date.toDate() : new Date(game.date);
                return (
                  <div key={i} className="bg-white rounded-xl shadow p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{game.sportName || game.sport}</span>
                      <span className="text-xs text-gray-400">{d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</span>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-gray-800">{game.teamA?.score || 0} - {game.teamB?.score || 0}</div>
                      <div className="flex justify-center gap-6 mt-1 text-xs text-gray-500">
                        <span>{t('game.teamA')}</span>
                        <span>{t('game.teamB')}</span>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{game.totalGoals || 0} {t('stats.goalsLabel')}</span>
                      <span>{game.totalFouls || 0} {t('stats.foulsLabel')}</span>
                      <span>{Math.round((game.duration || 0) / 60)} {t('stats.minutes')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* === TRAINING STATS TAB === */}
      {activeTab === 'training' && stats && (
      <>
      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
          <div className="text-xs text-gray-500">{t('stats.totalWorkouts')}</div>
          <div className="flex justify-center gap-2 mt-1">
            <span className="text-xs text-green-600">{stats.completed} {t('stats.completed')}</span>
            {stats.partial > 0 && <span className="text-xs text-orange-500">{stats.partial} {t('stats.partial')}</span>}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-3xl font-bold text-orange-500">{stats.totalCalories.toLocaleString()}</div>
          <div className="text-xs text-gray-500">{t('stats.totalCalories')}</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-3xl font-bold text-purple-600">{stats.avgDuration}</div>
          <div className="text-xs text-gray-500">{t('stats.avgDuration')} ({t('stats.minutes')})</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{stats.streak}</div>
          <div className="text-xs text-gray-500">{t('stats.streak')} ({t('stats.days')})</div>
        </div>
      </div>

      {/* Charts */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">{t('stats.charts')}</h2>

        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="text-sm font-medium text-gray-600 mb-2">{t('stats.repsOverTime')}</h3>
          <div style={{ height: 200 }}>
            <Line data={repsChartData} options={chartOptions} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="text-sm font-medium text-gray-600 mb-2">{t('stats.caloriesOverTime')}</h3>
            <div style={{ height: 180 }}>
              <Bar data={caloriesChartData} options={chartOptions} />
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="text-sm font-medium text-gray-600 mb-2">{t('stats.durationOverTime')}</h3>
            <div style={{ height: 180 }}>
              <Line data={durationChartData} options={chartOptions} />
            </div>
          </div>
        </div>
      </div>

      {/* AI Quality Over Time */}
      {qualityWorkouts.length > 1 && (
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">{t('stats.aiQualityOverTime')}</h3>
            {avgQuality !== null && (
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                avgQuality >= 8 ? 'bg-green-100 text-green-700' : avgQuality >= 5 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
              }`}>
                {t('stats.avgQuality')}: {avgQuality}/10
              </span>
            )}
          </div>
          <div style={{ height: 220 }}>
            <Line data={qualityChartData} options={qualityChartOptions} />
          </div>
        </div>
      )}

      {/* Personal Bests */}
      {personalBests.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">{t('stats.personalBests')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {personalBests.map((pb, i) => (
              <div key={i} className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl p-4 text-center">
                <div className="text-2xl">&#127942;</div>
                <div className="text-xl font-bold text-orange-600">{pb.value}</div>
                <div className="text-xs text-gray-600 font-medium">{pb.name}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {pb.date.getDate()}/{pb.date.getMonth() + 1}/{pb.date.getFullYear()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Summaries */}
      {recentSummaries.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">{t('stats.recentSummaries')}</h2>
          <div className="space-y-3">
            {recentSummaries.map((w, i) => {
              const d = w.date?.toDate ? w.date.toDate() : new Date(w.date);
              return (
                <div key={i} className="bg-white rounded-xl shadow p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">{d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      w.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {w.status === 'completed' ? t('stats.completed') : t('stats.partial')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{w.aiSummary}</p>
                  <div className="flex gap-3 mt-2 text-xs text-gray-400">
                    <span>{Math.round((w.totalDuration || 0) / 60)} {t('stats.minutes')}</span>
                    <span>{w.totalCalories || 0} {t('stats.calories')}</span>
                    <span>{(w.exercises || []).length} {t('training.reps')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
