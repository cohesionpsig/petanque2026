import { describe, it, expect } from 'vitest';
import { validatePetanqueScore, computePoolSizes, computeStandings } from '../js/logic.js';

// ─── validatePetanqueScore ───────────────────────────────────────────────────

describe('validatePetanqueScore', () => {
  it('accepte un score valide 13-7', () => {
    expect(validatePetanqueScore(13, 7)).toEqual({ ok: true });
  });

  it('refuse un score négatif', () => {
    expect(validatePetanqueScore(-1, 13)).toHaveProperty('err');
  });

  it('refuse 0-0', () => {
    expect(validatePetanqueScore(0, 0)).toHaveProperty('err');
  });

  it('refuse une égalité', () => {
    expect(validatePetanqueScore(7, 7)).toHaveProperty('err');
  });

  it('refuse un score > 13', () => {
    expect(validatePetanqueScore(14, 10)).toHaveProperty('err');
  });

  it('avertit si le vainqueur a moins de 13', () => {
    expect(validatePetanqueScore(11, 9)).toHaveProperty('warn');
  });
});

// ─── computePoolSizes ────────────────────────────────────────────────────────

describe('computePoolSizes', () => {
  it('8 équipes → 2 poules de 4', () => {
    expect(computePoolSizes(8)).toEqual([4, 4]);
  });

  it('12 équipes → 3 poules de 4', () => {
    expect(computePoolSizes(12)).toEqual([4, 4, 4]);
  });

  it('10 équipes → 2 poules de 5', () => {
    expect(computePoolSizes(10)).toEqual([5, 5]);
  });

  it('9 équipes → 1 poule de 4 + 1 poule de 5', () => {
    const sizes = computePoolSizes(9);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('la somme couvre toujours toutes les équipes', () => {
    for (let n = 2; n <= 32; n++) {
      const sum = computePoolSizes(n).reduce((a, b) => a + b, 0);
      expect(sum, `n=${n}`).toBe(n);
    }
  });
});

// ─── computeStandings ────────────────────────────────────────────────────────

const T = (id) => ({ id });
const M = (eq1, eq2, s1, s2) => ({ eq1, eq2, score1: s1, score2: s2, joue: true });

describe('computeStandings', () => {
  it('classe par points : victoire = 2 pts', () => {
    const teams = [T('A'), T('B')];
    const matchs = [M('A', 'B', 13, 5)];
    const [first, second] = computeStandings(teams, matchs);
    expect(first.team.id).toBe('A');
    expect(first.pts).toBe(2);
    expect(second.pts).toBe(0);
  });

  it('départage par différence de buts', () => {
    const teams = [T('A'), T('B'), T('C')];
    const matchs = [
      M('A', 'B', 13, 5),
      M('C', 'A', 5, 13),
      M('B', 'C', 13, 5),
    ];
    const standings = computeStandings(teams, matchs);
    expect(standings.map(s => s.team.id)).toEqual(['A', 'B', 'C']);
  });

  it('ignore les matchs non joués', () => {
    const teams = [T('A'), T('B')];
    const matchs = [{ eq1: 'A', eq2: 'B', score1: 13, score2: 0, joue: false }];
    const standings = computeStandings(teams, matchs);
    expect(standings[0].pts).toBe(0);
    expect(standings[1].pts).toBe(0);
  });

  it('retourne le bon nombre de lignes', () => {
    const teams = [T('A'), T('B'), T('C'), T('D')];
    const matchs = [];
    expect(computeStandings(teams, matchs)).toHaveLength(4);
  });
});
