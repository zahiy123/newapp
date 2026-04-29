/**
 * RENDER LIVE SIMULATION — 6 reps only
 * 2 exercises × 3 reps each, targeting production Render server.
 */

const BASE = 'https://newapp-nujg.onrender.com/api/coach';

const PLAYER = {
  name: 'צחי יעקובי', gender: 'male', age: 28, height: 178, weight: 74,
  disability: 'one_leg', amputationSide: 'right', amputationLevel: 'below_knee',
  mobilityAid: 'crutches', skillLevel: 'intermediate'
};

// Placeholder frames — filtered out by server's >500 char check,
// triggering text-only analysis path where serverScore (from angles)
// drives the score deterministically. This is the production fallback
// path used when camera frames are corrupted or unavailable.
// Real Vision requires actual JPEG camera frames from the client app.
const PLACEHOLDER = 'test_frame';

function ts() {
  return new Date().toLocaleTimeString('he-IL', { hour12: false });
}

const REPS = [
  // ── בעיטת קביים ──
  { exercise: 'בעיטת קביים', rep: 1, label: '🟢 10/10', prev: null,
    angles: [
      { shoulder: 160, elbow: 158, hip: 170, knee: 175 },
      { shoulder: 105, elbow: 155, hip: 145, knee: 172 },
      { shoulder: 140, elbow: 150, hip: 160, knee: 170 }
    ]},
  { exercise: 'בעיטת קביים', rep: 2, label: '🟡 6/10', prev: 10,
    angles: [
      { shoulder: 150, elbow: 140, hip: 165, knee: 170 },
      { shoulder: 75, elbow: 120, hip: 150, knee: 168 },
      { shoulder: 130, elbow: 135, hip: 158, knee: 165 }
    ]},
  { exercise: 'בעיטת קביים', rep: 3, label: '🔴 3/10', prev: 6,
    angles: [
      { shoulder: 135, elbow: 110, hip: 155, knee: 160 },
      { shoulder: 48, elbow: 95, hip: 140, knee: 155 },
      { shoulder: 120, elbow: 100, hip: 150, knee: 158 }
    ]},
  // ── דריבל ──
  { exercise: 'דריבל', rep: 1, label: '🟢 10/10', prev: null,
    angles: [
      { shoulder: 160, elbow: 155, hip: 170, knee: 170, trunk: 178 },
      { shoulder: 155, elbow: 150, hip: 165, knee: 168, trunk: 175 },
      { shoulder: 158, elbow: 152, hip: 168, knee: 170, trunk: 176 }
    ]},
  { exercise: 'דריבל', rep: 2, label: '🟡 6/10', prev: 10,
    angles: [
      { shoulder: 150, elbow: 140, hip: 160, knee: 165, trunk: 168 },
      { shoulder: 145, elbow: 135, hip: 155, knee: 160, trunk: 163 },
      { shoulder: 148, elbow: 138, hip: 158, knee: 162, trunk: 165 }
    ]},
  { exercise: 'דריבל', rep: 3, label: '🔴 3/10', prev: 6,
    angles: [
      { shoulder: 140, elbow: 120, hip: 150, knee: 155, trunk: 155 },
      { shoulder: 135, elbow: 110, hip: 145, knee: 150, trunk: 150 },
      { shoulder: 138, elbow: 115, hip: 148, knee: 152, trunk: 152 }
    ]}
];

async function sendRep(r, idx) {
  const body = {
    playerName: PLAYER.name,
    exercise: r.exercise,
    frames: [PLACEHOLDER, PLACEHOLDER],
    sport: 'footballAmputee',
    playerProfile: PLAYER,
    repNumber: r.rep,
    jointAngles: r.angles,
    telemetry: [],
    previousScore: r.prev
  };

  console.log(`\n[${ts()}] ═══ REP ${idx + 1}/6: ${r.exercise} — ${r.label} ═══`);
  console.log(`[${ts()}] 📤 Sending to Render...`);

  const t0 = Date.now();
  const res = await fetch(`${BASE}/analyze-rep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const ms = Date.now() - t0;
  const data = await res.json();

  const bar = '██'.repeat(data.score) + '░░'.repeat(10 - data.score);
  console.log(`[${ts()}] 📥 Response: ${ms}ms`);
  console.log(`[${ts()}]    Score: ${bar} ${data.score}/10`);
  console.log(`[${ts()}]    🗣️  "${data.instruction || '—'}"`);
  console.log(`[${ts()}]    💡  "${data.pro_tip || '—'}"`);
  console.log(`[${ts()}]    📐  ${JSON.stringify(data.angles)}`);

  return { ...data, latency: ms };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  🌐 RENDER PRODUCTION — LIVE 6-REP SIMULATION       ║');
  console.log('║  Server: newapp-nujg.onrender.com                    ║');
  console.log('║  Player: צחי יעקובי | כדורגל קטועים                  ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  // Health
  const h = await fetch(`${BASE.replace('/coach', '')}/health`);
  console.log(`\n[${ts()}] ✅ Render health: ${(await h.json()).status}`);

  // Calibration
  await fetch(`${BASE}/analyze-rep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise: 'calibration', playerName: PLAYER.name, frames: [] })
  });
  console.log(`[${ts()}] ✅ Calibration done`);

  const results = [];
  for (let i = 0; i < REPS.length; i++) {
    const data = await sendRep(REPS[i], i);
    results.push({ exercise: REPS[i].exercise, label: REPS[i].label, ...data });

    // Wait 2s between reps (rate limit cooldown)
    if (i < REPS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Summary
  console.log('\n\n╔═══════════════════════════════════════════════════════╗');
  console.log('║                 📊 RESULTS                            ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  for (const r of results) {
    const bar = '██'.repeat(r.score) + '░░'.repeat(10 - r.score);
    const name = r.exercise.padEnd(16);
    console.log(`║ ${name} ${r.label.slice(0,2)} ${bar} ${String(r.score).padStart(2)}/10 ${String(r.latency).padStart(5)}ms ║`);
  }
  const avg = Math.round(results.reduce((a, r) => a + r.latency, 0) / results.length);
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║ Avg latency: ${avg}ms                                  ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
