// ============================================================
// amputeeRules — the WAFF Laws of the Game (amputee football) as decisions (Stage 5)
//
// PURE. From the official WAFF Laws (fetched 2026-11-04): FIFA laws with these amendments —
//   Law 1  60 × 40 m (±5), goal 5 × 2.2 m, goal area 10 × 8 m, penalty mark 8 m
//   Law 3  7 a side (6 outfield + a goalkeeper); outfield = leg amputees on forearm crutches; the goalkeeper = a
//          single-arm amputee; max 2 substitutes enter at a time, at a stoppage, re-entry allowed
//   Law 6  2 × 25 min; 1 time-out per team per half (≤ 1 min); extra time 2 × 10 min
//   Law 7  a KICK-IN (an indirect free kick) replaces the throw-in, by the opponent of the last toucher; a goal kick
//          from the goal area, never across the centre line on the fly; a corner = a direct free kick
//   Law 8  NO OFFSIDE
//   Law 9  crutches = the arms: INTENTIONALLY controlling / directing the ball with a crutch (or a residual limb) =
//          a handling offence → a direct free kick; by a DEFENDER inside their own goal area → a PENALTY; incidental
//          contact is not an offence. SLIDE TACKLES are not permitted → a direct free kick + a caution (the
//          goalkeeper may dive). A fallen player playing the ball → an indirect free kick. The goalkeeper actively
//          playing OUTSIDE the goal area: 1st → a yellow + a direct free kick, 2nd → a red + a direct free kick;
//          an inadvertent / momentum departure is not penalised.
//   (Striking an opponent with a crutch = violent conduct → a red card, a direct free kick / a penalty in the area.)
// ============================================================

export const WAFF = {
  players: 7, maxSubsAtOnce: 2, halfMin: 25, extraHalfMin: 10, timeoutsPerHalf: 1, timeoutSec: 60, offside: false,
  pitch: { length: 60, width: 40 }, goal: { width: 5, height: 2.2 }, goalArea: { width: 10, depth: 8 }, penaltyMark: 8,
};

// every offence the referee can call — the restart it leads to and the card it carries
export const OFFENCES = {
  crutch_handball: { he: 'יד בקב (נגיעה מכוונת)', en: 'Crutch handball (intentional)', restart: 'DFK', card: null, penaltyInOwnArea: true },
  stump_handball: { he: 'שליטה בכדור עם הגדם', en: 'Residual-limb handball', restart: 'DFK', card: null, penaltyInOwnArea: true },
  slide_tackle: { he: 'תיקול גלישה', en: 'Slide tackle', restart: 'DFK', card: 'yellow', penaltyInOwnArea: true },
  crutch_strike: { he: 'שימוש אגרסיבי בקב נגד יריב', en: 'Striking with a crutch', restart: 'DFK', card: 'red', penaltyInOwnArea: true },
  foul: { he: 'עבירה', en: 'Foul', restart: 'DFK', card: null, penaltyInOwnArea: true },
  fallen_play: { he: 'שחקן שנפל שיחק בכדור', en: 'Played the ball while down', restart: 'IFK', card: null, penaltyInOwnArea: false },
  gk_outside: { he: 'השוער שיחק מחוץ לרחבה', en: 'Goalkeeper played outside the area', restart: 'DFK', card: 'yellow', penaltyInOwnArea: false },
  keeper_endangerment: { he: 'סיכון השוער (כדור ביד השוער)', en: 'Endangering the keeper', restart: 'IFK', card: null, penaltyInOwnArea: false },
};

export const RESTARTS = {
  DFK: { he: 'בעיטה חופשית ישירה', en: 'Direct free kick' },
  IFK: { he: 'בעיטה חופשית עקיפה', en: 'Indirect free kick' },
  PK: { he: 'פנדל (מ-8 מ׳)', en: 'Penalty (8 m)' },
  kick_in: { he: 'חוץ — בעיטה רגלית (עקיפה)', en: 'Kick-in (indirect)' },
  corner: { he: 'קרן (ישירה)', en: 'Corner (direct)' },
  goal_kick: { he: 'בעיטת שער מהרחבה', en: 'Goal kick from the area' },
};

const other = (t) => (t === 'A' ? 'B' : 'A');

/**
 * The decision for an offence: { offence, against (the offending team), to (the team awarded), restart, card }.
 * ctx: { inOwnGoalArea (the offender's own area), inOpponentGoalArea, gkPriorOutside (the keeper's earlier incidents) }
 */
export function decide(offence, team, ctx = {}) {
  const o = OFFENCES[offence];
  if (!o) return null;
  let restart = o.restart;
  let card = o.card;
  if (offence === 'gk_outside' && (ctx.gkPriorOutside || 0) >= 1) card = 'red';           // the second incident
  // a defender's direct-free-kick offence inside their OWN goal area → a penalty (Law 9 / FIFA Law 14)
  if (o.penaltyInOwnArea && restart === 'DFK' && ctx.inOwnGoalArea) restart = 'PK';
  // an attacker's crutch / stump handball inside the opponents' area → their DFK from anywhere inside the goal area
  const fromGoalArea = (offence === 'crutch_handball' || offence === 'stump_handball') && ctx.inOpponentGoalArea;
  return { offence, against: team, to: other(team), restart, card, ...(fromGoalArea ? { fromGoalArea: true } : {}) };
}

/** The restart after the ball left the pitch over a goal line: a goal / a corner / a goal kick. */
export function goalLineDecision({ betweenPosts, defendingTeam, lastTouchTeam }) {
  if (betweenPosts) return { type: 'goal', to: other(defendingTeam) };
  if (lastTouchTeam === defendingTeam) return { type: 'corner', to: other(defendingTeam) };
  return { type: 'goal_kick', to: defendingTeam };
}

/** The restart after the ball crossed a touch line: a kick-in for the opponent of the last toucher. */
export const touchLineDecision = ({ lastTouchTeam }) => ({ type: 'kick_in', to: lastTouchTeam ? other(lastTouchTeam) : null });
