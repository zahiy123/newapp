import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { apiUrl } from '../utils/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function WorkoutSummary({ sessionData, profile, sport, isHe, onBackToPlan }) {
  const [aiSummary, setAiSummary] = useState('');
  const [proTips, setProTips] = useState([]);
  const [loading, setLoading] = useState(true);

  const exercises = sessionData?.exerciseResults || [];
  const totalReps = exercises.reduce((s, e) => s + (e.repsActual || 0), 0);
  const totalCalories = exercises.reduce((s, e) => s + (e.calories || 0), 0);
  const totalDuration = sessionData?.startTime
    ? Math.floor((Date.now() - sessionData.startTime) / 1000)
    : 0;

  // Overall quality
  const avgQ = exercises.length > 0
    ? exercises.reduce((s, e) => s + (e.quality === 'perfect' ? 3 : e.quality === 'good' ? 2 : 1), 0) / exercises.length
    : 1;
  const overall = avgQ >= 2.5 ? 'perfect' : avgQ >= 1.5 ? 'good' : 'needs_work';

  useEffect(() => {
    async function fetchSummary() {
      try {
        const resp = await fetch(apiUrl('/api/coach/workout-summary'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: { name: profile?.name, age: profile?.age, disability: profile?.disability },
            sessionData: { sport, status: 'completed', totalDuration, totalCalories, warmUpCompleted: sessionData?.warmUpCompleted, exercises }
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          setAiSummary(data.summary || '');
          setProTips(data.tips || []);
        }
      } catch (err) {
        console.error('Summary fetch failed:', err);
        setAiSummary(isHe ? 'אימון מצוין! המשך ככה.' : 'Great workout! Keep it up.');
      }
      setLoading(false);
    }
    fetchSummary();
  }, []);

  const chartData = {
    labels: exercises.map(e => e.name?.length > 12 ? e.name.slice(0, 12) + '...' : e.name),
    datasets: [
      {
        label: isHe ? 'מטרה' : 'Target',
        data: exercises.map(e => e.repsTarget || 0),
        backgroundColor: 'rgba(156,163,175,0.4)',
        borderRadius: 6,
      },
      {
        label: isHe ? 'בוצע' : 'Actual',
        data: exercises.map(e => e.repsActual || 0),
        backgroundColor: 'rgba(34,197,94,0.7)',
        borderRadius: 6,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { font: { size: 12 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-5">
      {/* Hero */}
      <div className="text-center space-y-3">
        <div className="text-6xl">&#127942;</div>
        <h1 className="text-3xl font-bold text-gray-800">
          {isHe ? 'אימון הושלם!' : 'Workout Complete!'}
        </h1>
        <div>
          {overall === 'perfect' && (
            <span className="inline-block px-4 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-full text-sm font-bold shadow">
              {isHe ? 'מושלם' : 'Perfect'}
            </span>
          )}
          {overall === 'good' && (
            <span className="inline-block px-4 py-1.5 bg-blue-500 text-white rounded-full text-sm font-bold shadow">
              {isHe ? 'טוב מאוד' : 'Great Job'}
            </span>
          )}
          {overall === 'needs_work' && (
            <span className="inline-block px-4 py-1.5 bg-gray-400 text-white rounded-full text-sm font-bold shadow">
              {isHe ? 'המשך לעבוד' : 'Keep Working'}
            </span>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{totalReps}</div>
          <div className="text-xs text-gray-500">{isHe ? 'חזרות' : 'Reps'}</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-2xl font-bold text-orange-500">{totalCalories}</div>
          <div className="text-xs text-gray-500">{isHe ? 'קלוריות' : 'Calories'}</div>
        </div>
        <div className="bg-white rounded-xl shadow p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">{Math.floor(totalDuration / 60)}</div>
          <div className="text-xs text-gray-500">{isHe ? 'דקות' : 'Minutes'}</div>
        </div>
      </div>

      {/* Performance chart */}
      {exercises.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">
            {isHe ? 'ביצועים לפי תרגיל' : 'Performance by Exercise'}
          </h3>
          <div style={{ height: Math.max(200, exercises.length * 40) }}>
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Exercise breakdown */}
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="text-sm font-semibold text-gray-600 mb-3">
          {isHe ? 'פירוט תרגילים' : 'Exercise Breakdown'}
        </h3>
        <div className="space-y-2">
          {exercises.map((ex, i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-800 truncate">{ex.name}</div>
                <div className="text-xs text-gray-500">
                  {ex.repsActual}/{ex.repsTarget} {isHe ? 'חזרות' : 'reps'} · {ex.setsCompleted}/{ex.setsTarget} {isHe ? 'סטים' : 'sets'}
                </div>
              </div>
              <span className="text-xl ml-2">
                {ex.quality === 'perfect' ? '⭐' : ex.quality === 'good' ? '👍' : '💪'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Coach Summary */}
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl shadow p-5 space-y-4">
        <h3 className="text-lg font-bold text-purple-900 flex items-center gap-2">
          <span>&#129302;</span>
          {isHe ? 'סיכום המאמן' : 'Coach Summary'}
        </h3>
        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin inline-block w-6 h-6 border-3 border-purple-500 border-t-transparent rounded-full"></div>
            <p className="mt-2 text-sm text-gray-500">{isHe ? 'המאמן מנתח...' : 'Coach analyzing...'}</p>
          </div>
        ) : (
          <>
            <p className="text-gray-700 leading-relaxed">{aiSummary}</p>
            {proTips.length > 0 && (
              <div className="border-t border-purple-200 pt-3">
                <h4 className="text-sm font-bold text-purple-800 mb-2">
                  {isHe ? 'טיפים לאימון הבא' : 'Tips for Next Session'}
                </h4>
                <ul className="space-y-1.5 text-sm text-gray-600">
                  {proTips.slice(0, 3).map((tip, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-purple-500 font-bold flex-shrink-0">{i + 1}.</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* Back button */}
      <button
        onClick={onBackToPlan}
        className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg shadow-lg hover:opacity-90 transition"
      >
        {isHe ? 'חזרה לתוכנית' : 'Back to Plan'}
      </button>
    </div>
  );
}
