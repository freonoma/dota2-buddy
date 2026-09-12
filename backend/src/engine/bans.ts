import type { Hero, HeroMetaTable, MatchupTable, PlayerProfile } from "../types.js";

export interface BanSuggestion {
  heroId: number;
  heroName: string;
  iconUrl: string;
  banScore: number;
  worstMatchups: Array<{
    heroId: number;
    heroName: string;
    winRateAgainstYou: number;
    yourComfort: number;
    yourGames: number;
  }>;
}

interface Inputs {
  heroes: Hero[];
  matchups: MatchupTable;
  meta: HeroMetaTable;
  profile: PlayerProfile | null;
}

const COMFORT_THRESHOLD = 3;
const MIN_MATCHUP_GAMES = 100;
const GAMES_CAP = 200;

// Hand-rated heroes carry no game count, and zero would drop them entirely.
const ASSUMED_GAMES = 25;

// Banning a hero nobody picks wastes it, but a rare counter should still rank.
const MIN_PICK_FACTOR = 0.5;
const MAX_PICK_FACTOR = 1.5;

// Ranks heroes by how badly they beat the user's comfort pool.
export function suggestBans(inputs: Inputs, limit = 4): BanSuggestion[] {
  const { heroes, matchups, meta, profile } = inputs;
  if (!profile) return [];

  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const ownPool = Object.entries(profile.heroComfort ?? {})
    .map(([id, c]) => ({
      heroId: Number(id),
      comfort: c.comfortLevel,
      games: c.gamesPlayed && c.gamesPlayed > 0 ? c.gamesPlayed : ASSUMED_GAMES,
    }))
    .filter((h) => h.comfort >= COMFORT_THRESHOLD);

  if (ownPool.length === 0) return [];

  const ownIds = new Set(ownPool.map((h) => h.heroId));
  const pickFactor = pickRateScaler(heroes, meta);

  const ranked: BanSuggestion[] = [];

  for (const candidate of heroes) {
    if (ownIds.has(candidate.id)) continue;

    let score = 0;
    const hurts: BanSuggestion["worstMatchups"] = [];

    for (const own of ownPool) {
      const ownHero = heroById.get(own.heroId);
      if (!ownHero) continue;
      const m = matchups[own.heroId]?.[candidate.id];
      if (!m || m.gamesPlayed < MIN_MATCHUP_GAMES || m.winRate >= 0.5) continue;

      const weight = own.comfort * Math.sqrt(Math.min(own.games, GAMES_CAP));
      score += (0.5 - m.winRate) * 100 * weight;

      hurts.push({
        heroId: own.heroId,
        heroName: ownHero.localizedName,
        winRateAgainstYou: 1 - m.winRate,
        yourComfort: own.comfort,
        yourGames: own.games,
      });
    }

    if (score <= 0) continue;

    hurts.sort((a, b) => b.winRateAgainstYou - a.winRateAgainstYou);
    ranked.push({
      heroId: candidate.id,
      heroName: candidate.localizedName,
      iconUrl: candidate.iconUrl,
      banScore: Math.round(score * pickFactor(candidate.id) * 10) / 10,
      worstMatchups: hurts.slice(0, 3),
    });
  }

  ranked.sort((a, b) => b.banScore - a.banScore);
  return ranked.slice(0, limit);
}

function pickRateScaler(
  heroes: Hero[],
  meta: HeroMetaTable
): (heroId: number) => number {
  const rates = heroes
    .map((h) => meta[h.id]?.pickRate ?? 0)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  if (rates.length === 0) return () => 1;

  const low = rates[Math.floor(rates.length * 0.1)];
  const high = rates[Math.floor(rates.length * 0.9)];
  if (high <= low) return () => 1;

  return (heroId) => {
    const rate = meta[heroId]?.pickRate;
    if (!rate) return MIN_PICK_FACTOR;
    const t = Math.max(0, Math.min(1, (rate - low) / (high - low)));
    return MIN_PICK_FACTOR + t * (MAX_PICK_FACTOR - MIN_PICK_FACTOR);
  };
}
