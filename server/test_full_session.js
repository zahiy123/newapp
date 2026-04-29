/**
 * FULL TRAINING SESSION — צחי יעקובי | כדורגל קטועים
 *
 * Simulates a complete amputee football technique session:
 *   Warmup → Technique → Sport Drill → Strength → Cooldown
 *
 * Realistic features:
 *   - Fatigue model: quality degrades within each set, partially recovers between sets
 *   - 3s between reps (athlete performing), 15s rest between sets
 *   - 4 real exercises × 2-3 sets × 4-6 reps each
 *   - Workout summary from Claude at the end
 *
 * Usage: node test_full_session.js
 */

const BASE = 'http://localhost:3001/api/coach';

const PLAYER = {
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

// ═══════════════════════════════════════════════
// WORKOUT PLAN — field session, amputee football
// ═══════════════════════════════════════════════

const WORKOUT = [
  {
    name: 'סקוואט',
    english: 'Squat',
    type: 'strength',
    sets: 3, repsPerSet: 5,
    restBetweenSets: 15,
    // SCORING: joint='knee', phase=1, dir='lower', thresholds=[90,120]
    // Lower knee angle = deeper squat = better
    generateAngles: (quality) => {
      // quality 0-1 → knee angle at peak: 0=perfect(75°) 1=bad(135°)
      const knee = Math.round(75 + (1 - quality) * 60);
      const hip = Math.round(70 + (1 - quality) * 50);
      return [
        { shoulder: 160, elbow: 170, hip: 170, knee: 175 },  // start
        { shoulder: 155, elbow: 165, hip, knee },              // peak (bottom)
        { shoulder: 158, elbow: 168, hip: 165, knee: 170 }    // end
      ];
    }
  },
  {
    name: 'בעיטת קביים',
    english: 'Crutch Kick',
    type: 'technique',
    sets: 3, repsPerSet: 5,
    restBetweenSets: 15,
    // SCORING: joint='shoulder', phase=1, dir='higher', thresholds=[60,90]
    // Higher shoulder angle = more upright = better
    generateAngles: (quality) => {
      const shoulder = Math.round(40 + quality * 70);  // 40-110°
      const elbow = Math.round(90 + quality * 65);     // 90-155°
      const trunkRot = Math.round(10 + quality * 30);  // 10-40°
      return [
        { shoulder: 160, elbow: 155, hip: 170, knee: 175 },
        { shoulder, elbow, hip: Math.round(140 + quality * 20), knee: Math.round(155 + quality * 17) },
        { shoulder: 140, elbow: 145, hip: 160, knee: 170 }
      ];
    }
  },
  {
    name: 'שכיבות סמיכה',
    english: 'Push-up',
    type: 'strength',
    sets: 2, repsPerSet: 6,
    restBetweenSets: 15,
    // SCORING: joint='elbow', phase=1, dir='lower', thresholds=[90,120]
    // Lower elbow angle = deeper push-up = better
    generateAngles: (quality) => {
      const elbow = Math.round(70 + (1 - quality) * 60);  // 70-130°
      const shoulder = Math.round(40 + quality * 30);
      return [
        { shoulder: 170, elbow: 175, hip: 175, knee: 175 },
        { shoulder, elbow, hip: Math.round(165 + quality * 10), knee: 175 },
        { shoulder: 165, elbow: 170, hip: 172, knee: 175 }
      ];
    }
  },
  {
    name: 'פלאנק',
    english: 'Plank',
    type: 'hold',
    sets: 2, repsPerSet: 3,
    restBetweenSets: 15,
    // SCORING: joint='trunk', phase=0, dir='higher', thresholds=[160,175]
    // Higher trunk angle = straighter body = better
    generateAngles: (quality) => {
      const trunk = Math.round(145 + quality * 35);     // 145-180°
      const hip = Math.round(150 + quality * 25);
      return [
        { shoulder: 90, elbow: 90, hip, knee: 175, trunk },
        { shoulder: 85, elbow: 88, hip: Math.round(hip - 5), knee: 172, trunk: Math.round(trunk - 3) },
        { shoulder: 88, elbow: 87, hip: Math.round(hip - 8), knee: 170, trunk: Math.round(trunk - 6) }
      ];
    }
  }
];

// ═══════════════════════════════════════════════
// FATIGUE MODEL
// ═══════════════════════════════════════════════
// Quality starts at ~0.85 (nobody is perfect from rep 1)
// Drops ~0.06 per rep within a set (fatigue accumulates)
// Recovers ~60% of lost quality between sets (partial recovery)
// Global fatigue: each exercise drops baseline by 0.03

function buildFatigueProfile(sets, repsPerSet, exerciseIndex) {
  const globalFatigue = exerciseIndex * 0.03;
  const reps = [];
  let baseline = 0.88 - globalFatigue;

  for (let s = 0; s < sets; s++) {
    let q = baseline;
    for (let r = 0; r < repsPerSet; r++) {
      // Add slight randomness ±0.05
      const jitter = (Math.random() - 0.5) * 0.10;
      const final = Math.max(0.1, Math.min(1.0, q + jitter));
      reps.push({ set: s + 1, rep: r + 1, quality: final });
      q -= 0.06; // fatigue per rep
    }
    // Recovery between sets
    const lost = baseline - q;
    baseline = Math.max(0.3, baseline - 0.04); // slight overall drop
  }
  return reps;
}

// ═══════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════

function ts() {
  return new Date().toLocaleTimeString('he-IL', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function countdown(seconds, label) {
  return new Promise(resolve => {
    let left = seconds;
    const draw = () => {
      const filled = '█'.repeat(seconds - left);
      const empty = '░'.repeat(left);
      process.stdout.write(`\r   ⏱️  ${label}: ${filled}${empty} ${left}s  `);
    };
    draw();
    const iv = setInterval(() => {
      left--;
      draw();
      if (left <= 0) { clearInterval(iv); process.stdout.write('\n'); resolve(); }
    }, 1000);
  });
}

function qualityEmoji(score) {
  if (score >= 9) return '🟢';
  if (score >= 7) return '🟡';
  if (score >= 5) return '🟠';
  return '🔴';
}

function scoreBar(score) {
  return '██'.repeat(Math.min(score, 10)) + '░░'.repeat(Math.max(0, 10 - score));
}

// ═══════════════════════════════════════════════
// MAIN SESSION
// ═══════════════════════════════════════════════

async function main() {
  const sessionStart = Date.now();
  const allResults = [];  // { exercise, set, rep, score, instruction, proTip, angles, latency }

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  🏟️   FULL TRAINING SESSION — WET RUN                            ║');
  console.log('║  ─────────────────────────────────────────────────────────────── ║');
  console.log('║  Player:    צחי יעקובי | 28 | כדורגל קטועים                      ║');
  console.log('║  Disability: קטיעה מתחת לברך (ימין) + קביים                      ║');
  console.log('║  Location:  שדה (field) | Equipment: bodyweight                  ║');
  console.log('║  Plan:      סקוואט → בעיטת קביים → שכיבות סמיכה → פלאנק         ║');
  console.log('║  Total:     4 exercises × 2-3 sets × 3-6 reps = ~40 reps         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  // Health
  const hRes = await fetch(`${BASE.replace('/coach', '')}/health`);
  const h = await hRes.json();
  console.log(`\n[${ts()}] ✅ Server: ${h.status}`);

  // Calibration
  console.log(`[${ts()}] 🔄 Calibration warm-up...`);
  await fetch(`${BASE}/analyze-rep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise: 'calibration', playerName: PLAYER.name, frames: [] })
  });
  console.log(`[${ts()}] ✅ Server warmed up\n`);

  // ── WARMUP ──
  console.log(`${'━'.repeat(65)}`);
  console.log(`[${ts()}] 🔥 WARMUP — ריצה קלה + מתיחות דינמיות (simulated 8s)`);
  console.log(`${'━'.repeat(65)}`);
  await countdown(8, 'חימום');
  console.log(`[${ts()}] ✅ Warmup complete\n`);

  // ── EXERCISES ──
  for (let exIdx = 0; exIdx < WORKOUT.length; exIdx++) {
    const ex = WORKOUT[exIdx];
    const fatigueProfile = buildFatigueProfile(ex.sets, ex.repsPerSet, exIdx);
    let repGlobal = 0;
    let prevScore = null;

    console.log(`${'━'.repeat(65)}`);
    console.log(`[${ts()}] 🏋️  EXERCISE ${exIdx + 1}/4: ${ex.name} (${ex.english})`);
    console.log(`[${ts()}]    Type: ${ex.type} | Sets: ${ex.sets} × ${ex.repsPerSet} reps`);
    console.log(`${'━'.repeat(65)}`);

    for (let s = 0; s < ex.sets; s++) {
      console.log(`\n[${ts()}]    ── SET ${s + 1}/${ex.sets} ──`);

      for (let r = 0; r < ex.repsPerSet; r++) {
        const fp = fatigueProfile[repGlobal];
        const angles = ex.generateAngles(fp.quality);

        const body = {
          playerName: PLAYER.name,
          exercise: ex.name,
          frames: ['placeholder', 'placeholder'],
          sport: 'footballAmputee',
          playerProfile: PLAYER,
          repNumber: repGlobal + 1,
          jointAngles: angles,
          telemetry: [{ type: 'fatigue', value: +(fp.quality * 100).toFixed(0) }],
          previousScore: prevScore
        };

        const t0 = Date.now();
        const res = await fetch(`${BASE}/analyze-rep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const elapsed = Date.now() - t0;
        const data = await res.json();

        const emoji = qualityEmoji(data.score);
        const bar = scoreBar(data.score);
        console.log(`[${ts()}]    ${emoji} Rep ${r + 1}: ${bar} ${String(data.score).padStart(2)}/10  (${elapsed}ms)  "${(data.instruction || '—').slice(0, 60)}"`);

        allResults.push({
          exercise: ex.name,
          set: s + 1,
          rep: r + 1,
          score: data.score,
          instruction: data.instruction || '',
          proTip: data.pro_tip || '',
          angles: data.angles || {},
          latency: elapsed,
          quality: fp.quality
        });

        prevScore = data.score;
        repGlobal++;

        // 3s between reps (skip after last rep in set)
        if (r < ex.repsPerSet - 1) {
          await wait(3000);
        }
      }

      // Set summary
      const setResults = allResults.filter(r => r.exercise === ex.name && r.set === s + 1);
      const setAvg = +(setResults.reduce((a, r) => a + r.score, 0) / setResults.length).toFixed(1);
      console.log(`[${ts()}]    📊 Set ${s + 1} avg: ${setAvg}/10`);

      // Rest between sets
      if (s < ex.sets - 1) {
        console.log('');
        await countdown(ex.restBetweenSets, `מנוחה בין סטים`);
      }
    }

    // Exercise summary
    const exResults = allResults.filter(r => r.exercise === ex.name);
    const exAvg = +(exResults.reduce((a, r) => a + r.score, 0) / exResults.length).toFixed(1);
    const exBest = Math.max(...exResults.map(r => r.score));
    const exWorst = Math.min(...exResults.map(r => r.score));
    console.log(`\n[${ts()}]    ✅ ${ex.name} DONE — avg ${exAvg}/10 (best: ${exBest}, worst: ${exWorst})`);

    // Rest between exercises (except last)
    if (exIdx < WORKOUT.length - 1) {
      console.log('');
      await countdown(10, 'מעבר לתרגיל הבא');
    }
  }

  // ── COOLDOWN ──
  console.log(`\n${'━'.repeat(65)}`);
  console.log(`[${ts()}] 🧘 COOLDOWN — מתיחות סטטיות (simulated 5s)`);
  console.log(`${'━'.repeat(65)}`);
  await countdown(5, 'שחרור');
  console.log(`[${ts()}] ✅ Cooldown complete`);

  // ── WORKOUT SUMMARY ──
  console.log(`\n[${ts()}] 📊 Requesting AI workout summary from Claude...`);
  const exerciseSummaries = WORKOUT.map(ex => {
    const exResults = allResults.filter(r => r.exercise === ex.name);
    return {
      name: ex.name,
      setsCompleted: ex.sets,
      setsTarget: ex.sets,
      reps: exResults.map(r => r.score),
      avgScore: +(exResults.reduce((a, r) => a + r.score, 0) / exResults.length).toFixed(1),
      formIssues: {}
    };
  });

  const t0sum = Date.now();
  const sumRes = await fetch(`${BASE}/workout-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: PLAYER,
      sessionData: {
        exercises: exerciseSummaries,
        totalDuration: Math.round((Date.now() - sessionStart) / 1000),
        sport: 'footballAmputee'
      }
    })
  });
  const sumElapsed = Date.now() - t0sum;
  const sumData = await sumRes.json();

  console.log(`[${ts()}] 📋 Summary received (${sumElapsed}ms):\n`);
  console.log(`   ┌${'─'.repeat(63)}┐`);
  const lines = sumData.summary.split(/(?<=\.|!)\s+/);
  for (const line of lines) {
    console.log(`   │  ${line.padEnd(60)} │`);
  }
  console.log(`   └${'─'.repeat(63)}┘`);
  if (sumData.tips?.length) {
    console.log(`\n   💡 Tips:`);
    sumData.tips.forEach((t, i) => console.log(`      ${i + 1}. ${t}`));
  }

  const sessionDuration = ((Date.now() - sessionStart) / 1000).toFixed(0);
  const totalReps = allResults.length;
  const avgScore = +(allResults.reduce((a, r) => a + r.score, 0) / totalReps).toFixed(1);
  const avgLatency = Math.round(allResults.reduce((a, r) => a + r.latency, 0) / totalReps);

  // ── SESSION REPORT ──
  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     📊 SESSION REPORT                            ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');

  for (const ex of WORKOUT) {
    const exRes = allResults.filter(r => r.exercise === ex.name);
    const avg = +(exRes.reduce((a, r) => a + r.score, 0) / exRes.length).toFixed(1);
    const bar = scoreBar(Math.round(avg));
    console.log(`║  ${ex.name.padEnd(20)} ${bar}  ${String(avg).padStart(4)}/10 ║`);
  }

  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Reps:    ${String(totalReps).padEnd(6)}                                       ║`);
  console.log(`║  Avg Score:     ${String(avgScore).padEnd(6)}/10                                     ║`);
  console.log(`║  Avg Latency:   ${String(avgLatency + 'ms').padEnd(8)}                                   ║`);
  console.log(`║  Session Time:  ${String(sessionDuration + 's').padEnd(6)}                                     ║`);
  console.log(`║  API Calls:     ${String(totalReps + 1).padEnd(6)} (${totalReps} reps + 1 summary)              ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  // ── FIRESTORE DOCUMENT ──
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║              🔥 FIRESTORE DOCUMENT                               ║');
  console.log('║              users/{uid}/workouts/{auto_id}                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  const firestoreDoc = {
    date: new Date().toISOString(),
    dayLabel: 'יום ב׳ — טכניקה + כוח',
    sport: 'footballAmputee',
    location: 'field',
    equipment: ['none'],
    duration: parseInt(sessionDuration),
    completed: true,
    exercises: WORKOUT.map(ex => {
      const exRes = allResults.filter(r => r.exercise === ex.name);
      const sets = {};
      exRes.forEach(r => { if (!sets[r.set]) sets[r.set] = 0; sets[r.set]++; });
      return {
        name: ex.name,
        sets: ex.sets,
        repsPerSet: Object.values(sets),
        totalReps: exRes.length,
        avgQuality: +(exRes.reduce((a, r) => a + r.score, 0) / exRes.length).toFixed(1),
        qualityHistory: exRes.map(r => r.score),
        visionAnalysis: exRes.map(r => ({
          rep: r.rep, set: r.set, score: r.score,
          instruction: r.instruction, proTip: r.proTip,
          angles: r.angles, latency: r.latency
        }))
      };
    }),
    summary: {
      totalReps: totalReps,
      totalExercises: WORKOUT.length,
      avgQuality: avgScore,
      caloriesBurned: Math.round(totalReps * avgScore * 1.5),
      aiSummary: sumData.summary
    },
    latency: {
      avgVisionMs: avgLatency,
      maxVisionMs: Math.max(...allResults.map(r => r.latency)),
      minVisionMs: Math.min(...allResults.map(r => r.latency)),
      summaryMs: sumElapsed,
      totalApiCalls: totalReps + 1,
      modelUsed: 'claude-haiku-4-5-20251001'
    }
  };

  console.log(JSON.stringify(firestoreDoc, null, 2));

  console.log(`\n[${ts()}] ✅ SESSION COMPLETE — ${totalReps} reps across ${WORKOUT.length} exercises in ${sessionDuration}s`);
  console.log(`[${ts()}] 🏟️  Server still running — ready for next session.\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
