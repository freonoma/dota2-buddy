import { fitCounterModel, type CounterModel } from "./calibration.js";
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

// A lane matchup lasts ten minutes; the rest you only meet in fights.
const LANE_OPPONENTS: Record<number, number[]> = {
  1: [3, 4],
  2: [2],
  3: [1, 5],
  4: [1, 5],
  5: [3, 4],
};
const LANE_WEIGHT = 2;

interface Inputs {
  heroes: Hero[];
  matchups: MatchupTable;
  meta: HeroMetaTable;
  profile: PlayerProfile | null;
  draft: DraftState;
}

// reloadDynamicData swaps the tables wholesale rather than mutating them.
const modelCache = new WeakMap<object, CounterModel>();

function counterModel(
  matchups: MatchupTable,
  meta: HeroMetaTable
): CounterModel {
  const cached = modelCache.get(matchups);
  if (cached) return cached;
  const model = fitCounterModel(matchups, meta);
  modelCache.set(matchups, model);
  return model;
}

export function recommend(inputs: Inputs, limit = 8): Recommendation[] {
  const { heroes, matchups, meta, profile, draft } = inputs;
  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const model = counterModel(matchups, meta);

  const used = new Set<number>([
    ...draft.allyPicks,
    ...draft.enemyPicks,
    ...draft.bans,
  ]);

  const available = heroes.filter((h) => !used.has(h.id));
  const rolePool = available.filter((h) => h.positions.includes(draft.yourRole));
  const pool = rolePool.length > 0 ? rolePool : available;

  const enemies = draft.enemyPicks
    .map((id) => heroById.get(id))
    .filter((h): h is Hero => Boolean(h));
  const allyHeroes = draft.allyPicks
    .map((id) => heroById.get(id))
    .filter((h): h is Hero => Boolean(h));
  const allyRoles = new Set(allyHeroes.flatMap((h) => h.roles));

  const recs: Recommendation[] = [];

  for (const hero of pool) {
    const counterScore = scoreCounter(
      hero,
      enemies,
      draft.yourRole,
      matchups,
      meta,
      model
    );
    const synergyScore = scoreSynergy(
      hero,
      allyHeroes,
      allyRoles,
      draft.yourRole
    );
    const metaScore = scoreMeta(hero.id, meta);
    const comfortScore = scoreComfort(hero.id, profile);

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

// Only the part of the matchup the hero's own strength does not explain.
function scoreCounter(
  hero: Hero,
  enemies: Hero[],
  yourRole: number,
  matchups: MatchupTable,
  meta: HeroMetaTable,
  model: CounterModel
): number {
  if (enemies.length === 0) return 50;

  const row = matchups[hero.id];
  const own = meta[hero.id];
  if (!row || !own) return 50;

  const laneOpponents = LANE_OPPONENTS[yourRole] ?? [];
  let weighted = 0;
  let totalWeight = 0;

  for (const enemy of enemies) {
    const m = row[enemy.id];
    const other = meta[enemy.id];
    if (!m || !other || m.gamesPlayed <= 0) continue;

    const expected = 0.5 + model.beta * (own.winRate - other.winRate);
    const residual = m.winRate - expected;
    const confidence = m.gamesPlayed / (m.gamesPlayed + model.prior);
    const lanes = enemy.positions.some((p) => laneOpponents.includes(p));

    const weight = lanes ? LANE_WEIGHT : 1;
    weighted += residual * confidence * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 50;
  const edge = weighted / totalWeight;
  return clamp(50 + edge * 100 * model.scale);
}

// Rewards heroes whose roles fill gaps in the ally team and penalizes stacking
// another carry on a team that already has one.
function scoreSynergy(
  hero: Hero,
  allies: Hero[],
  allyRoles: Set<string>,
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

  return clamp(score);
}

function scoreMeta(heroId: number, meta: HeroMetaTable): number {
  const m = meta[heroId];
  if (!m) return 50;
  return clamp(((m.winRate - 0.5) * 5 + 0.5) * 100);
}

function scoreComfort(heroId: number, profile: PlayerProfile | null): number {
  const c = profile?.heroComfort?.[heroId];
  if (!c) return 40;
  return c.comfortLevel * 20;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
