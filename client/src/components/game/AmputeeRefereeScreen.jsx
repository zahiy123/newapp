// THE AMPUTEE-FOOTBALL ASSISTANT REFEREE (Stage 5, owner 2026-11-04) — a phone on a tripod films the game:
//   setup (teams, the half length, the ends) → calibration (4 taps on the pitch) → the teams' shirt colours (a tap on
//   a player of each team) → LIVE: the scoreboard + the clock, the system's SUGGESTIONS (the referee confirms /
//   rejects / asks the VAR), the referee's own buttons, the event log → the full match report (+ the AI's VAR on
//   every flagged incident, the "deep analysis" right after the game — no cloud GPU).
// The camera / pose / ball models only feed engine/game/amputeeReferee.js (pitch metres); the score changes ONLY
// when the referee confirms.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCamera } from '../../hooks/useCamera';
import { useMultiPose } from '../../hooks/useMultiPose';
import { useBallDetection } from '../../hooks/useBallDetection';
import { useWhistle } from '../../hooks/useWhistle';
import { apiUrl, authFetch } from '../../utils/api';
import { db } from '../../services/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { createMatch, applyEvent, undoLast } from '../../engine/game/matchEngine';
import { createAmputeeReferee } from '../../engine/game/amputeeReferee';
import { homography, toPitch, calibrationTargets, AMPUTEE_PITCH } from '../../engine/game/pitch';
import { OFFENCES, RESTARTS, WAFF } from '../../engine/game/amputeeRules';

const vis = (p) => p && (p.visibility === undefined || p.visibility > 0.5);
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// the video's displayed rect (object-contain) → a tap / an overlay point in the video's normalized coordinates
function videoBox(video) {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth || 16; const vh = video.videoHeight || 9;
  const s = Math.min(r.width / vw, r.height / vh);
  const w = vw * s; const h = vh * s;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h };
}

// a pose → the referee's player: the ground point under the feet, the crutch tips (the forearm line extended to the
// ground), down or not, the shirt colour sample
function poseToPlayer(lm) {
  const feet = [27, 28, 29, 30, 31, 32].map(i => lm[i]).filter(vis);
  if (!feet.length) return null;
  const foot = feet.reduce((a, b) => (b.y > a.y ? b : a));
  const groundY = foot.y;
  const tips = [];
  for (const [e, w] of [[13, 15], [14, 16]]) {
    const el = lm[e]; const wr = lm[w];
    if (!vis(el) || !vis(wr)) continue;
    const dx = wr.x - el.x; const dy = wr.y - el.y;
    const k = dy > 0.005 ? Math.min(4, (groundY - wr.y) / dy) : 2.2;      // a forearm crutch ≈ 2.2 forearms long
    if (k > 0) tips.push({ x: wr.x + dx * k, y: wr.y + dy * k });
  }
  const sh = [lm[11], lm[12]].filter(vis); const hp = [lm[23], lm[24]].filter(vis);
  let lying = false;
  if (sh.length && hp.length) {
    const s = { x: sh.reduce((a, p) => a + p.x, 0) / sh.length, y: sh.reduce((a, p) => a + p.y, 0) / sh.length };
    const h = { x: hp.reduce((a, p) => a + p.x, 0) / hp.length, y: hp.reduce((a, p) => a + p.y, 0) / hp.length };
    lying = Math.abs(h.x - s.x) > Math.abs(h.y - s.y) * 1.2 || (groundY - h.y) < Math.abs(h.y - s.y) * 0.45;
  }
  return { foot: { x: foot.x, y: foot.y }, tips, lying, torso: hp.length && sh.length ? { x: (sh[0].x + hp[0].x) / 2, y: (sh[0].y + hp[0].y) / 2 } : null };
}

function sampleColor(video, nx, ny, ctxRef) {
  if (!video?.videoWidth) return null;
  if (!ctxRef.current) { const c = document.createElement('canvas'); c.width = 9; c.height = 9; ctxRef.current = c.getContext('2d', { willReadFrequently: true }); }
  const ctx = ctxRef.current;
  try {
    ctx.drawImage(video, Math.max(0, nx * video.videoWidth - 4), Math.max(0, ny * video.videoHeight - 4), 9, 9, 0, 0, 9, 9);
    const d = ctx.getImageData(0, 0, 9, 9).data;
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return { r: r / n, g: g / n, b: b / n };
  } catch { return null; }
}
const colorDist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

function snapshot(video, width = 480) {
  try {
    const c = document.createElement('canvas');
    const k = width / (video.videoWidth || width);
    c.width = Math.round((video.videoWidth || width) * k); c.height = Math.round((video.videoHeight || width * 0.56) * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6).split(',')[1];
  } catch { return null; }
}

function invert3(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

const KIND_TEXT = {
  goal: (s, t) => `⚽ גול ל${t[s.to]}?`,
  kick_in: (s, t) => `↔️ חוץ — בעיטה רגלית ל${s.to ? t[s.to] : '?'}`,
  corner: (s, t) => `🚩 קרן ל${t[s.to]}`,
  goal_kick: (s, t) => `🥅 בעיטת שער ל${t[s.to]} (מהרחבה)`,
  offence: (s, t) => `🟨 ${OFFENCES[s.offence]?.he} — ${t[s.against]}`,
  penalty: (s, t) => `🔴 פנדל ל${t[s.to]}! (${OFFENCES[s.offence]?.he} של ${t[s.against]} ברחבה)`,
};

export default function AmputeeRefereeScreen({ isHe = true, onExit }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const { videoRef, active: camOn, start: startCam, stop: stopCam } = useCamera();
  const { allPoses, startLoop: startPose, stopLoop: stopPose } = useMultiPose(canvasRef);
  const { getBallData, startLoop: startBall, stopLoop: stopBall } = useBallDetection('football');
  const { shortWhistle, longWhistle, goalHorn } = useWhistle();

  const [step, setStep] = useState('setup');             // setup → calibrate → colors → live → report
  const [teams, setTeams] = useState({ A: 'קבוצה א׳', B: 'קבוצה ב׳' });
  const [preset, setPreset] = useState('full');
  const [aSide, setASide] = useState('left');
  const [taps, setTaps] = useState([]);
  const [markers, setMarkers] = useState([]);              // the tapped points on screen (for the yellow dots)
  const [H, setH] = useState(null);
  const [colors, setColors] = useState({ A: null, B: null });
  const [match, setMatch] = useState(() => createMatch('footballAmputee'));
  const [suggestions, setSuggestions] = useState([]);       // pending — the referee decides
  const [decided, setDecided] = useState([]);               // { s, verdict: 'confirmed' | 'rejected', var }
  const [clock, setClock] = useState(0);
  const [running, setRunning] = useState(false);
  const [picker, setPicker] = useState(null);               // the referee's manual offence picker
  const [msg, setMsg] = useState('');
  const refRef = useRef(null);
  const colorCtx = useRef(null);
  const t0 = useRef(0);                                  // the engine's clock origin (set when the camera starts)

  const targets = useMemo(() => calibrationTargets(preset), [preset]);
  const Hinv = useMemo(() => (H ? invert3(H) : null), [H]);

  // the camera + the models
  useEffect(() => { startCam(); return () => { stopPose(); stopBall(); stopCam(); }; }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = videoRef.current;
    if (!camOn || !v) return;
    const go = () => { t0.current = performance.now(); startPose(v); startBall(v, 3); };
    if (v.readyState >= 2) go(); else v.addEventListener('loadeddata', go, { once: true });
  }, [camOn]);                                                                                      // eslint-disable-line react-hooks/exhaustive-deps

  // the referee engine, with the ends the referee chose
  useEffect(() => { refRef.current = createAmputeeReferee({ sides: { A: aSide, B: aSide === 'left' ? 'right' : 'left' } }); }, [aSide]);

  // the clock (stoppages: the referee pauses it)
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setClock(c => c + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  // the half's time is up → a long whistle (the referee ends the half — stoppage time is theirs)
  const halfOver = clock >= WAFF.halfMin * 60;
  useEffect(() => { if (running && clock === WAFF.halfMin * 60) longWhistle?.(); }, [clock, running]);   // eslint-disable-line react-hooks/exhaustive-deps

  function drawOverlay(players, ball) {
    const cv = overlayRef.current; const v = videoRef.current;
    if (!cv || !v || !Hinv) return;
    const box = videoBox(v); const host = cv.parentElement.getBoundingClientRect();
    cv.width = host.width; cv.height = host.height;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const toScreen = (pt) => { const q = toPitch(Hinv, pt.x, pt.y); return q ? [box.left - host.left + q.x * box.w, box.top - host.top + q.y * box.h] : null; };
    const P = AMPUTEE_PITCH; const W = P.width;
    const line = (pts, color) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); pts.map(toScreen).forEach((p, i) => p && (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke(); };
    line([{ x: 0, y: 0 }, { x: P.length, y: 0 }, { x: P.length, y: W }, { x: 0, y: W }, { x: 0, y: 0 }], 'rgba(255,255,255,0.7)');
    line([{ x: P.length / 2, y: 0 }, { x: P.length / 2, y: W }], 'rgba(255,255,255,0.5)');
    for (const [x0, x1] of [[0, P.goalAreaDepth], [P.length, P.length - P.goalAreaDepth]]) {
      line([{ x: x0, y: W / 2 - 5 }, { x: x1, y: W / 2 - 5 }, { x: x1, y: W / 2 + 5 }, { x: x0, y: W / 2 + 5 }], 'rgba(255,230,0,0.8)');
      line([{ x: x0, y: W / 2 - P.goalWidth / 2 }, { x: x0, y: W / 2 + P.goalWidth / 2 }], 'rgba(255,60,60,0.95)');
    }
    for (const r of refRef.current.rolesAndTeams()) {
      const s = toScreen(r.foot); if (!s) continue;
      ctx.fillStyle = r.team === 'A' ? '#2563eb' : r.team === 'B' ? '#dc2626' : '#9ca3af';
      ctx.beginPath(); ctx.arc(s[0], s[1], r.role === 'gk' ? 9 : 6, 0, Math.PI * 2); ctx.fill();
      if (r.role === 'gk') { ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3; ctx.stroke(); }
    }
    if (ball) { const s = toScreen(ball); if (s) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s[0], s[1], 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } }
    void players;
  }

  // EVERY POSE FRAME → the engine (pitch metres) → suggestions
  useEffect(() => {
    if (step !== 'live' || !H || !refRef.current || !running) return;
    const v = videoRef.current;
    const players = [];
    for (const pose of allPoses) {
      const p = poseToPlayer(pose.landmarks);
      if (!p) continue;
      const foot = toPitch(H, p.foot.x, p.foot.y);
      if (!foot) continue;
      let team = null;
      if (p.torso && colors.A && colors.B) {
        const c = sampleColor(v, p.torso.x, p.torso.y, colorCtx);
        if (c) team = colorDist(c, colors.A) < colorDist(c, colors.B) ? 'A' : 'B';
      }
      players.push({ foot, crutchTips: p.tips.map(t => toPitch(H, t.x, t.y)).filter(Boolean), lying: p.lying, team });
    }
    const b = getBallData();
    const ball = b?.detected ? toPitch(H, b.x, b.y + b.h / 2) : null;
    const now = performance.now() - t0.current;
    const fresh = refRef.current.update({ t: now, ball, players });
    if (fresh.length) {
      shortWhistle?.();
      const snap = snapshot(v);
      setSuggestions(prev => [...fresh.map(s => ({ ...s, frame: snap, clock })), ...prev].slice(0, 12));
    }
    drawOverlay(players, ball);
  }, [allPoses]);                                                                                   // eslint-disable-line react-hooks/exhaustive-deps


  // the referee taps on the video: the calibration points / the team colours
  function onTap(e) {
    const v = videoRef.current; if (!v) return;
    const box = videoBox(v);
    const nx = (e.clientX - box.left) / box.w; const ny = (e.clientY - box.top) / box.h;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    if (step === 'calibrate') {
      const next = [...taps, [nx, ny]];
      const host = v.parentElement.getBoundingClientRect();
      setMarkers([...markers, { left: e.clientX - host.left, top: e.clientY - host.top }]);
      setTaps(next);
      if (next.length === 4) {
        const h = homography(next, targets);
        if (h) { setH(h); setStep('colors'); setMsg(''); setMarkers([]); } else { setTaps([]); setMarkers([]); setMsg('הנקודות לא יוצרות מגרש — נסה שוב'); }
      }
    } else if (step === 'colors') {
      const c = sampleColor(v, nx, ny, colorCtx);
      if (!c) return;
      if (!colors.A) setColors({ ...colors, A: c });
      else { setColors({ ...colors, B: c }); setStep('live'); }
    }
  }

  // ---------------- the referee's decisions ----------------
  const eventsOf = (s) => {
    switch (s.kind) {
      case 'goal': return [{ type: 'goal', team: s.to }];
      case 'kick_in': case 'corner': case 'goal_kick': return [{ type: s.kind, team: s.to }];
      default: return [
        { type: 'foul', team: s.against, offence: s.offence, restart: s.restart },
        ...(s.card ? [{ type: 'card', team: s.against, color: s.card }] : []),
        ...(s.restart === 'PK' ? [{ type: 'penalty', team: s.to }] : []),
      ];
    }
  };
  function confirm(s) {
    let m = match;
    for (const ev of eventsOf(s)) m = applyEvent(m, { ...ev, source: 'suggested', clock: s.clock });
    setMatch(m);
    refRef.current?.confirm(s);
    if (['goal', 'kick_in', 'corner', 'goal_kick'].includes(s.kind)) refRef.current?.restart();
    if (s.kind === 'goal') goalHorn?.();
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    setDecided(prev => [...prev, { s, verdict: 'confirmed' }]);
  }
  function reject(s) {
    if (['goal', 'kick_in', 'corner', 'goal_kick'].includes(s.kind)) refRef.current?.restart();
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    setDecided(prev => [...prev, { s, verdict: 'rejected' }]);
  }
  async function askVar(s) {
    setSuggestions(prev => prev.map(x => (x.id === s.id ? { ...x, varPending: true } : x)));
    const v = await runVar(s);
    setSuggestions(prev => prev.map(x => (x.id === s.id ? { ...x, varPending: false, var: v } : x)));
  }
  async function runVar(s) {
    if (!s.frame) return { reason: 'אין תמונה' };
    try {
      const r = await authFetch(apiUrl('/api/coach/analyze-var'), { method: 'POST', body: JSON.stringify({ frame: s.frame, sport: 'footballAmputee', triggerReason: KIND_TEXT[s.kind]?.(s, teams) || s.kind, incident: s.kind, offence: s.offence || null }) });
      return await r.json();
    } catch { return { reason: 'ה-VAR לא זמין כרגע' }; }
  }
  const manual = (ev) => setMatch(m => applyEvent(m, { ...ev, source: 'referee', clock }));
  function endPeriod() {
    setRunning(false);
    manual({ type: 'period_end' });
    refRef.current?.swapSides();
    setClock(0);
    longWhistle?.();
  }

  // ---------------- the report (+ the AI VAR on every flagged incident) ----------------
  const [report, setReport] = useState(null);
  async function finish() {
    setRunning(false);
    setStep('report');
    const flagged = decided.filter(d => d.s.kind === 'offence' || d.s.kind === 'penalty' || d.s.kind === 'goal');
    const deep = [];
    for (const d of flagged.slice(0, 15)) deep.push({ ...d, var: d.var || await runVar(d.s) });
    const byTeam = (team) => ({
      goals: match.score[team],
      fouls: match.log.filter(e => e.type === 'foul' && e.team === team).length,
      cards: match.log.filter(e => e.type === 'card' && e.team === team).map(e => e.color),
      corners: match.log.filter(e => e.type === 'corner' && e.team === team).length,
      kickIns: match.log.filter(e => e.type === 'kick_in' && e.team === team).length,
    });
    const r = {
      sport: 'footballAmputee', teams, score: match.score, A: byTeam('A'), B: byTeam('B'),
      suggestions: { confirmed: decided.filter(d => d.verdict === 'confirmed').length, rejected: decided.filter(d => d.verdict === 'rejected').length },
      deep: deep.map(d => ({ kind: d.s.kind, offence: d.s.offence || null, team: d.s.against || d.s.to, clock: d.s.clock, verdict: d.verdict, confidence: d.s.confidence, var: d.var ? { isFoul: d.var.isFoul ?? null, reason: d.var.reason || '' } : null })),
      log: match.log.map(e => ({ type: e.type, team: e.team, offence: e.offence || null, color: e.color || null, clock: e.clock ?? null, source: e.source, rejected: e.rejected || null })),
    };
    setReport(r);
    if (user) addDoc(collection(db, 'users', user.uid, 'games'), { ...r, date: serverTimestamp(), mode: 'assistant_referee' }).catch(() => {});
  }

  // ---------------- the UI ----------------
  const tapHint = step === 'calibrate'
    ? (isHe ? `הקש על נקודה ${taps.length + 1} מתוך 4: ${['השמאלית הרחוקה', 'הימנית הרחוקה', 'הימנית הקרובה', 'השמאלית הקרובה'][taps.length]} של ${preset === 'full' ? 'המגרש' : 'חצי המגרש'}` : `Tap point ${taps.length + 1} of 4`)
    : step === 'colors' ? (isHe ? `הקש על החולצה של שחקן מ${colors.A ? teams.B : teams.A}` : 'Tap a player’s shirt') : null;

  if (step === 'report' && report) {
    return (
      <div dir={isHe ? 'rtl' : 'ltr'} className="max-w-2xl mx-auto space-y-4 p-4">
        <h2 className="text-2xl font-extrabold text-gray-900">{'📋'} {isHe ? 'דוח המשחק' : 'Match report'}</h2>
        <div className="bg-white rounded-xl shadow p-4 text-center text-3xl font-extrabold tabular-nums">{teams.A} {report.score.A} – {report.score.B} {teams.B}</div>
        <div className="grid grid-cols-2 gap-3">
          {['A', 'B'].map(t => (
            <div key={t} className="bg-white rounded-xl shadow p-3 text-sm space-y-1">
              <div className="font-bold">{teams[t]}</div>
              <div>{isHe ? 'עבירות' : 'Fouls'}: {report[t].fouls} · {isHe ? 'קרנות' : 'Corners'}: {report[t].corners} · {isHe ? 'חוצים' : 'Kick-ins'}: {report[t].kickIns}</div>
              <div>{isHe ? 'כרטיסים' : 'Cards'}: {report[t].cards.map(c => (c === 'red' ? '🟥' : '🟨')).join(' ') || '—'}</div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl shadow p-4 space-y-2">
          <div className="font-bold">{'🔎'} {isHe ? 'ניתוח עמוק — כל אירוע שסומן, עם בדיקת VAR' : 'Deep analysis — every flagged incident, with the VAR'}</div>
          <div className="text-xs text-gray-500">{isHe ? `הצעות המערכת: ${report.suggestions.confirmed} אושרו · ${report.suggestions.rejected} נדחו` : ''}</div>
          {report.deep.map((d, i) => (
            <div key={i} className="text-sm border-t pt-2">
              <span className="tabular-nums text-gray-500">{d.clock != null ? fmtClock(d.clock) : ''}</span> · {d.kind === 'goal' ? '⚽ גול' : OFFENCES[d.offence]?.he} · {teams[d.team]} · {d.verdict === 'confirmed' ? '✓ אושר' : '✕ נדחה'}
              {d.var && <div className="text-xs text-gray-700">VAR: {d.var.isFoul === true ? 'עבירה' : d.var.isFoul === false ? 'לא עבירה' : ''} — {d.var.reason}</div>}
            </div>
          ))}
          {!report.deep.length && <div className="text-sm text-gray-500">{isHe ? 'לא היו אירועים שסומנו.' : 'No flagged incidents.'}</div>}
        </div>
        <button onClick={onExit} className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold">{isHe ? 'סיום' : 'Done'}</button>
      </div>
    );
  }

  return (
    <div dir={isHe ? 'rtl' : 'ltr'} className="space-y-3">
      {step === 'setup' && (
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="text-lg font-bold">{'🧑‍⚖️'} {isHe ? 'שופט עזר חכם — כדורגל קטועים' : 'Assistant referee — amputee football'}</h2>
          <p className="text-sm text-gray-600">{isHe ? 'הטלפון על חצובה בצד המגרש. המערכת מציעה החלטות לפי חוקי WAFF, ואתה מאשר. התוצאה משתנה רק באישור שלך.' : 'The phone on a tripod by the pitch. The system suggests decisions by the WAFF laws; you confirm.'}</p>
          <div className="grid grid-cols-2 gap-2">
            {['A', 'B'].map(t => (
              <div key={t}>
                <label htmlFor={`team-${t}`} className="block text-xs text-gray-500">{isHe ? `שם ${t === 'A' ? 'קבוצה א׳' : 'קבוצה ב׳'}` : `Team ${t}`}</label>
                <input id={`team-${t}`} value={teams[t]} maxLength={20} onChange={e => setTeams({ ...teams, [t]: e.target.value })} className="w-full border rounded-lg px-2 py-1.5" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label htmlFor="ref-preset">{isHe ? 'מה המצלמה רואה' : 'The camera sees'}
              <select id="ref-preset" value={preset} onChange={e => setPreset(e.target.value)} className="w-full border rounded-lg px-2 py-1.5">
                <option value="full">{isHe ? 'את כל המגרש' : 'The whole pitch'}</option>
                <option value="leftHalf">{isHe ? 'את החצי השמאלי' : 'The left half'}</option>
                <option value="rightHalf">{isHe ? 'את החצי הימני' : 'The right half'}</option>
              </select>
            </label>
            <label htmlFor="ref-side">{isHe ? `${teams.A} מגנה על השער` : `${teams.A} defends`}
              <select id="ref-side" value={aSide} onChange={e => setASide(e.target.value)} className="w-full border rounded-lg px-2 py-1.5">
                <option value="left">{isHe ? 'השמאלי (במסך)' : 'Left (on screen)'}</option>
                <option value="right">{isHe ? 'הימני (במסך)' : 'Right (on screen)'}</option>
              </select>
            </label>
          </div>
          <div className="text-xs text-gray-500">{isHe ? `חוקים: ${WAFF.players} מול ${WAFF.players} · 2×${WAFF.halfMin} דק׳ · אין נבדל · חוץ בבעיטה · קב = יד · אסור תיקול גלישה · השוער לא יוצא מהרחבה (10×8 מ׳) · פסק זמן אחד לקבוצה במחצית · עד 2 חילופים בבת אחת` : ''}</div>
          <div className="flex gap-2">
            <button onClick={() => { setTaps([]); setMarkers([]); setStep('calibrate'); }} className="flex-1 py-2.5 rounded-xl bg-emerald-700 text-white font-bold">{isHe ? 'המשך — כיול המגרש' : 'Next — calibrate'}</button>
            <button onClick={onExit} className="px-4 py-2.5 rounded-xl border">{isHe ? 'חזרה' : 'Back'}</button>
          </div>
        </div>
      )}

      {step !== 'setup' && (
        <>
          {step === 'live' && (
            <div className="bg-gray-900 text-white rounded-xl px-4 py-2 flex items-center justify-between gap-2">
              <span className="font-bold">{teams.A}</span>
              <span className="text-2xl font-extrabold tabular-nums">{match.score.A} – {match.score.B}</span>
              <span className="font-bold">{teams.B}</span>
              <span className="tabular-nums text-sm bg-white/10 rounded px-2">{isHe ? `מחצית ${match.period}` : `H${match.period}`} · {fmtClock(clock)}</span>
              <button onClick={() => setRunning(r => !r)} className={`text-sm font-bold rounded px-3 py-1 ${running ? 'bg-amber-500' : 'bg-emerald-600'}`}>{running ? (isHe ? '⏸ עצירה' : '⏸') : (isHe ? '▶ משחק' : '▶')}</button>
            </div>
          )}
          <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }} onPointerDown={onTap}>
            <video ref={videoRef} className="w-full h-full object-contain" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none" />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            {tapHint && <div className="absolute top-2 inset-x-2 text-center"><span className="bg-black/75 text-white text-sm font-semibold rounded-lg px-3 py-1.5 inline-block">{tapHint}</span></div>}
            {step === 'calibrate' && markers.map((m, i) => (
              <span key={i} className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-yellow-400 border-2 border-black pointer-events-none" style={{ left: m.left, top: m.top }} />
            ))}
          </div>
          {msg && <div className="text-sm bg-amber-50 text-amber-900 rounded-lg px-3 py-2">{msg}</div>}
          {step === 'live' && halfOver && <div className="text-sm bg-amber-50 text-amber-900 rounded-lg px-3 py-2">{'⏱️'} {isHe ? `${WAFF.halfMin} דקות — סוף המחצית? (לחץ "סיום מחצית" כשתחליט)` : 'Time — end of the half?'}</div>}
        </>
      )}

      {step === 'live' && (
        <>
          {/* the system's suggestions — the referee decides */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              {suggestions.map(s => (
                <div key={s.id} className={`rounded-xl border-2 p-3 bg-white ${s.kind === 'penalty' ? 'border-red-600' : s.kind === 'goal' ? 'border-emerald-600' : 'border-amber-400'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900">{KIND_TEXT[s.kind]?.(s, teams)}</div>
                      <div className="text-xs text-gray-600">
                        {s.restart && RESTARTS[s.restart] ? `${RESTARTS[s.restart].he}${s.card ? ` · ${s.card === 'red' ? '🟥 אדום' : '🟨 צהוב'}` : ''} · ` : ''}
                        {isHe ? `ביטחון ${Math.round((s.confidence || 0) * 100)}%` : `${Math.round((s.confidence || 0) * 100)}%`} · {fmtClock(s.clock || 0)}
                      </div>
                      {s.note && <div className="text-xs text-gray-700">{s.note}</div>}
                      {s.var && <div className="text-xs text-indigo-800">VAR: {s.var.isFoul === true ? 'עבירה' : s.var.isFoul === false ? 'לא עבירה' : ''} — {s.var.reason}</div>}
                    </div>
                    {s.frame && <img src={`data:image/jpeg;base64,${s.frame}`} alt="" className="w-20 rounded" />}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => confirm(s)} className="flex-1 py-2 rounded-lg bg-emerald-700 text-white font-bold text-sm">{'✓'} {isHe ? 'אשר' : 'Confirm'}</button>
                    <button onClick={() => reject(s)} className="flex-1 py-2 rounded-lg border font-bold text-sm">{'✕'} {isHe ? 'דחה' : 'Reject'}</button>
                    <button disabled={s.varPending} onClick={() => askVar(s)} className="px-3 py-2 rounded-lg bg-indigo-700 text-white font-bold text-sm disabled:opacity-50">{s.varPending ? '…' : '🎥 VAR'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* the referee's own decisions */}
          <div className="bg-white rounded-xl shadow p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {['A', 'B'].map(t => (
                <button key={t} onClick={() => { manual({ type: 'goal', team: t }); refRef.current?.restart(); goalHorn?.(); }} className={`py-2.5 rounded-lg font-bold text-white ${t === 'A' ? 'bg-blue-600' : 'bg-red-600'}`}>{'⚽'} {isHe ? `גול ל${teams[t]}` : `Goal ${teams[t]}`}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 text-sm">
              <button onClick={() => setPicker({ team: 'A' })} className="px-3 py-1.5 rounded-lg border">{'🟨'} {isHe ? `עבירה של ${teams.A}` : `Foul ${teams.A}`}</button>
              <button onClick={() => setPicker({ team: 'B' })} className="px-3 py-1.5 rounded-lg border">{'🟨'} {isHe ? `עבירה של ${teams.B}` : `Foul ${teams.B}`}</button>
              {['A', 'B'].map(t => <button key={`ki${t}`} onClick={() => { manual({ type: 'kick_in', team: t }); refRef.current?.restart(); }} className="px-3 py-1.5 rounded-lg border">{'↔️'} {isHe ? `חוץ ל${teams[t]}` : `Kick-in ${teams[t]}`}</button>)}
              {['A', 'B'].map(t => <button key={`c${t}`} onClick={() => { manual({ type: 'corner', team: t }); refRef.current?.restart(); }} className="px-3 py-1.5 rounded-lg border">{'🚩'} {isHe ? `קרן ל${teams[t]}` : `Corner ${teams[t]}`}</button>)}
              {['A', 'B'].map(t => <button key={`gk${t}`} onClick={() => { manual({ type: 'goal_kick', team: t }); refRef.current?.restart(); }} className="px-3 py-1.5 rounded-lg border">{'🥅'} {isHe ? `בעיטת שער ל${teams[t]}` : `Goal kick ${teams[t]}`}</button>)}
              {['A', 'B'].map(t => <button key={`to${t}`} onClick={() => { manual({ type: 'timeout', team: t }); setRunning(false); }} className="px-3 py-1.5 rounded-lg border">{'⏸'} {isHe ? `פסק זמן ${teams[t]}` : `Time-out ${teams[t]}`}</button>)}
              {['A', 'B'].map(t => <button key={`s${t}`} onClick={() => manual({ type: 'substitution', team: t, count: 1 })} className="px-3 py-1.5 rounded-lg border">{'🔁'} {isHe ? `חילוף ${teams[t]}` : `Sub ${teams[t]}`}</button>)}
              <button onClick={() => setMatch(m => undoLast(m))} className="px-3 py-1.5 rounded-lg border text-rose-700">{'↶'} {isHe ? 'בטל אחרון' : 'Undo'}</button>
            </div>
            {picker && (
              <div className="rounded-lg bg-amber-50 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{isHe ? `עבירה של ${teams[picker.team]}:` : `Offence by ${teams[picker.team]}:`}</div>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={!!picker.inArea} onChange={e => setPicker({ ...picker, inArea: e.target.checked })} />
                    {isHe ? 'בתוך הרחבה שלהם (→ פנדל)' : 'Inside their own area (→ penalty)'}
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(OFFENCES).map(([id, o]) => (
                    <button key={id} onClick={() => {
                      const pk = !!picker.inArea && o.penaltyInOwnArea && o.restart === 'DFK';
                      manual({ type: 'foul', team: picker.team, offence: id, restart: pk ? 'PK' : o.restart });
                      if (o.card) manual({ type: 'card', team: picker.team, color: o.card });
                      if (pk) manual({ type: 'penalty', team: picker.team === 'A' ? 'B' : 'A' });
                      setPicker(null);
                    }} className="text-xs rounded-full px-2.5 py-1 border bg-white">{o.he}</button>
                  ))}
                  <button onClick={() => { manual({ type: 'penalty', team: picker.team === 'A' ? 'B' : 'A' }); setPicker(null); }} className="text-xs rounded-full px-2.5 py-1 bg-red-600 text-white">{isHe ? 'פנדל נגדם' : 'Penalty against'}</button>
                  <button onClick={() => setPicker(null)} className="text-xs underline">{isHe ? 'ביטול' : 'Cancel'}</button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={endPeriod} className="flex-1 py-2 rounded-lg bg-gray-800 text-white font-bold text-sm">{isHe ? (match.period >= 2 ? 'סיום מחצית / הארכה' : 'סיום מחצית') : 'End of half'}</button>
              <button onClick={finish} className="flex-1 py-2 rounded-lg bg-emerald-700 text-white font-bold text-sm">{isHe ? 'סיום המשחק ודוח' : 'End + report'}</button>
            </div>
          </div>

          {/* the event log */}
          <div className="bg-white rounded-xl shadow p-3 text-sm max-h-48 overflow-y-auto">
            {[...match.log].reverse().map((e, i) => (
              <div key={i} className="flex gap-2 border-b last:border-0 py-1">
                <span className="tabular-nums text-gray-500 w-12">{e.clock != null ? fmtClock(e.clock) : ''}</span>
                <span className="flex-1">{e.type === 'foul' ? `${OFFENCES[e.offence]?.he || 'עבירה'} (${e.restart === 'PK' ? 'פנדל' : RESTARTS[e.restart]?.he || ''})` : e.type === 'card' ? (e.color === 'red' ? '🟥' : '🟨') : { goal: '⚽ גול', kick_in: '↔️ חוץ', corner: '🚩 קרן', goal_kick: '🥅 בעיטת שער', penalty: '🔴 פנדל', timeout: '⏸ פסק זמן', substitution: '🔁 חילוף', period_end: '🔔 סוף מחצית' }[e.type] || e.type} · {teams[e.team]}{e.source === 'suggested' ? ' · 🤖' : ''}{e.rejected ? ` · ⛔ ${e.rejected === 'timeout_used' ? 'כבר נוצל פסק זמן במחצית' : 'עד 2 חילופים בבת אחת'}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
