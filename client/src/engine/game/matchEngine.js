// ============================================================
// matchEngine — the rules + score of a game, per sport (Stage 5 — Game Mode, built 2026-11-04)
//
// PURE. A match is a state; every referee event (from a human, or a detector's suggestion the human CONFIRMED)
// goes through applyEvent(state, event) → a new state. The detection layer (players / ball / court models) only
// SUGGESTS events — it never changes the score by itself (community games: the final call is human).
// Sports: football, footballAmputee, basketball, basketballWheelchair, tennis, tennisWheelchair.
// ============================================================

export const SPORTS = {
  football: { family: 'football', he: 'כדורגל', en: 'Football', periods: 2, periodMin: 45, players: 11 },
  footballAmputee: { family: 'football', he: 'כדורגל קטועים', en: 'Amputee football', periods: 2, periodMin: 25, players: 7,
    // the WAFF laws, in short: crutches are part of the arm (a deliberate crutch–ball contact = a handball), the
    // goalkeeper (one arm) never leaves the area, no offside, kick-ins instead of throw-ins
    notes: { he: 'קביים = חלק מהיד (נגיעה מכוונת בכדור = יד) · השוער לא יוצא מהרחבה · אין נבדל · כניסה בבעיטה', en: 'Crutches count as the arm (deliberate ball contact = handball) · the keeper stays in the area · no offside · kick-ins' } },
  basketball: { family: 'basketball', he: 'כדורסל', en: 'Basketball', periods: 4, periodMin: 10, players: 5, foulOut: 5, teamFoulBonus: 5 },
  basketballWheelchair: { family: 'basketball', he: 'כדורסל כיסאות גלגלים', en: 'Wheelchair basketball', periods: 4, periodMin: 10, players: 5, foulOut: 5, teamFoulBonus: 5,
    // the IWBF rules, in short: more than 2 pushes while holding the ball = travelling; rising off the seat = a
    // technical foul (physical advantage); the chair is part of the player
    notes: { he: 'יותר מ-2 דחיפות עם הכדור = צעדים · הרמה מהמושב = עבירה טכנית · הכיסא הוא חלק מהשחקן', en: '>2 pushes holding the ball = travel · lifting off the seat = technical · the chair is part of the player' } },
  tennis: { family: 'tennis', he: 'טניס', en: 'Tennis', bounces: 1 },
  tennisWheelchair: { family: 'tennis', he: 'טניס כיסאות גלגלים', en: 'Wheelchair tennis', bounces: 2,
    notes: { he: 'מותרות 2 נגיעות (השנייה יכולה להיות מחוץ למגרש) · הגשה מהכיסא', en: 'Two bounces allowed (the second may be outside the court) · serve from the chair' } },
};

export const familyOf = (sport) => SPORTS[sport]?.family || null;
const other = (t) => (t === 'A' ? 'B' : 'A');

/** A new match. opts: { periodMin, periods, players, bestOf (tennis: 3|5), teamNames } */
export function createMatch(sport, opts = {}) {
  const def = SPORTS[sport];
  if (!def) throw new Error(`unknown sport: ${sport}`);
  const base = { sport, family: def.family, teams: { A: opts.teamNames?.A || 'A', B: opts.teamNames?.B || 'B' }, log: [], finished: false, winner: null };
  if (def.family === 'tennis') {
    return { ...base, bestOf: opts.bestOf === 5 ? 5 : 3, sets: [], games: { A: 0, B: 0 }, points: { A: 0, B: 0 }, tiebreak: false, server: opts.server === 'B' ? 'B' : 'A', bounces: def.bounces };
  }
  return {
    ...base, period: 1, periods: opts.periods || def.periods, periodMin: opts.periodMin || def.periodMin, players: opts.players || def.players,
    score: { A: 0, B: 0 },
    ...(def.family === 'football' ? { cards: [], timeouts: {} } : {}),
    ...(def.family === 'basketball' ? { personalFouls: {}, teamFouls: { A: 0, B: 0 }, fouledOut: [] } : {}),
  };
}

// ---------------- tennis ----------------
const POINT_NAMES = ['0', '15', '30', '40'];

/** The tennis score as people say it: { points: '30–15' | 'Deuce' | 'Ad A' | tiebreak numbers, games, sets } */
export function tennisDisplay(m) {
  const { A, B } = m.points;
  let points;
  if (m.tiebreak) points = `${A}–${B}`;
  else if (A >= 3 && B >= 3) points = A === B ? 'Deuce' : `Ad ${A > B ? m.teams.A : m.teams.B}`;
  else points = `${POINT_NAMES[Math.min(A, 3)]}–${POINT_NAMES[Math.min(B, 3)]}`;
  return { points, games: `${m.games.A}–${m.games.B}`, sets: m.sets.map(s => `${s.A}–${s.B}${s.tb ? `(${s.tb})` : ''}`) };
}

function tennisPoint(m, team) {
  const pts = { ...m.points, [team]: m.points[team] + 1 };
  const t = pts[team]; const o = pts[other(team)];
  const gameWon = m.tiebreak ? (t >= 7 && t - o >= 2) : (t >= 4 && t - o >= 2);
  if (!gameWon) {
    // the tiebreak's serve changes after the first point, then every two
    const total = pts.A + pts.B;
    const server = m.tiebreak && total % 2 === 1 ? other(m.server) : m.server;
    return { ...m, points: pts, server };
  }
  const games = { ...m.games, [team]: m.games[team] + 1 };
  const g = games[team]; const og = games[other(team)];
  const setWon = m.tiebreak || (g >= 6 && g - og >= 2);
  if (!setWon) {
    return { ...m, points: { A: 0, B: 0 }, games, tiebreak: g === 6 && og === 6, server: other(m.server) };
  }
  const sets = [...m.sets, { A: games.A, B: games.B, ...(m.tiebreak ? { tb: Math.min(pts.A, pts.B) } : {}) }];
  const won = sets.filter(s => s[team] > s[other(team)]).length;
  const finished = won > m.bestOf / 2;
  return { ...m, sets, games: { A: 0, B: 0 }, points: { A: 0, B: 0 }, tiebreak: false, server: other(m.server), finished, winner: finished ? team : null };
}

// ---------------- the events ----------------
/**
 * Apply one referee event. Every event: { type, team: 'A'|'B', player?, at?, source?: 'referee'|'suggested', ... }
 *   football:   goal · foul (kind) · card (color) · period_end
 *   basketball: score (value 1|2|3) · foul (player) · violation (kind) · period_end
 *   tennis:     point (team = the winner of the point) · fault · let
 * Returns the new state; the event is logged (with the score after it) for the match report and the VAR review.
 */
export function applyEvent(m, ev) {
  if (!ev || m.finished) return m;
  const team = ev.team === 'B' ? 'B' : 'A';
  let next = m;
  switch (`${m.family}:${ev.type}`) {
    case 'football:goal':
      next = { ...m, score: { ...m.score, [team]: m.score[team] + 1 } }; break;
    case 'football:card': {
      const color = ev.color === 'red' ? 'red' : 'yellow';
      const prior = m.cards.filter(c => c.team === team && c.player && c.player === ev.player && c.color === 'yellow').length;
      const cards = [...m.cards, { team, player: ev.player || null, color }];
      // a second yellow = a red
      if (color === 'yellow' && prior >= 1) cards.push({ team, player: ev.player || null, color: 'red', secondYellow: true });
      next = { ...m, cards }; break;
    }
    // WAFF Law 6: one time-out per team per half (≤ 1 min); Law 3: at most 2 substitutes enter at a time
    case 'football:timeout': {
      const key = `${m.period}:${team}`;
      if (m.sport === 'footballAmputee' && (m.timeouts[key] || 0) >= 1) return { ...m, log: [...m.log, { ...ev, team, at: ev.at ?? Date.now(), rejected: 'timeout_used' }] };
      next = { ...m, timeouts: { ...m.timeouts, [key]: (m.timeouts[key] || 0) + 1 } }; break;
    }
    case 'football:substitution':
      if (m.sport === 'footballAmputee' && Number(ev.count || 1) > 2) return { ...m, log: [...m.log, { ...ev, team, at: ev.at ?? Date.now(), rejected: 'max_two_at_once' }] };
      break;
    case 'basketball:score': {
      const v = [1, 2, 3].includes(Number(ev.value)) ? Number(ev.value) : 2;
      next = { ...m, score: { ...m.score, [team]: m.score[team] + v } }; break;
    }
    case 'basketball:foul': {
      const key = `${team}:${ev.player || '?'}`;
      const n = (m.personalFouls[key] || 0) + 1;
      const def = SPORTS[m.sport];
      next = {
        ...m, personalFouls: { ...m.personalFouls, [key]: n }, teamFouls: { ...m.teamFouls, [team]: m.teamFouls[team] + 1 },
        fouledOut: n >= def.foulOut && ev.player ? [...m.fouledOut, key] : m.fouledOut,
      };
      break;
    }
    case 'football:period_end':
    case 'basketball:period_end': {
      const last = m.period >= m.periods;
      const tie = m.score.A === m.score.B;
      if (last && !(m.family === 'basketball' && tie)) {
        next = { ...m, finished: true, winner: tie ? null : (m.score.A > m.score.B ? 'A' : 'B') };
      } else {
        // basketball: a tie after the last quarter → overtime (5 min); every new quarter resets the team fouls
        next = { ...m, period: m.period + 1, ...(last ? { periods: m.periods + 1, periodMin: 5 } : {}), ...(m.family === 'basketball' ? { teamFouls: { A: 0, B: 0 } } : {}) };
      }
      break;
    }
    case 'tennis:point':
      next = tennisPoint(m, team); break;
    default:
      next = m;                                   // fouls / violations / faults / lets: logged, no score change
  }
  const after = m.family === 'tennis' ? tennisDisplay(next) : { ...next.score };
  return { ...next, log: [...m.log, { ...ev, team, at: ev.at ?? Date.now(), source: ev.source || 'referee', after }] };
}

/** Basketball: is the team in the bonus (the opponent shoots free throws on a non-shooting foul)? */
export const inBonus = (m, team) => m.family === 'basketball' && m.teamFouls[other(team)] >= SPORTS[m.sport].teamFoulBonus;

/** Undo the last event (a referee's correction) — replays the log without it. */
export function undoLast(m) {
  if (!m.log.length) return m;
  let s = createMatch(m.sport, { periodMin: m.periodMin, players: m.players, bestOf: m.bestOf, teamNames: m.teams });
  for (const ev of m.log.slice(0, -1)) s = applyEvent(s, ev);
  return s;
}
