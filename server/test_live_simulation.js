/**
 * LIVE WET RUN — צחי יעקובי | בעיטת קביים (Crutch Kick)
 *
 * Simulates a real training session with 5-second rest between reps.
 * Sends real POST requests to /api/coach/analyze-rep + workout-summary.
 *
 * Usage: node test_live_simulation.js
 * Requires server running on port 3001
 */

const BASE_URL = 'http://localhost:3001/api/coach';
const REST_BETWEEN_REPS_MS = 5000;

const FAKE_FRAME = 'placeholder_frame';

const PLAYER_PROFILE = {
  name: 'צחי יעקובי',
  gender: 'male',
  age: 28,
  height: 178,
  weight: 74,
  disability: 'one_leg',
  amputationSide: 'right',
  amputationLevel: 'below_knee',
  mobilityAid: 'crutches',
  skillLevel: 'intermediate'
};

const SCENARIOS = [
  {
    label: '🟢 ביצוע מצוין (10/10)',
    repNumber: 1,
    previousScore: null,
    jointAngles: [
      { shoulder: 160, elbow: 158, hip: 170, knee: 175 },
      { shoulder: 105, elbow: 155, hip: 145, knee: 172 },
      { shoulder: 140, elbow: 150, hip: 160, knee: 170 }
    ],
    telemetry: [
      { type: 'trunkRotation', value: 38 },
      { type: 'crutchElbowStability', value: 155 }
    ]
  },
  {
    label: '🟡 ביצוע בינוני (6/10)',
    repNumber: 2,
    previousScore: 10,
    jointAngles: [
      { shoulder: 150, elbow: 140, hip: 165, knee: 170 },
      { shoulder: 75, elbow: 120, hip: 150, knee: 168 },
      { shoulder: 130, elbow: 135, hip: 158, knee: 165 }
    ],
    telemetry: [
      { type: 'trunkRotation', value: 22 },
      { type: 'crutchElbowStability', value: 120 }
    ]
  },
  {
    label: '🔴 ביצוע גרוע (3/10)',
    repNumber: 3,
    previousScore: 6,
    jointAngles: [
      { shoulder: 135, elbow: 110, hip: 155, knee: 160 },
      { shoulder: 48, elbow: 95, hip: 140, knee: 155 },
      { shoulder: 120, elbow: 100, hip: 150, knee: 158 }
    ],
    telemetry: [
      { type: 'trunkRotation', value: 12 },
      { type: 'crutchElbowStability', value: 95 }
    ]
  }
];

function ts() {
  return new Date().toLocaleTimeString('he-IL', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function countdown(seconds) {
  return new Promise(resolve => {
    let left = seconds;
    const bar = () => {
      const filled = '█'.repeat(seconds - left);
      const empty = '░'.repeat(left);
      process.stdout.write(`\r   ⏱️  מנוחה: ${filled}${empty} ${left}s `);
    };
    bar();
    const iv = setInterval(() => {
      left--;
      bar();
      if (left <= 0) { clearInterval(iv); process.stdout.write('\n'); resolve(); }
    }, 1000);
  });
}

async function sendRep(scenario) {
  const body = {
    playerName: PLAYER_PROFILE.name,
    exercise: 'בעיטת קביים',
    frames: [FAKE_FRAME, FAKE_FRAME],
    sport: 'footballAmputee',
    playerProfile: PLAYER_PROFILE,
    repNumber: scenario.repNumber,
    jointAngles: scenario.jointAngles,
    telemetry: scenario.telemetry,
    previousScore: scenario.previousScore
  };

  console.log(`\n${'═'.repeat(65)}`);
  console.log(`[${ts()}] 📤 REP #${scenario.repNumber} — ${scenario.label}`);
  console.log(`[${ts()}]    Exercise:  בעיטת קביים (Crutch Kick)`);
  console.log(`[${ts()}]    Player:    ${PLAYER_PROFILE.name}`);
  console.log(`[${ts()}]    Shoulder:  ${scenario.jointAngles[1].shoulder}° | Elbow: ${scenario.jointAngles[1].elbow}° | Hip: ${scenario.jointAngles[1].hip}°`);
  console.log(`[${ts()}]    Trunk Rot: ${scenario.telemetry[0].value}° | Prev Score: ${scenario.previousScore ?? '—'}`);
  console.log(`[${ts()}]    ⏳ Sending to Claude API...`);
  console.log(`${'─'.repeat(65)}`);

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/analyze-rep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();

  const scoreBar = '██'.repeat(data.score) + '░░'.repeat(10 - data.score);
  console.log(`[${ts()}] 📥 RESPONSE in ${elapsed}ms`);
  console.log(`[${ts()}]    ┌─────────────────────────────────────────────────────────┐`);
  console.log(`[${ts()}]    │ Score: ${scoreBar} ${String(data.score).padStart(2)}/10   │`);
  console.log(`[${ts()}]    │ Time:  ${elapsed}ms                                       │`);
  console.log(`[${ts()}]    └─────────────────────────────────────────────────────────┘`);
  console.log(`[${ts()}]    🗣️  Coach says:`);
  console.log(`[${ts()}]    "${data.instruction}"`);
  if (data.pro_tip) {
    console.log(`[${ts()}]    💡 Pro tip: "${data.pro_tip}"`);
  }
  console.log(`[${ts()}]    📐 Angles: shoulder=${data.angles?.shoulder}° elbow=${data.angles?.elbow}° hip=${data.angles?.hip}° knee=${data.angles?.knee}°`);
  console.log(`${'═'.repeat(65)}`);

  return { ...data, latency: elapsed, scenario: scenario.label };
}

async function sendWorkoutSummary(results) {
  console.log(`\n[${ts()}] 📊 Requesting AI workout summary...`);

  const sessionData = {
    exercises: [{
      name: 'בעיטת קביים',
      setsCompleted: 1,
      setsTarget: 1,
      reps: results.map(r => r.score),
      avgScore: +(results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1),
      formIssues: { crutchElbowCollapse: 3, noRotation: 2 }
    }],
    totalDuration: 45,
    sport: 'footballAmputee'
  };

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/workout-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: PLAYER_PROFILE, sessionData })
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();

  console.log(`[${ts()}] 📋 Summary received (${elapsed}ms):`);
  console.log(`${'─'.repeat(65)}`);
  console.log(`   ${data.summary}`);
  if (data.tips && data.tips.length > 0) {
    console.log(`\n   Tips:`);
    data.tips.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }
  console.log(`${'─'.repeat(65)}`);

  return { summary: data.summary, tips: data.tips, latency: elapsed };
}

async function main() {
  const sessionStart = Date.now();

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        🏋️  LIVE TRAINING SESSION — WET RUN                   ║');
  console.log('║        Player:   צחי יעקובי                                  ║');
  console.log('║        Sport:    כדורגל קטועים (Amputee Football)            ║');
  console.log('║        Exercise: בעיטת קביים (Crutch Kick)                   ║');
  console.log('║        Reps:     3 × realistic pace (5s rest)                ║');
  console.log('║        Server:   http://localhost:3001                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Health check
  try {
    const healthRes = await fetch(`${BASE_URL.replace('/coach', '')}/health`);
    const health = await healthRes.json();
    console.log(`\n[${ts()}] ✅ Server health: ${health.status}`);
  } catch (e) {
    console.error(`\n[${ts()}] ❌ Server not reachable! Start it with: npm start`);
    process.exit(1);
  }

  // Calibration warm-up (like real client does)
  console.log(`[${ts()}] 🔄 Sending calibration warm-up...`);
  await fetch(`${BASE_URL}/analyze-rep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise: 'calibration', playerName: PLAYER_PROFILE.name, frames: [] })
  });
  console.log(`[${ts()}] ✅ Server warmed up`);
  console.log(`[${ts()}] 🎬 SESSION START — בעיטת קביים, סט 1`);

  const results = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    try {
      const result = await sendRep(scenario);
      results.push(result);

      // Realistic 5-second rest between reps (skip after last)
      if (i < SCENARIOS.length - 1) {
        console.log('');
        await countdown(5);
      }
    } catch (err) {
      console.error(`[${ts()}] ❌ Error on ${scenario.label}:`, err.message);
      results.push({ score: 0, error: err.message, scenario: scenario.label, latency: 0 });
    }
  }

  // Workout summary from Claude
  console.log(`\n[${ts()}] 🏁 SET COMPLETE — requesting coach summary...`);
  const summaryResult = await sendWorkoutSummary(results);

  const sessionDuration = ((Date.now() - sessionStart) / 1000).toFixed(1);

  // Final summary
  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                  📊 SESSION REPORT                           ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  for (const r of results) {
    const bar = '██'.repeat(r.score) + '░░'.repeat(10 - r.score);
    console.log(`║  Rep ${r.scenario.slice(0, 2)} ${bar} ${String(r.score).padStart(2)}/10  ${String(r.latency).padStart(5)}ms ║`);
  }
  const avgScore = +(results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1);
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latency, 0) / results.length);
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Avg Score:    ${avgScore}/10                                        ║`);
  console.log(`║  Avg Latency:  ${avgLatency}ms                                        ║`);
  console.log(`║  Session Time: ${sessionDuration}s                                       ║`);
  console.log(`║  API Calls:    ${results.length} reps + 1 summary = ${results.length + 1} total              ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Firebase document
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              🔥 FIRESTORE DOCUMENT                           ║');
  console.log('║              users/{uid}/workouts/{auto_id}                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    dayLabel: 'יום ב׳ — טכניקה',
    sport: 'footballAmputee',
    location: 'field',
    equipment: ['none'],
    duration: Math.round(parseFloat(sessionDuration)),
    completed: true,
    exercises: [{
      name: 'בעיטת קביים',
      sets: 1,
      repsPerSet: [3],
      totalReps: 3,
      avgQuality: avgScore,
      qualityHistory: results.map(r => r.score),
      visionAnalysis: results.map((r, i) => ({
        rep: i + 1,
        set: 1,
        score: r.score,
        instruction: r.instruction || '',
        proTip: r.pro_tip || '',
        angles: r.angles || {},
        latency: r.latency
      })),
      formIssues: {
        crutchElbowCollapse: results.filter(r => r.score < 7).length * 2,
        noRotation: results.filter(r => r.score < 5).length
      }
    }],
    summary: {
      totalReps: 3,
      totalExercises: 1,
      avgQuality: avgScore,
      caloriesBurned: Math.round(avgScore * 5),
      aiSummary: summaryResult.summary
    },
    latency: {
      avgVisionMs: avgLatency,
      maxVisionMs: Math.max(...results.map(r => r.latency)),
      minVisionMs: Math.min(...results.map(r => r.latency)),
      summaryMs: summaryResult.latency,
      totalApiCalls: results.length + 1,
      modelUsed: 'claude-haiku-4-5-20251001'
    }
  }, null, 2));

  console.log(`\n[${ts()}] ✅ SESSION COMPLETE — server still running, waiting for next session...`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
