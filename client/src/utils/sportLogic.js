export const SPORTS = {
  football: { key: 'football', icon: '\u26BD' },
  basketball: { key: 'basketball', icon: '\uD83C\uDFC0' },
  tennis: { key: 'tennis', icon: '\uD83C\uDFBE' },
  footballAmputee: { key: 'footballAmputee', icon: '\u26BD' },
  basketballWheelchair: { key: 'basketballWheelchair', icon: '\uD83C\uDFC0' },
  tennisWheelchair: { key: 'tennisWheelchair', icon: '\uD83C\uDFBE' },
  footballAmputeeGK: { key: 'footballAmputeeGK', icon: '\uD83E\uDDE4' },
  fitness: { key: 'fitness', icon: '\uD83D\uDCAA' }
};

export function getAvailableSports(disability) {
  switch (disability) {
    case 'none':
      return [SPORTS.football, SPORTS.basketball, SPORTS.tennis, SPORTS.fitness];
    case 'one_leg':
      return [SPORTS.footballAmputee, SPORTS.basketballWheelchair, SPORTS.tennisWheelchair, SPORTS.fitness];
    case 'one_arm':
      return [SPORTS.footballAmputeeGK, SPORTS.basketball, SPORTS.tennis, SPORTS.fitness];
    case 'two_legs':
      return [SPORTS.basketballWheelchair, SPORTS.tennisWheelchair, SPORTS.fitness];
    default:
      return [SPORTS.football, SPORTS.basketball, SPORTS.tennis,
              SPORTS.footballAmputee, SPORTS.basketballWheelchair, SPORTS.tennisWheelchair, SPORTS.fitness];
  }
}

export const GOALS = [
  'technique', 'aerobic', 'strength', 'weightLoss', 'speed', 'flexibility'
];
