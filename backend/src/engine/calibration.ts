import type { HeroMetaTable, MatchupTable } from "../types.js";

// Most of a matchup win rate is explained by the two heroes' overall strength:
// winRate(a vs b) ≈ 0.5 + beta * (globalWinRate(a) - globalWinRate(b)). The
// residual is what the pairing itself contributes, and it is mostly sampling
// noise, so it is shrunk by games / (games + prior).
export interface CounterModel {
  beta: number;
  prior: number;
  scale: number;
}

const MIN_GAMES = 100;
const TARGET_SPREAD = 12; // points of standard deviation on the 0-100 scale
const FALLBACK: CounterModel = { beta: 1, prior: 1200, scale: 13 };

export function fitCounterModel(
  matchups: MatchupTable,
  meta: HeroMetaTable
): CounterModel {
  const diffs: number[] = [];
  const rates: number[] = [];
  const games: number[] = [];

  for (const heroId of Object.keys(matchups).map(Number)) {
    const own = meta[heroId];
    if (!own) continue;
    for (const [enemyId, m] of Object.entries(matchups[heroId])) {
      const other = meta[Number(enemyId)];
      if (!other || m.gamesPlayed < MIN_GAMES) continue;
      diffs.push(own.winRate - other.winRate);
      rates.push(m.winRate);
      games.push(m.gamesPlayed);
    }
  }

  if (diffs.length < 500) return FALLBACK;

  const meanDiff = mean(diffs);
  const meanRate = mean(rates);
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < diffs.length; i++) {
    covariance += (diffs[i] - meanDiff) * (rates[i] - meanRate);
    variance += (diffs[i] - meanDiff) ** 2;
  }
  if (variance === 0) return FALLBACK;
  const beta = covariance / variance;
  const intercept = meanRate - beta * meanDiff;

  const residuals = rates.map(
    (rate, i) => rate - (intercept + beta * diffs[i])
  );
  const residualVar = mean(residuals.map((r) => r * r));
  const perGameVar = mean(rates.map((r) => r * (1 - r)));
  const noiseVar = mean(rates.map((r, i) => (r * (1 - r)) / games[i]));
  const signalVar = residualVar - noiseVar;
  if (signalVar <= 0) return FALLBACK;

  const prior = perGameVar / signalVar;
  const shrunk = residuals.map((r, i) => r * (games[i] / (games[i] + prior)));
  const shrunkSd = Math.sqrt(mean(shrunk.map((r) => r * r)));
  const scale = shrunkSd > 0 ? TARGET_SPREAD / (shrunkSd * 100) : FALLBACK.scale;

  return { beta, prior, scale };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
