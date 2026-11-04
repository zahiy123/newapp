import { describe, it, expect } from 'vitest';
import { createMatch, applyEvent, tennisDisplay, inBonus, undoLast, SPORTS } from '../matchEngine.js';

const play = (m, evs) => evs.reduce(applyEvent, m);
const points = (team, n) => Array.from({ length: n }, () => ({ type: 'point', team }));

describe('All six sports exist with their rules', () => {
  it('football / amputee / basketball / wheelchair basketball / tennis / wheelchair tennis', () => {
    expect(Object.keys(SPORTS)).toEqual(['football', 'footballAmputee', 'basketball', 'basketballWheelchair', 'tennis', 'tennisWheelchair']);
    expect(createMatch('footballAmputee')).toMatchObject({ periods: 2, periodMin: 25, players: 7 });
    expect(createMatch('tennisWheelchair').bounces).toBe(2);
  });
});

describe('Football', () => {
  it('goals, a second yellow becomes a red, the final whistle decides', () => {
    let m = play(createMatch('footballAmputee'), [{ type: 'goal', team: 'A' }, { type: 'goal', team: 'B' }, { type: 'goal', team: 'A' }]);
    expect(m.score).toEqual({ A: 2, B: 1 });
    m = play(m, [{ type: 'card', team: 'B', player: '7', color: 'yellow' }, { type: 'card', team: 'B', player: '7', color: 'yellow' }]);
    expect(m.cards.filter(c => c.color === 'red')).toHaveLength(1);
    m = play(m, [{ type: 'period_end' }, { type: 'period_end' }]);
    expect(m).toMatchObject({ finished: true, winner: 'A' });
    expect(applyEvent(m, { type: 'goal', team: 'B' })).toBe(m);                     // after the end nothing changes
  });
});

describe('Basketball', () => {
  it('1 / 2 / 3 points, the bonus after 5 team fouls, a player fouls out at 5', () => {
    let m = play(createMatch('basketballWheelchair'), [{ type: 'score', team: 'A', value: 3 }, { type: 'score', team: 'B', value: 2 }, { type: 'score', team: 'A', value: 1 }]);
    expect(m.score).toEqual({ A: 4, B: 2 });
    m = play(m, Array.from({ length: 5 }, () => ({ type: 'foul', team: 'B', player: '12' })));
    expect(inBonus(m, 'A')).toBe(true);
    expect(m.fouledOut).toEqual(['B:12']);
  });
  it('a tie after the 4th quarter → overtime; the team fouls reset each quarter', () => {
    let m = play(createMatch('basketball'), [{ type: 'foul', team: 'A' }, { type: 'period_end' }]);
    expect(m.teamFouls).toEqual({ A: 0, B: 0 });
    m = play(m, [{ type: 'period_end' }, { type: 'period_end' }, { type: 'period_end' }]);
    expect(m).toMatchObject({ finished: false, period: 5, periodMin: 5 });
    m = play(m, [{ type: 'score', team: 'B', value: 2 }, { type: 'period_end' }]);
    expect(m).toMatchObject({ finished: true, winner: 'B' });
  });
});

describe('Tennis', () => {
  it('15–30–40, deuce, advantage, the game', () => {
    let m = play(createMatch('tennis'), [...points('A', 3), ...points('B', 3)]);
    expect(tennisDisplay(m).points).toBe('Deuce');
    m = applyEvent(m, { type: 'point', team: 'A' });
    expect(tennisDisplay(m).points).toBe('Ad A');
    m = applyEvent(m, { type: 'point', team: 'A' });
    expect(tennisDisplay(m)).toMatchObject({ points: '0–0', games: '1–0' });
    expect(m.server).toBe('B');                                                       // the serve changes
  });
  it('a set 6–4; at 6–6 a tiebreak to 7 by 2; best of 3 wins the match', () => {
    const game = (t) => points(t, 4);
    let m = createMatch('tennisWheelchair');
    for (let i = 0; i < 4; i++) m = play(m, [...game('A'), ...game('B')]);
    m = play(m, [...game('A'), ...game('A')]);
    expect(tennisDisplay(m).sets).toEqual(['6–4']);
    for (let i = 0; i < 6; i++) m = play(m, [...game('A'), ...game('B')]);
    expect(m.tiebreak).toBe(true);
    m = play(m, [...points('A', 6), ...points('B', 6), ...points('A', 2)]);
    expect(tennisDisplay(m).sets).toEqual(['6–4', '7–6(6)']);
    expect(m).toMatchObject({ finished: true, winner: 'A' });
  });
});

describe('The referee corrects', () => {
  it('undo the last event; every event is logged with the score after it', () => {
    let m = play(createMatch('football'), [{ type: 'goal', team: 'A' }, { type: 'goal', team: 'A', source: 'suggested' }]);
    expect(m.log[1]).toMatchObject({ source: 'suggested', after: { A: 2, B: 0 } });
    m = undoLast(m);
    expect(m.score).toEqual({ A: 1, B: 0 });
    expect(m.log).toHaveLength(1);
  });
});

describe('Amputee football — the WAFF extras', () => {
  it('one time-out per team per half; at most 2 substitutes at once', () => {
    let m = play(createMatch('footballAmputee'), [{ type: 'timeout', team: 'A' }, { type: 'timeout', team: 'A' }]);
    expect(m.log[1].rejected).toBe('timeout_used');
    m = play(m, [{ type: 'period_end' }, { type: 'timeout', team: 'A' }]);
    expect(m.log[m.log.length - 1].rejected).toBeUndefined();
    m = applyEvent(m, { type: 'substitution', team: 'B', count: 3 });
    expect(m.log[m.log.length - 1].rejected).toBe('max_two_at_once');
  });
});
