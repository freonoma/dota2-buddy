import type { Hero, HeroMetaTable, MatchupTable, PlayerProfile } from "../src/types.js";

export function hero(over: Partial<Hero> & { id: number }): Hero {
  return {
    name: `npc_dota_hero_${over.id}`,
    shortName: `h${over.id}`,
    localizedName: `Hero ${over.id}`,
    primaryAttr: "str",
    attackType: "Melee",
    roles: [],
    iconUrl: "",
    positions: [3],
    ...over,
  };
}

export function matchup(
  rows: Record<number, Record<number, [games: number, winRate: number]>>
): MatchupTable {
  const out: MatchupTable = {};
  for (const [a, vs] of Object.entries(rows)) {
    out[Number(a)] = {};
    for (const [b, [games, wr]] of Object.entries(vs)) {
      out[Number(a)][Number(b)] = {
        gamesPlayed: games,
        wins: Math.round(games * wr),
        winRate: wr,
      };
    }
  }
  return out;
}

export function meta(rows: Record<number, number>): HeroMetaTable {
  const out: HeroMetaTable = {};
  for (const [id, wr] of Object.entries(rows)) {
    out[Number(id)] = { pickRate: 1000, winRate: wr };
  }
  return out;
}

export function profile(
  comfort: Record<number, 1 | 2 | 3 | 4 | 5>,
  games: Record<number, number> = {}
): PlayerProfile {
  const heroComfort: PlayerProfile["heroComfort"] = {};
  for (const [id, level] of Object.entries(comfort)) {
    heroComfort[Number(id)] = {
      comfortLevel: level,
      gamesPlayed: games[Number(id)] ?? 150,
    };
  }
  return {
    name: "Test Player",
    rankBracket: "legend",
    preferredRoles: [3],
    heroComfort,
    lastUpdated: "2026-01-01T00:00:00.000Z",
  };
}

export function draft(over: Partial<import("../src/types.js").DraftState> = {}) {
  return {
    allyPicks: [],
    enemyPicks: [],
    bans: [],
    yourRole: 3,
    round: 1 as const,
    yourSide: "radiant" as const,
    ...over,
  };
}
