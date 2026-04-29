/**
 * LIVE DRY RUN — צחי יעקובי | בעיטת קביים (Crutch Kick)
 *
 * Sends 3 real POST requests to /api/coach/analyze-rep
 * with different joint angles simulating 10/10, 6/10, 3/10 quality.
 *
 * Usage: node test_live_simulation.js
 * Requires server running on port 3001
 */

const BASE_URL = 'http://localhost:3001/api/coach';

// Use short placeholder strings as frames.
// These pass the route's `frames.length >= 1` check but get filtered out
// by `cleanBase64().length > 500`, triggering the TEXT-ONLY analysis path.
// This is the same path used in production when camera frames are corrupted.
// The serverScore (from joint angles) drives the final score deterministically,
// and Claude provides Hebrew coaching text based on angles + biomechanics.
const FAKE_FRAME = 'placeholder_frame';

// Profile for צחי יעקובי
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

// 3 scenarios with different joint angles
const SCENARIOS = [
  {
    label: '🟢 ביצוע מצוין (10/10)',
    repNumber: 1,
    previousScore: null,
    // shoulder angle 105° → well above highThresh 90° → score 10
    jointAngles: [
      // Phase 0 (start/ready)
      { shoulder: 160, elbow: 158, hip: 170, knee: 175 },
      // Phase 1 (peak/strike) — THIS IS THE SCORING PHASE
      { shoulder: 105, elbow: 155, hip: 145, knee: 172 },
      // Phase 2 (follow-through)
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
    // shoulder angle 75° → between [60, 90] → score ~6
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
    // shoulder angle 48° → below lowThresh 60° → score ~3-4
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

async function sendRep(scenario) {
  const body = {
    playerName: PLAYER_PROFILE.name,
    exercise: 'בעיטת קביים',
    frames: [FAKE_FRAME, FAKE_FRAME], // 2 frames: start + peak
    sport: 'footballAmputee',
    playerProfile: PLAYER_PROFILE,
    repNumber: scenario.repNumber,
    jointAngles: scenario.jointAngles,
    telemetry: scenario.telemetry,
    previousScore: scenario.previousScore
  };

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📤 SENDING: ${scenario.label}`);
  console.log(`   Exercise: בעיטת קביים (Crutch Kick)`);
  console.log(`   Player: ${PLAYER_PROFILE.name}`);
  console.log(`   Rep #${scenario.repNumber}`);
  console.log(`   Shoulder angle (peak): ${scenario.jointAngles[1].shoulder}°`);
  console.log(`   Previous score: ${scenario.previousScore ?? 'N/A'}`);
  console.log(`${'─'.repeat(60)}`);

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/analyze-rep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const elapsed = Date.now() - t0;
  const data = await res.json();

  console.log(`\n📥 RESPONSE (${elapsed}ms):`);
  console.log(`   Score:       ${data.score}/10`);
  console.log(`   Instruction: ${data.instruction}`);
  console.log(`   Pro Tip:     ${data.pro_tip}`);
  console.log(`   Feedback:    ${data.feedback}`);
  console.log(`   Angles:      ${JSON.stringify(data.angles)}`);
  console.log(`   Latency:     ${elapsed}ms`);
  console.log(`${'═'.repeat(60)}`);

  return { ...data, latency: elapsed, scenario: scenario.label };
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     LIVE DRY RUN — צחי יעקובי | בעיטת קביים            ║');
  console.log('║     Server: http://localhost:3001                       ║');
  console.log('║     3 reps × 3 quality levels                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Health check
  try {
    const healthRes = await fetch(`${BASE_URL.replace('/coach', '')}/health`);
    const health = await healthRes.json();
    console.log(`\n✅ Server health: ${health.status}`);
  } catch (e) {
    console.error('\n❌ Server not reachable! Start it with: npm start');
    process.exit(1);
  }

  const results = [];

  for (const scenario of SCENARIOS) {
    try {
      const result = await sendRep(scenario);
      results.push(result);
      // Wait 1.5s between requests to avoid throttle (1s rate limit)
      if (scenario !== SCENARIOS[SCENARIOS.length - 1]) {
        console.log('\n⏳ Waiting 1.5s (rate limit cooldown)...');
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error(`❌ Error on ${scenario.label}:`, err.message);
      results.push({ score: 0, error: err.message, scenario: scenario.label, latency: 0 });
    }
  }

  // Summary
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                              ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  for (const r of results) {
    const bar = '█'.repeat(r.score) + '░'.repeat(10 - r.score);
    console.log(`║ ${r.scenario.padEnd(30)} ${bar} ${String(r.score).padStart(2)}/10  ${String(r.latency).padStart(4)}ms ║`);
  }
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latency, 0) / results.length);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║ Average latency: ${avgLatency}ms                                 ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Firebase document simulation
  console.log('\n\n📋 FIREBASE DOCUMENT (would be saved to users/{uid}/workouts/{id}):');
  console.log(JSON.stringify({
    date: new Date().toISOString(),
    sport: 'footballAmputee',
    exercise: 'בעיטת קביים',
    player: PLAYER_PROFILE.name,
    reps: results.map((r, i) => ({
      repNumber: i + 1,
      score: r.score,
      instruction: r.instruction,
      proTip: r.pro_tip,
      latencyMs: r.latency,
      angles: r.angles
    })),
    avgScore: +(results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1),
    avgLatencyMs: avgLatency
  }, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
