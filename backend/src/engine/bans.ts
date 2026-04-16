import type { Hero, MatchupTable, PlayerProfile } from "../types.js";

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
  profile: PlayerProfile | null;
}

const COMFORT_THRESHOLD = 3;
const MIN_MATCHUP_GAMES = 100;

// Picks the 4 heroes that hurt the user's hero pool the most. For each
// potential ban candidate E, we sum (1 - winRate) of the user's high-comfort
// heroes when they play into E. The bigger the loss, the higher the ban score.
export function suggestBans(inputs: Inputs, limit = 4): BanSuggestion[] {
  const { heroes, matchups, profile } = inputs;
  if (!profile) return [];

  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const ownPool = Object.entries(profile.heroComfort)
    .map(([id, c]) => ({
      heroId: Number(id),
      comfort: c.comfortLevel,
      games: c.gamesPlayed ?? 0,
    }))
    .filter((h) => h.comfort >= COMFORT_THRESHOLD);

  if (ownPool.length === 0) return [];

  type Detail = {
    score: number;
    matchupsHurting: Array<{
      heroId: number;
      heroName: string;
      winRateAgainstYou: number;
      yourComfort: number;
      yourGames: number;
    }>;
  };
  const banScores = new Map<number, Detail>();

  for (const candidate of heroes) {
    let totalScore = 0;
    const hurts: Detail["matchupsHurting"] = [];

    for (const own of ownPool) {
      const ownHero = heroById.get(own.heroId);
      if (!ownHero) continue;
      const m = matchups[own.heroId]?.[candidate.id];
      if (!m || m.gamesPlayed < MIN_MATCHUP_GAMES) continue;

      const userLossRate = 1 - m.winRate;
      if (m.winRate >= 0.5) continue;

      const weight = own.comfort * Math.sqrt(Math.min(own.games, 200));
      totalScore += (userLossRate - 0.5) * 100 * weight;

      hurts.push({
        heroId: own.heroId,
        heroName: ownHero.localizedName,
        winRateAgainstYou: 1 - m.winRate,
        yourComfort: own.comfort,
        yourGames: own.games,
      });
    }

    if (totalScore > 0) {
      hurts.sort((a, b) => b.winRateAgainstYou - a.winRateAgainstYou);
      banScores.set(candidate.id, {
        score: totalScore,
        matchupsHurting: hurts.slice(0, 3),
      });
    }
  }

  const ranked = Array.from(banScores.entries())
    .map(([heroId, detail]) => {
      const hero = heroById.get(heroId);
      if (!hero) return null;
      return {
        heroId,
        heroName: hero.localizedName,
        iconUrl: hero.iconUrl,
        banScore: Math.round(detail.score * 10) / 10,
        worstMatchups: detail.matchupsHurting,
      } satisfies BanSuggestion;
    })
    .filter((b): b is BanSuggestion => b !== null)
    .sort((a, b) => b.banScore - a.banScore);

  return ranked.slice(0, limit);
}
