import { describe, it, expect } from 'vitest';
import { homography, toPitch, calibrationTargets, inGoalArea, betweenPosts, exitOf } from '../pitch.js';
import { decide, goalLineDecision, touchLineDecision, WAFF } from '../amputeeRules.js';
import { createAmputeeReferee } from '../amputeeReferee.js';

describe('The pitch — camera → metres', () => {
  it('a homography from the 4 tapped corners maps the image to the 60×40 pitch', () => {
    // a perspective quad as a camera on the touch line would see it
    const img = [[0.2, 0.3], [0.8, 0.3], [1.0, 0.9], [0.0, 0.9]];
    const H = homography(img, calibrationTargets('full'));
    const c = toPitch(H, 0.2, 0.3);
    expect(c.x).toBeCloseTo(0, 5); expect(c.y).toBeCloseTo(0, 5);
    const d = toPitch(H, 1.0, 0.9);
    expect(d.x).toBeCloseTo(60, 5); expect(d.y).toBeCloseTo(40, 5);
  });
  it('the goal area 10 × 8, the posts 5 m apart, the exits', () => {
    expect(inGoalArea({ x: 7, y: 22 }, 'left')).toBe(true);
    expect(inGoalArea({ x: 9, y: 20 }, 'left')).toBe(false);
    expect(inGoalArea({ x: 55, y: 26 }, 'right')).toBe(false);
    expect(betweenPosts(22)).toBe(true); expect(betweenPosts(23)).toBe(false);
    expect(exitOf({ x: -1, y: 20 })).toBe('goal_line_left');
    expect(exitOf({ x: 30, y: 41 })).toBe('touch_line');
    expect(exitOf({ x: 30, y: 20 })).toBe(null);
  });
});

describe('The WAFF laws as decisions', () => {
  it('no offside; 2 × 25; a kick-in for the opponent of the last toucher; goal line → goal / corner / goal kick', () => {
    expect(WAFF.offside).toBe(false); expect(WAFF.halfMin).toBe(25);
    expect(touchLineDecision({ lastTouchTeam: 'A' })).toEqual({ type: 'kick_in', to: 'B' });
    expect(goalLineDecision({ betweenPosts: true, defendingTeam: 'B', lastTouchTeam: 'A' })).toEqual({ type: 'goal', to: 'A' });
    expect(goalLineDecision({ betweenPosts: false, defendingTeam: 'B', lastTouchTeam: 'B' })).toEqual({ type: 'corner', to: 'A' });
    expect(goalLineDecision({ betweenPosts: false, defendingTeam: 'B', lastTouchTeam: 'A' })).toEqual({ type: 'goal_kick', to: 'B' });
  });
  it('a crutch handball / a slide tackle by a defender in his own area → a PENALTY; the keeper outside: yellow, then red', () => {
    expect(decide('crutch_handball', 'B', { inOwnGoalArea: true })).toMatchObject({ restart: 'PK', to: 'A' });
    expect(decide('crutch_handball', 'B', {})).toMatchObject({ restart: 'DFK' });
    expect(decide('crutch_handball', 'A', { inOpponentGoalArea: true })).toMatchObject({ restart: 'DFK', fromGoalArea: true });
    expect(decide('slide_tackle', 'A', {})).toMatchObject({ restart: 'DFK', card: 'yellow' });
    expect(decide('slide_tackle', 'A', { inOwnGoalArea: true }).restart).toBe('PK');
    expect(decide('fallen_play', 'A', { inOwnGoalArea: true }).restart).toBe('IFK');
    expect(decide('gk_outside', 'A', {}).card).toBe('yellow');
    expect(decide('gk_outside', 'A', { gkPriorOutside: 1 }).card).toBe('red');
    expect(decide('crutch_strike', 'B', {}).card).toBe('red');
  });
});

// a tiny game simulator: frames every 100 ms
function sim(ref, steps) {
  const out = [];
  let t = 0;
  for (const s of steps) { t += 100; out.push(...ref.update({ t, ...s })); }
  return out;
}
const field = (x, y, team, extra = {}) => ({ foot: { x, y }, team, role: 'field', crutchTips: [{ x: x + 0.5, y: y + 0.3 }, { x: x - 0.5, y: y + 0.3 }], ...extra });
const keeper = (x, y, team) => ({ foot: { x, y }, team, role: 'gk', crutchTips: [] });

describe('The assistant referee — the 8 points', () => {
  it('3 — a goal: the ball over the goal line between the posts (the height noted)', () => {
    const ref = createAmputeeReferee();
    const steps = [];
    for (let i = 0; i < 8; i++) steps.push({ ball: { x: 50 + i * 1.5, y: 20 }, players: [field(49 + i * 1.5, 20, 'A'), keeper(58, 20, 'B')] });
    steps.push({ ball: { x: 60.8, y: 20.2 }, players: [] }, { ball: { x: 61.2, y: 20.2 }, players: [] });
    const s = sim(ref, steps);
    const goal = s.find(x => x.kind === 'goal');
    expect(goal).toMatchObject({ to: 'A' });
    expect(goal.note).toMatch(/קורה/);
  });
  it('4 — a kick-in for the opponent of the last toucher', () => {
    const ref = createAmputeeReferee();
    const p = [field(30, 35, 'B')];
    const s = sim(ref, [
      { ball: { x: 28, y: 34 }, players: p }, { ball: { x: 29, y: 34.5 }, players: p }, { ball: { x: 30, y: 35 }, players: p },
      // touched by B: a sharp change of direction toward the touch line
      { ball: { x: 30.2, y: 37 }, players: p }, { ball: { x: 30.4, y: 39 }, players: p },
      { ball: { x: 30.6, y: 40.8 }, players: p }, { ball: { x: 30.8, y: 41.5 }, players: p },
    ]);
    expect(s.find(x => x.kind === 'kick_in')).toMatchObject({ to: 'A' });
  });
  it('5 — over the goal line wide of the posts: a corner (the defenders touched last) / a goal kick', () => {
    const ref = createAmputeeReferee();
    const d = [field(55, 30, 'B')];
    const s = sim(ref, [
      { ball: { x: 53, y: 28 }, players: d }, { ball: { x: 54, y: 29 }, players: d }, { ball: { x: 55, y: 30 }, players: d },
      { ball: { x: 57, y: 30.2 }, players: d }, { ball: { x: 59, y: 30.4 }, players: d }, { ball: { x: 60.6, y: 30.5 }, players: d }, { ball: { x: 61, y: 30.6 }, players: d },
    ]);
    expect(s.find(x => x.kind === 'corner')).toMatchObject({ to: 'A' });
  });
  it('7 — a crutch hand-pass: INTENTIONAL (the crutch went to the ball, then controlled it) → an offence; a defender in his own area → a PENALTY', () => {
    const ref = createAmputeeReferee();
    const steps = [];
    // the ball comes fast toward a B defender standing in his own goal area (right side)
    for (let i = 0; i < 4; i++) steps.push({ ball: { x: 44 + i * 2, y: 20 }, players: [field(55, 20.5, 'B', { crutchTips: [{ x: 54.2, y: 20.3 }] })] });
    // the crutch tip moves TO the ball and stops it; the ball then stays at his feet
    steps.push({ ball: { x: 52, y: 20 }, players: [field(55, 20.5, 'B', { crutchTips: [{ x: 53, y: 20.1 }] })] });
    steps.push({ ball: { x: 52.6, y: 20.1 }, players: [field(55, 20.5, 'B', { crutchTips: [{ x: 52.7, y: 20.1 }] })] });
    for (let i = 0; i < 10; i++) steps.push({ ball: { x: 53.5 + i * 0.05, y: 20.4 }, players: [field(54.2, 20.5, 'B', { crutchTips: [{ x: 53, y: 20.2 }] })] });
    const s = sim(ref, steps);
    const h = s.find(x => x.offence === 'crutch_handball');
    expect(h).toBeTruthy();
    expect(h).toMatchObject({ against: 'B', to: 'A', restart: 'PK', kind: 'penalty' });
  });
  it('7 — an INCIDENTAL crutch contact (a static crutch, the ball rolls on) is not an offence', () => {
    const ref = createAmputeeReferee();
    const steps = [];
    for (let i = 0; i < 4; i++) steps.push({ ball: { x: 20 + i * 2, y: 20 }, players: [field(30, 21.5, 'B', { crutchTips: [{ x: 28.2, y: 20.2 }] })] });
    steps.push({ ball: { x: 28, y: 20 }, players: [field(30, 21.5, 'B', { crutchTips: [{ x: 28.2, y: 20.2 }] })] });
    for (let i = 0; i < 10; i++) steps.push({ ball: { x: 29 + i * 1.2, y: 18 - i * 0.8 }, players: [field(30, 21.5, 'B', { crutchTips: [{ x: 28.2, y: 20.2 }] })] });
    const s = sim(ref, steps);
    expect(s.find(x => x.offence === 'crutch_handball')).toBeUndefined();
  });
  it('1 — a slide tackle: an outfield player down at speed at an opponent → a DFK + a yellow', () => {
    const ref = createAmputeeReferee();
    const steps = [];
    for (let i = 0; i < 6; i++) steps.push({ ball: { x: 30, y: 20 }, players: [field(26 + i * 0.6, 20, 'A', { lying: i >= 3 }), field(30.5, 20.3, 'B')] });
    const s = sim(ref, steps);
    expect(s.find(x => x.offence === 'slide_tackle')).toMatchObject({ against: 'A', to: 'B', restart: 'DFK', card: 'yellow' });
  });
  it('8 — the keeper actively playing outside his goal area: a yellow; staying in: nothing', () => {
    const ref = createAmputeeReferee();
    const steps = [];
    for (let i = 0; i < 12; i++) steps.push({ ball: { x: 10, y: 20 }, players: [keeper(i < 10 ? 2 : 10.5, 20, 'A')] });
    for (let i = 0; i < 8; i++) steps.push({ ball: { x: 11, y: 20 }, players: [keeper(10.6, 20, 'A')] });
    const s = sim(ref, steps);
    const gk = s.find(x => x.offence === 'gk_outside');
    expect(gk).toMatchObject({ against: 'A', card: 'yellow', restart: 'DFK' });
    ref.confirm(gk);
    expect(ref.gkIncidents().A).toBe(1);
  });
  it('6 — the roles: a player mostly in a goal area without crutches = the goalkeeper', () => {
    const ref = createAmputeeReferee();
    sim(ref, Array.from({ length: 12 }, () => ({ ball: null, players: [{ foot: { x: 3, y: 20 }, team: 'A', crutchTips: [] }, field(30, 10, 'B')] })));
    const r = ref.rolesAndTeams();
    expect(r.find(x => x.foot.x === 3)).toMatchObject({ team: 'A', role: 'gk' });
    expect(r.find(x => x.foot.x === 30)).toMatchObject({ team: 'B', role: 'field' });
  });
});
