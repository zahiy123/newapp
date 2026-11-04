// ============================================================
// amputeeReferee — the assistant referee of an amputee-football game (Stage 5, owner 2026-11-04)
//
// PURE + model-agnostic: it reads, per frame, positions ON THE PITCH (metres — pitch.js maps the camera to the
// pitch): the ball, and each player's foot point, crutch tips, whether they are down, their team / role votes.
// It SUGGESTS (never decides — the referee confirms) the owner's 8 points:
//   1 fouls: a slide tackle, a crutch strike on an opponent, a fallen player playing the ball
//   2 penalties: a defender's direct-free-kick offence inside their own goal area → a PENALTY alert
//   3 goals: the ball crossing a goal line BETWEEN THE POSTS (the height under the 2.2 m bar cannot be seen from one
//     camera — the suggestion says so)
//   4 kick-ins: the ball over a touch line → a kick-in for the opponent of the last toucher
//   5 goal kicks / corners: over a goal line outside the posts → a goal kick (the attackers touched last) / a corner
//   6 teams + roles: each track's team by shirt-colour votes; the goalkeeper = mostly inside a goal area + no crutches
//   7 crutch hand-pass: the ball deflected by a CRUTCH tip — INTENTIONAL (the crutch moved to the ball, then the ball
//     was controlled / trapped / directed by that player) vs incidental (a static crutch, the ball rolls on) — only
//     the intentional one is suggested as an offence
//   8 the other laws: the keeper actively playing outside the goal area (1st yellow / 2nd red), no offside, …
// Every suggestion carries the decision of the WAFF laws (amputeeRules.decide) and a confidence.
// ============================================================

import { AMPUTEE_PITCH, inGoalArea, betweenPosts, exitOf, dist, defendedSide } from './pitch.js';
import { decide, goalLineDecision, touchLineDecision } from './amputeeRules.js';

export const T = {
  trackMatch: 2.5,          // m — a detection joins the nearest track within this
  trackForget: 1500,        // ms — a track unseen this long is dropped
  touchAngle: 35,           // degrees — a ball direction change this big = a touch
  touchSpeedJump: 4,        // m/s — or a speed change this big
  footReach: 1.5,           // m — the toucher's foot within this of the ball
  crutchReach: 0.6,         // m — a crutch tip within this = a crutch contact
  intentWindow: 800,        // ms — after a crutch contact: was the ball then controlled?
  slideSpeed: 2,            // m/s — a player going down at speed near the ball / an opponent
  strikeTipSpeed: 3.5,      // m/s — a crutch tip swung this fast into an opponent
  gkOutside: 0.5,           // m — the keeper's foot this far outside the goal area
  gkActive: 3,              // m — … with the ball this close (actively playing)
  gkHold: 500,              // ms
  outHoldFrames: 2,
};

const other = (t) => (t === 'A' ? 'B' : 'A');
const vote = (votes) => { let best = null; let n = 0; for (const [k, v] of Object.entries(votes)) if (v > n) { best = k; n = v; } return best; };

export function createAmputeeReferee({ pitch = AMPUTEE_PITCH, sides = { A: 'left', B: 'right' } } = {}) {
  let nextId = 1;
  let seq = 1;
  const tracks = new Map();         // id → { id, foot, hist:[{t,x,y}], tips:[{t,pts}], lying, teamVotes, roleVotes, inAreaN, n, crutchN, last }
  const ball = { hist: [], inside: false, outN: 0, out: false, insideSince: 0 };
  let lastTouch = null;             // { t, trackId, team, by, at:{x,y}, lying }
  const pending = [];               // crutch contacts awaiting the intent window
  const cooldown = new Map();       // key → until (ms)
  const gkIncidents = { A: 0, B: 0 };
  const gkOut = new Map();          // trackId → since
  const state = { sides: { ...sides } };

  const teamOf = (tr) => vote(tr.teamVotes);
  const roleOf = (tr) => {
    // the goalkeeper: mostly inside a goal area and (almost) never on crutches
    if (tr.n >= 10 && tr.inAreaN / tr.n > 0.7 && tr.crutchN / tr.n < 0.2) return 'gk';
    return vote(tr.roleVotes) || 'field';
  };
  const cool = (key, t, ms) => { if ((cooldown.get(key) || 0) > t) return false; cooldown.set(key, t + ms); return true; };
  const speedOf = (hist, ms = 400) => {
    if (hist.length < 2) return 0;
    const a = hist[hist.length - 1];
    const b = [...hist].reverse().find(h => a.t - h.t >= ms) || hist[0];
    return a.t > b.t ? Math.hypot(a.x - b.x, a.y - b.y) / ((a.t - b.t) / 1000) : 0;
  };
  const suggest = (s) => ({ id: `s${seq++}`, ...s });
  const offence = (t, offenceId, tr, at, confidence, note) => {
    const team = teamOf(tr);
    if (!team) return null;
    const own = defendedSide(state.sides, team);
    const d = decide(offenceId, team, { inOwnGoalArea: inGoalArea(at, own, pitch, 0.3), inOpponentGoalArea: inGoalArea(at, defendedSide(state.sides, other(team)), pitch, 0.3), gkPriorOutside: offenceId === 'gk_outside' ? gkIncidents[team] : 0 });
    return suggest({ t, kind: d.restart === 'PK' ? 'penalty' : 'offence', ...d, trackId: tr.id, location: { ...at }, confidence: Math.round(confidence * 100) / 100, note: note || null });
  };

  function associate(t, players) {
    const used = new Set();
    for (const p of players) {
      if (!p?.foot) continue;
      let best = null; let bd = T.trackMatch;
      for (const tr of tracks.values()) {
        if (used.has(tr.id)) continue;
        const d = dist(tr.foot, p.foot);
        if (d < bd) { bd = d; best = tr; }
      }
      const tr = best || { id: nextId++, hist: [], tips: [], teamVotes: {}, roleVotes: {}, inAreaN: 0, n: 0, crutchN: 0 };
      used.add(tr.id);
      tr.foot = { ...p.foot }; tr.last = t; tr.lying = !!p.lying; tr.n += 1;
      tr.hist.push({ t, x: p.foot.x, y: p.foot.y }); if (tr.hist.length > 30) tr.hist.shift();
      const tips = (p.crutchTips || []).filter(Boolean);
      tr.tips.push({ t, pts: tips }); if (tr.tips.length > 15) tr.tips.shift();
      if (tips.length) tr.crutchN += 1;
      if (inGoalArea(p.foot, 'left', pitch, 0.5) || inGoalArea(p.foot, 'right', pitch, 0.5)) tr.inAreaN += 1;
      if (p.team) tr.teamVotes[p.team] = (tr.teamVotes[p.team] || 0) + 1;
      if (p.role) tr.roleVotes[p.role] = (tr.roleVotes[p.role] || 0) + 1;
      tracks.set(tr.id, tr);
    }
    for (const [id, tr] of tracks) if (t - tr.last > T.trackForget) tracks.delete(id);
  }

  // the nearest crutch tip of a track to a point, and how fast that tip moved toward it
  function tipNear(tr, pt) {
    const cur = tr.tips[tr.tips.length - 1];
    if (!cur?.pts.length) return null;
    let best = null; let bd = Infinity;
    for (const tip of cur.pts) { const d = dist(tip, pt); if (d < bd) { bd = d; best = tip; } }
    const prev = [...tr.tips].reverse().find(x => cur.t - x.t >= 150 && x.pts.length);
    let speed = 0; let toward = 0;
    if (prev) {
      const pp = prev.pts.reduce((a, b) => (dist(a, best) < dist(b, best) ? a : b));
      const dt = (cur.t - prev.t) / 1000;
      speed = dist(pp, best) / dt;
      toward = (dist(pp, pt) - dist(best, pt)) / dt;               // > 0: the tip moved toward the point
    }
    return { tip: best, d: bd, speed, toward };
  }

  function detectTouch(t) {
    const h = ball.hist;
    if (h.length < 3) return null;
    const [a, b, c] = h.slice(-3);
    const v1 = { x: (b.x - a.x) / ((b.t - a.t) / 1000), y: (b.y - a.y) / ((b.t - a.t) / 1000) };
    const v2 = { x: (c.x - b.x) / ((c.t - b.t) / 1000), y: (c.y - b.y) / ((c.t - b.t) / 1000) };
    const s1 = Math.hypot(v1.x, v1.y); const s2 = Math.hypot(v2.x, v2.y);
    const ang = s1 > 0.3 && s2 > 0.3 ? Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (s1 * s2)))) * 180 / Math.PI : 0;
    const jump = Math.abs(s2 - s1);
    if (!(ang > T.touchAngle && Math.max(s1, s2) > 1.5) && !(jump > T.touchSpeedJump)) return null;
    // the contact happened between the last two ball samples — judge each player against both
    const at = { x: b.x, y: b.y };
    const pts = [{ x: b.x, y: b.y }, { x: c.x, y: c.y }];
    let foot = null; let footD = T.footReach; let crutch = null;
    for (const tr of tracks.values()) {
      const d = Math.min(...pts.map(q => dist(tr.foot, q)));
      if (d < footD) { footD = d; foot = tr; }
      for (const q of pts) {
        const tn = tipNear(tr, q);
        if (tn && tn.d < T.crutchReach && (!crutch || tn.d < crutch.tn.d)) crutch = { tr, tn };
      }
    }
    // a crutch contact: the tip closer than any foot that could have played it
    if (crutch && (!foot || crutch.tn.d < footD - 0.2)) {
      return { t: b.t, trackId: crutch.tr.id, team: teamOf(crutch.tr), by: 'crutch', at, speedBefore: s1, tip: crutch.tn, lying: crutch.tr.lying };
    }
    if (foot) return { t: b.t, trackId: foot.id, team: teamOf(foot), by: 'foot', at, speedBefore: s1, lying: foot.lying };
    return null;
  }

  function resolvePending(t, out) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (t - p.t < T.intentWindow) continue;
      pending.splice(i, 1);
      const tr = tracks.get(p.trackId);
      if (!tr) continue;
      const after = ball.hist.filter(h => h.t > p.t && h.t <= p.t + T.intentWindow);
      const near = after.length ? after.filter(h => dist(h, tr.foot) < 1.5).length / after.length : 0;
      const speedAfter = after.length >= 2 ? speedOf(after, 0) || speedOf(after) : 0;
      const trapped = p.speedBefore > 1 && speedAfter < 0.5 * p.speedBefore;
      const attackDir = defendedSide(state.sides, other(p.team || 'A')) === 'right' ? 1 : -1;
      const last = after[after.length - 1];
      const directed = last && (last.x - p.at.x) * attackDir > 1.5 && speedAfter > 1;
      const approach = p.tip.toward > 1;
      // INTENTIONAL = the crutch went TO the ball, then the ball was kept / trapped / sent on by it
      const score = (approach ? 0.4 : 0) + (near > 0.6 ? 0.35 : 0) + (trapped ? 0.15 : 0) + (directed ? 0.15 : 0);
      if (score >= 0.5) {
        const s = offence(t, 'crutch_handball', tr, p.at, Math.min(0.95, 0.35 + score * 0.6),
          [approach && 'הקב נע אל הכדור', near > 0.6 && 'השחקן שלט בכדור אחרי המגע', trapped && 'הכדור נעצר על הקב', directed && 'הכדור הופנה קדימה'].filter(Boolean).join(' · '));
        if (s) out.push(s);
      }
    }
  }

  return {
    state,
    tracks,
    /** Swap the ends (half time). */
    swapSides() { state.sides = { A: state.sides.B, B: state.sides.A }; },
    /** The current goalkeeper incidents (the 2nd one is a red card). */
    gkIncidents: () => ({ ...gkIncidents }),
    /** Confirmed by the referee → counted (a rejected suggestion never counts). */
    confirm(s) { if (s?.offence === 'gk_outside') gkIncidents[s.against] = (gkIncidents[s.against] || 0) + 1; },
    /** The ball was put back in play (after an out / a goal) — the next exit can count again. */
    restart() { ball.out = false; ball.outN = 0; ball.hist = []; lastTouch = null; },
    lastTouch: () => lastTouch,
    rolesAndTeams: () => [...tracks.values()].map(tr => ({ id: tr.id, team: teamOf(tr), role: roleOf(tr), foot: tr.foot })),

    /**
     * One frame. frame = { t (ms), ball: {x,y} | null, players: [{ foot:{x,y}, crutchTips:[{x,y}], lying, team, role }] }
     * Returns the NEW suggestions of this frame (usually none).
     */
    update(frame) {
      const t = frame.t;
      const out = [];
      associate(t, frame.players || []);
      if (frame.ball) {
        ball.hist.push({ t, x: frame.ball.x, y: frame.ball.y });
        while (ball.hist.length && t - ball.hist[0].t > 2500) ball.hist.shift();
        const exit = exitOf(frame.ball, pitch);
        if (!exit) { ball.outN = 0; if (!ball.inside) ball.insideSince = t; ball.inside = true; }
        // 3 / 4 / 5 — the ball left the pitch (held 2 frames, after being inside)
        if (exit && ball.inside && !ball.out) {
          ball.outN += 1;
          if (ball.outN >= T.outHoldFrames) {
            ball.out = true; ball.inside = false;
            const lt = lastTouch && t - lastTouch.t < 6000 ? lastTouch : null;
            if (exit === 'touch_line') {
              const d = touchLineDecision({ lastTouchTeam: lt?.team || null });
              out.push(suggest({ t, kind: 'kick_in', to: d.to, location: { x: frame.ball.x, y: Math.max(0, Math.min(pitch.width, frame.ball.y)) }, confidence: lt?.team ? 0.8 : 0.45, note: lt?.team ? null : 'לא ברור מי נגע אחרון' }));
            } else {
              const side = exit === 'goal_line_left' ? 'left' : 'right';
              const defending = state.sides.A === side ? 'A' : 'B';
              const crossing = ball.hist[ball.hist.length - 2] || frame.ball;
              const d = goalLineDecision({ betweenPosts: betweenPosts(crossing.y, pitch), defendingTeam: defending, lastTouchTeam: lt?.team || null });
              out.push(suggest({ t, kind: d.type, to: d.to, location: { x: side === 'left' ? 0 : pitch.length, y: crossing.y },
                confidence: d.type === 'goal' ? 0.7 : (lt?.team ? 0.75 : 0.5),
                note: d.type === 'goal' ? 'הגובה מתחת לקורה (2.2 מ׳) לא נראה ממצלמה אחת — לאשר' : (lt?.team ? null : 'לא ברור מי נגע אחרון') }));
            }
          }
        }
        // the touches: who played the ball, and how
        if (!ball.out) {
          const touch = detectTouch(t);
          if (touch && (!lastTouch || touch.t - lastTouch.t > 250)) {
            lastTouch = touch;
            if (touch.by === 'crutch') pending.push(touch);            // 7 — judged after the intent window
            const tr = tracks.get(touch.trackId);
            if (touch.lying && tr && roleOf(tr) !== 'gk' && cool(`fallen-${tr.id}`, t, 3000)) {
              const s = offence(t, 'fallen_play', tr, touch.at, 0.6); if (s) out.push(s);
            }
          }
        }
      }
      resolvePending(t, out);
      const ballPt = frame.ball || null;
      for (const tr of tracks.values()) {
        const team = teamOf(tr);
        const role = roleOf(tr);
        if (!team) continue;
        const opp = [...tracks.values()].filter(o => o.id !== tr.id && teamOf(o) === other(team));
        // 1 — a slide tackle: down, at speed, at the ball / an opponent (the keeper may dive)
        if (role !== 'gk' && tr.lying && speedOf(tr.hist) > T.slideSpeed) {
          const nearBall = ballPt && dist(tr.foot, ballPt) < 1.8;
          const nearOpp = opp.some(o => dist(o.foot, tr.foot) < 1.5);
          if ((nearBall || nearOpp) && cool(`slide-${tr.id}`, t, 4000)) { const s = offence(t, 'slide_tackle', tr, tr.foot, nearOpp ? 0.75 : 0.6); if (s) out.push(s); }
        }
        // 1 — a crutch swung into an opponent
        if (role !== 'gk') {
          for (const o of opp) {
            const tn = tipNear(tr, o.foot);
            if (tn && tn.d < 0.7 && tn.speed > T.strikeTipSpeed && tn.toward > 1 && cool(`strike-${tr.id}-${o.id}`, t, 4000)) {
              const s = offence(t, 'crutch_strike', tr, o.foot, 0.6, 'קב נע במהירות אל יריב'); if (s) out.push(s);
            }
          }
        }
        // 8 — the goalkeeper actively playing outside the goal area (momentum / far from the ball: not penalised)
        if (role === 'gk') {
          const own = defendedSide(state.sides, team);
          const outside = !inGoalArea(tr.foot, own, pitch, T.gkOutside);
          const active = ballPt && dist(ballPt, tr.foot) < T.gkActive;
          if (outside && active) {
            if (!gkOut.has(tr.id)) gkOut.set(tr.id, t);
            if (t - gkOut.get(tr.id) >= T.gkHold && cool(`gk-${tr.id}`, t, 8000)) {
              const s = offence(t, 'gk_outside', tr, tr.foot, 0.7, gkIncidents[team] >= 1 ? 'פעם שנייה — כרטיס אדום' : 'פעם ראשונה — צהוב'); if (s) out.push(s);
            }
          } else gkOut.delete(tr.id);
        }
      }
      return out;
    },
  };
}
