// Final Acceptance Test — 12 HTTP POST requests to Render
const tinyJpeg = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/SFhSRFEj/9oADAMBAAIRAxEAPwC0AAAAAP/Z';
const placeholder = tinyJpeg.repeat(3);

const scenarios = [
  // FOOTBALL - KICK
  { exercise: '\u05D1\u05E2\u05D9\u05D8\u05D4', sport: 'football', label: 'excellent',
    jointAngles: [{ knee: 155, hip: 170 }, { knee: 42, hip: 95 }, { knee: 68, hip: 130 }],
    telemetry: [
      {23:{x:0.521,y:0.612,z:-0.03},25:{x:0.498,y:0.801,z:-0.02},27:{x:0.482,y:0.955,z:0.01}},
      {23:{x:0.519,y:0.598,z:-0.04},25:{x:0.387,y:0.645,z:-0.08},27:{x:0.301,y:0.421,z:-0.12}},
      {23:{x:0.515,y:0.601,z:-0.03},25:{x:0.342,y:0.512,z:-0.15},27:{x:0.285,y:0.298,z:-0.18}}
    ]},
  { exercise: '\u05D1\u05E2\u05D9\u05D8\u05D4', sport: 'football', label: 'mediocre',
    jointAngles: [{ knee: 150, hip: 165 }, { knee: 78, hip: 120 }, { knee: 110, hip: 150 }],
    telemetry: [
      {23:{x:0.520,y:0.615,z:-0.02},25:{x:0.505,y:0.790,z:-0.01},27:{x:0.490,y:0.940,z:0.01}},
      {23:{x:0.518,y:0.610,z:-0.03},25:{x:0.445,y:0.720,z:-0.04},27:{x:0.410,y:0.580,z:-0.06}},
      {23:{x:0.516,y:0.612,z:-0.02},25:{x:0.420,y:0.690,z:-0.05},27:{x:0.380,y:0.520,z:-0.07}}
    ]},
  { exercise: '\u05D1\u05E2\u05D9\u05D8\u05D4', sport: 'football', label: 'bad',
    jointAngles: [{ knee: 148, hip: 160 }, { knee: 95, hip: 140 }, { knee: 125, hip: 155 }],
    telemetry: [
      {23:{x:0.525,y:0.610,z:-0.02},25:{x:0.510,y:0.800,z:-0.01},27:{x:0.495,y:0.950,z:0.01}},
      {23:{x:0.540,y:0.580,z:-0.08},25:{x:0.490,y:0.760,z:-0.02},27:{x:0.470,y:0.850,z:-0.01}},
      {23:{x:0.555,y:0.570,z:-0.10},25:{x:0.480,y:0.740,z:-0.01},27:{x:0.460,y:0.800,z:0.00}}
    ]},

  // AMPUTEE FOOTBALL - CRUTCH BALANCE
  { exercise: '\u05D9\u05E6\u05D9\u05D1\u05D5\u05EA \u05E7\u05D1\u05D9\u05D9\u05DD', sport: 'footballAmputee', label: 'excellent',
    jointAngles: [{ trunk: 5, hip: 175 }, { trunk: 4, hip: 176 }, { trunk: 5, hip: 175 }],
    telemetry: [
      {11:{x:0.450,y:0.320,z:-0.05},12:{x:0.550,y:0.321,z:-0.05},23:{x:0.460,y:0.520,z:-0.03},24:{x:0.540,y:0.521,z:-0.03}},
      {11:{x:0.451,y:0.319,z:-0.05},12:{x:0.549,y:0.320,z:-0.05},23:{x:0.461,y:0.519,z:-0.03},24:{x:0.539,y:0.520,z:-0.03}},
      {11:{x:0.450,y:0.320,z:-0.05},12:{x:0.550,y:0.321,z:-0.05},23:{x:0.460,y:0.520,z:-0.03},24:{x:0.540,y:0.521,z:-0.03}}
    ]},
  { exercise: '\u05D9\u05E6\u05D9\u05D1\u05D5\u05EA \u05E7\u05D1\u05D9\u05D9\u05DD', sport: 'footballAmputee', label: 'mediocre',
    jointAngles: [{ trunk: 18, hip: 165 }, { trunk: 20, hip: 160 }, { trunk: 16, hip: 168 }],
    telemetry: [
      {11:{x:0.440,y:0.325,z:-0.05},12:{x:0.560,y:0.330,z:-0.06},23:{x:0.455,y:0.525,z:-0.03},24:{x:0.545,y:0.530,z:-0.04}},
      {11:{x:0.460,y:0.315,z:-0.04},12:{x:0.540,y:0.320,z:-0.05},23:{x:0.470,y:0.515,z:-0.02},24:{x:0.530,y:0.520,z:-0.03}},
      {11:{x:0.445,y:0.322,z:-0.05},12:{x:0.555,y:0.327,z:-0.06},23:{x:0.458,y:0.522,z:-0.03},24:{x:0.542,y:0.527,z:-0.04}}
    ]},
  { exercise: '\u05D9\u05E6\u05D9\u05D1\u05D5\u05EA \u05E7\u05D1\u05D9\u05D9\u05DD', sport: 'footballAmputee', label: 'bad',
    jointAngles: [{ trunk: 32, hip: 150 }, { trunk: 35, hip: 145 }, { trunk: 30, hip: 152 }],
    telemetry: [
      {11:{x:0.420,y:0.340,z:-0.08},12:{x:0.580,y:0.350,z:-0.09},23:{x:0.440,y:0.540,z:-0.05},24:{x:0.560,y:0.550,z:-0.06}},
      {11:{x:0.480,y:0.300,z:-0.03},12:{x:0.520,y:0.310,z:-0.04},23:{x:0.490,y:0.500,z:-0.01},24:{x:0.510,y:0.510,z:-0.02}},
      {11:{x:0.430,y:0.335,z:-0.07},12:{x:0.570,y:0.345,z:-0.08},23:{x:0.445,y:0.535,z:-0.04},24:{x:0.555,y:0.545,z:-0.05}}
    ]},

  // FITNESS - PUSH-UP
  { exercise: '\u05E9\u05DB\u05D9\u05D1\u05D5\u05EA \u05E1\u05DE\u05D9\u05DB\u05D4', sport: 'fitness', label: 'excellent',
    jointAngles: [{ elbow: 172, shoulder: 80 }, { elbow: 82, shoulder: 45 }, { elbow: 170, shoulder: 78 }],
    telemetry: [
      {11:{x:0.400,y:0.350,z:-0.10},12:{x:0.600,y:0.351,z:-0.10},13:{x:0.380,y:0.450,z:-0.08},14:{x:0.620,y:0.451,z:-0.08},15:{x:0.370,y:0.550,z:-0.05},16:{x:0.630,y:0.551,z:-0.05},23:{x:0.450,y:0.600,z:-0.10},24:{x:0.550,y:0.601,z:-0.10}},
      {11:{x:0.400,y:0.420,z:-0.02},12:{x:0.600,y:0.421,z:-0.02},13:{x:0.360,y:0.480,z:-0.01},14:{x:0.640,y:0.481,z:-0.01},15:{x:0.370,y:0.550,z:-0.05},16:{x:0.630,y:0.551,z:-0.05},23:{x:0.450,y:0.620,z:-0.02},24:{x:0.550,y:0.621,z:-0.02}},
      {11:{x:0.400,y:0.352,z:-0.10},12:{x:0.600,y:0.353,z:-0.10},13:{x:0.382,y:0.452,z:-0.08},14:{x:0.618,y:0.453,z:-0.08},15:{x:0.370,y:0.550,z:-0.05},16:{x:0.630,y:0.551,z:-0.05},23:{x:0.450,y:0.602,z:-0.10},24:{x:0.550,y:0.603,z:-0.10}}
    ]},
  { exercise: '\u05E9\u05DB\u05D9\u05D1\u05D5\u05EA \u05E1\u05DE\u05D9\u05DB\u05D4', sport: 'fitness', label: 'mediocre',
    jointAngles: [{ elbow: 170, shoulder: 78 }, { elbow: 112, shoulder: 60 }, { elbow: 168, shoulder: 76 }],
    telemetry: [
      {11:{x:0.400,y:0.350,z:-0.10},12:{x:0.600,y:0.351,z:-0.10},13:{x:0.380,y:0.440,z:-0.08},14:{x:0.620,y:0.441,z:-0.08},23:{x:0.450,y:0.600,z:-0.10},24:{x:0.550,y:0.601,z:-0.10}},
      {11:{x:0.400,y:0.390,z:-0.05},12:{x:0.600,y:0.391,z:-0.05},13:{x:0.370,y:0.460,z:-0.04},14:{x:0.630,y:0.461,z:-0.04},23:{x:0.450,y:0.610,z:-0.05},24:{x:0.550,y:0.611,z:-0.05}},
      {11:{x:0.400,y:0.352,z:-0.10},12:{x:0.600,y:0.353,z:-0.10},13:{x:0.381,y:0.442,z:-0.08},14:{x:0.619,y:0.443,z:-0.08},23:{x:0.450,y:0.602,z:-0.10},24:{x:0.550,y:0.603,z:-0.10}}
    ]},
  { exercise: '\u05E9\u05DB\u05D9\u05D1\u05D5\u05EA \u05E1\u05DE\u05D9\u05DB\u05D4', sport: 'fitness', label: 'bad',
    jointAngles: [{ elbow: 168, shoulder: 75 }, { elbow: 130, shoulder: 65 }, { elbow: 165, shoulder: 73 }],
    telemetry: [
      {11:{x:0.400,y:0.350,z:-0.10},12:{x:0.600,y:0.351,z:-0.10},13:{x:0.385,y:0.435,z:-0.08},14:{x:0.615,y:0.436,z:-0.08},23:{x:0.450,y:0.550,z:-0.15},24:{x:0.550,y:0.551,z:-0.15}},
      {11:{x:0.400,y:0.380,z:-0.06},12:{x:0.600,y:0.381,z:-0.06},13:{x:0.378,y:0.450,z:-0.05},14:{x:0.622,y:0.451,z:-0.05},23:{x:0.450,y:0.530,z:-0.18},24:{x:0.550,y:0.531,z:-0.18}},
      {11:{x:0.400,y:0.352,z:-0.10},12:{x:0.600,y:0.353,z:-0.10},13:{x:0.386,y:0.437,z:-0.08},14:{x:0.614,y:0.438,z:-0.08},23:{x:0.450,y:0.552,z:-0.15},24:{x:0.550,y:0.553,z:-0.15}}
    ]},

  // BASKETBALL - SHOOT
  { exercise: '\u05D6\u05E8\u05D9\u05E7\u05D4', sport: 'basketball', label: 'excellent',
    jointAngles: [{ elbow: 88, shoulder: 90 }, { elbow: 135, shoulder: 120 }, { elbow: 168, shoulder: 160 }],
    telemetry: [
      {11:{x:0.450,y:0.350,z:-0.05},13:{x:0.430,y:0.450,z:-0.04},15:{x:0.435,y:0.350,z:-0.03}},
      {11:{x:0.450,y:0.340,z:-0.05},13:{x:0.435,y:0.380,z:-0.04},15:{x:0.438,y:0.280,z:-0.06}},
      {11:{x:0.450,y:0.335,z:-0.05},13:{x:0.440,y:0.310,z:-0.04},15:{x:0.442,y:0.200,z:-0.10}}
    ]},
  { exercise: '\u05D6\u05E8\u05D9\u05E7\u05D4', sport: 'basketball', label: 'mediocre',
    jointAngles: [{ elbow: 85, shoulder: 88 }, { elbow: 120, shoulder: 110 }, { elbow: 145, shoulder: 140 }],
    telemetry: [
      {11:{x:0.450,y:0.350,z:-0.05},13:{x:0.428,y:0.455,z:-0.04},15:{x:0.430,y:0.360,z:-0.03}},
      {11:{x:0.450,y:0.345,z:-0.05},13:{x:0.432,y:0.400,z:-0.04},15:{x:0.434,y:0.310,z:-0.05}},
      {11:{x:0.450,y:0.340,z:-0.05},13:{x:0.438,y:0.350,z:-0.04},15:{x:0.440,y:0.260,z:-0.07}}
    ]},
  { exercise: '\u05D6\u05E8\u05D9\u05E7\u05D4', sport: 'basketball', label: 'bad',
    jointAngles: [{ elbow: 80, shoulder: 85 }, { elbow: 105, shoulder: 100 }, { elbow: 115, shoulder: 110 }],
    telemetry: [
      {11:{x:0.450,y:0.350,z:-0.05},13:{x:0.400,y:0.460,z:-0.04},15:{x:0.380,y:0.370,z:-0.03}},
      {11:{x:0.450,y:0.348,z:-0.05},13:{x:0.390,y:0.420,z:-0.04},15:{x:0.370,y:0.340,z:-0.04}},
      {11:{x:0.450,y:0.345,z:-0.05},13:{x:0.385,y:0.390,z:-0.04},15:{x:0.365,y:0.310,z:-0.06}}
    ]}
];

const url = 'https://newapp-nujg.onrender.com/api/coach/analyze-rep';

async function sendOne(s, i) {
  const body = {
    frames: [placeholder, placeholder, placeholder],
    jointAngles: s.jointAngles,
    telemetry: s.telemetry,
    sport: s.sport,
    exercise: s.exercise,
    playerProfile: { name: 'זאהי' },
    playerName: 'זאהי',
    repNumber: i + 1,
    qaMode: true
  };

  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    const elapsed = Date.now() - t0;
    console.log(`[${String(i+1).padStart(2)}/12] ${s.label.padEnd(9)} | ${s.exercise.padEnd(14)} | score=${data.score} | issue=${(data.issue_key||'none').padEnd(20)} | instruction="${data.instruction}" | pro_tip="${data.pro_tip}" | ${elapsed}ms`);
    return data;
  } catch(e) {
    console.error(`[${i+1}/12] FAILED ${s.exercise} (${s.label}): ${e.message}`);
    return null;
  }
}

console.log('========================================================');
console.log('  FINAL ACCEPTANCE TEST — 12 requests to Render');
console.log('  URL:', url);
console.log('========================================================\n');

for (let i = 0; i < scenarios.length; i++) {
  await sendOne(scenarios[i], i);
  if (i < scenarios.length - 1) await new Promise(r => setTimeout(r, 2000));
}

console.log('\n========================================================');
console.log('  DONE — Check Render logs for [COACH-RESULT] lines');
console.log('========================================================');
