export function validatePetanqueScore(s1, s2) {
  s1 = Number(s1); s2 = Number(s2);
  if (s1 < 0 || s2 < 0)     return { err: 'Les scores ne peuvent pas etre negatifs.' };
  if (s1 === 0 && s2 === 0)  return { err: 'Le score 0-0 est invalide.' };
  if (s1 === s2)              return { err: "Pas d'egalite en petanque !" };
  if (s1 > 13 || s2 > 13)    return { err: 'Score maximum en petanque : 13 points.' };
  if (Math.max(s1, s2) < 13) return { warn: 'Le vainqueur n\'a que ' + Math.max(s1, s2) + ' points. Confirmer ?' };
  return { ok: true };
}

export function computePoolSizes(n) {
  const r = n % 4, full = Math.floor(n / 4);
  if (r === 0) return Array(full).fill(4);
  if (r >= 3)  return [...Array(full).fill(4), r];
  if (r === 1) return full ? [...Array(full - 1).fill(4), 5] : [1];
  if (n === 2) return [2];
  if (full < 2) return [3, 3];
  return [...Array(full - 2).fill(4), 5, 5];
}

// teams : tableau d'objets { id, ... }
// matchs : tableau d'objets { eq1, eq2, score1, score2, joue }
export function computeStandings(teams, matchs) {
  const played = matchs.filter(m => m.joue);
  const st = {};
  teams.forEach(t => { st[t.id] = { team: t, pts: 0, v: 0, d: 0, pf: 0, pc: 0 }; });
  played.forEach(m => {
    if (!st[m.eq1] || !st[m.eq2]) return;
    const s1 = Number(m.score1), s2 = Number(m.score2);
    st[m.eq1].pf += s1; st[m.eq1].pc += s2;
    st[m.eq2].pf += s2; st[m.eq2].pc += s1;
    if (s1 > s2)      { st[m.eq1].v++; st[m.eq1].pts += 2; st[m.eq2].d++; }
    else if (s2 > s1) { st[m.eq2].v++; st[m.eq2].pts += 2; st[m.eq1].d++; }
    else              { st[m.eq1].pts++; st[m.eq2].pts++; }
  });
  return Object.values(st).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const da = a.pf - a.pc, db = b.pf - b.pc;
    if (db !== da) return db - da;
    return b.pf - a.pf;
  });
}
