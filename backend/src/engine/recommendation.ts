import type {
  DraftState,
  Hero,
  HeroMetaTable,
  MatchupTable,
  PlayerProfile,
  Recommendation,
} from "../types.js";

const WEIGHTS = {
  counter: 0.40,
  synergy: 0.25,
  meta: 0.15,
  comfort: 0.20,
} as const;

interface Inputs {
  heroes: Hero[];
  matchups: MatchupTable;
  meta: HeroMetaTable;
  profile: PlayerProfile | null;
  draft: DraftState;
}

export function recommend(inputs: Inputs, limit = 8): Recommendation[] {
  const { heroes, matchups, meta, profile, draft } = inputs;
  const heroById = new Map(heroes.map((h) => [h.id, h]));

  const used = new Set<number>([
    ...draft.allyPicks,
    ...draft.enemyPicks,
    ...draft.bans,
  ]);

  const rolePool = heroes.filter(
    (h) => !used.has(h.id) && h.positions.includes(draft.yourRole)
  );
  const pool =
    rolePool.length >= limit
      ? rolePool
      : heroes.filter((h) => !used.has(h.id));

  const allyHeroes = draft.allyPicks
    .map((id) => heroById.get(id))
    .filter((h): h is Hero => Boolean(h));
  const allyRoles = new Set(allyHeroes.flatMap((h) => h.roles));
  const allyPositions = new Set(
    allyHeroes.flatMap((h) => h.positions.slice(0, 1))
  );

  const recs: Recommendation[] = [];

  for (const hero of pool) {
    const counterScore = scoreCounter(hero.id, draft.enemyPicks, matchups);
    const synergyScore = scoreSynergy(
      hero,
      allyHeroes,
      allyRoles,
      allyPositions,
      draft.yourRole
    );
    const metaScore = scoreMeta(hero.id, meta);
    const comfortScore = scoreComfort(hero.id, profile);
    const roleScore = scoreRole(hero, draft.yourRole);

    const total =
      counterScore * WEIGHTS.counter +
      synergyScore * WEIGHTS.synergy +
      metaScore * WEIGHTS.meta +
      comfortScore * WEIGHTS.comfort;

    recs.push({
      heroId: hero.id,
      totalScore: round1(total),
      breakdown: {
        counterScore: round1(counterScore),
        synergyScore: round1(synergyScore),
        metaScore: round1(metaScore),
        comfortScore: round1(comfortScore),
        roleScore: round1(roleScore),
      },
      suggestedPosition: pickBestPositionForRole(hero, draft.yourRole),
    });
  }

  recs.sort((a, b) => b.totalScore - a.totalScore);
  return recs.slice(0, limit);
}

function pickBestPositionForRole(hero: Hero, role: number): number {
  if (hero.positions.includes(role)) return role;
  return hero.positions[0] ?? role;
}

function scoreCounter(
  heroId: number,
  enemies: number[],
  matchups: MatchupTable
): number {
  if (enemies.length === 0) return 50;
  const heroMatchups = matchups[heroId];
  if (!heroMatchups) return 50;

  let sum = 0;
  let n = 0;
  for (const enemy of enemies) {
    const m = heroMatchups[enemy];
    if (!m || m.gamesPlayed < 50) continue;
    sum += clampNorm((m.winRate - 0.5) * 5 + 0.5);
    n++;
  }
  return n === 0 ? 50 : sum / n;
}

// Rewards heroes whose roles fill gaps in the ally team and penalizes
// position duplication.
function scoreSynergy(
  hero: Hero,
  allies: Hero[],
  allyRoles: Set<string>,
  allyPositions: Set<number>,
  yourRole: number
): number {
  if (allies.length === 0) return 50;

  let score = 50;

  const KEY_ROLES = ["Initiator", "Disabler", "Durable", "Nuker", "Support"];
  for (const role of KEY_ROLES) {
    if (!allyRoles.has(role) && hero.roles.includes(role)) {
      score += 6;
    }
  }

  if (allyRoles.has("Carry") && hero.roles.includes("Carry")) {
    score -= 18;
  }

  const heroPrimary = hero.positions[0];
  if (heroPrimary !== undefined && allyPositions.has(heroPrimary)) {
    score -= 10;
  }

  if (yourRole === 3 || yourRole === 4) {
    const hasMobileCarry = allies.some(
      (a) =>
        a.positions[0] === 1 &&
        (a.roles.includes("Escape") || a.roles.includes("Nuker"))
    );
    if (hasMobileCarry && hero.roles.includes("Initiator")) {
      score += 5;
    }
  }

  if (yourRole === 5 && allies.some((a) => a.roles.includes("Carry"))) {
    if (hero.roles.includes("Disabler") || hero.roles.includes("Nuker")) {
      score += 5;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function scoreMeta(heroId: number, meta: HeroMetaTable): number {
  const m = meta[heroId];
  if (!m) return 50;
  return clampNorm((m.winRate - 0.5) * 5 + 0.5);
}

function scoreComfort(heroId: number, profile: PlayerProfile | null): number {
  if (!profile) return 50;
  const c = profile.heroComfort[heroId];
  if (!c) return 40;
  return c.comfortLevel * 20;
}

function scoreRole(hero: Hero, role: number): number {
  return hero.positions.includes(role) ? 100 : 30;
}

function clampNorm(v: number): number {
  return Math.max(0, Math.min(100, v * 100));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
