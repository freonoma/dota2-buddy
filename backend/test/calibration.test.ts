import { describe, expect, it } from "vitest";
import { fitCounterModel } from "../src/engine/calibration.js";
import type { HeroMetaTable, MatchupTable } from "../src/types.js";

// A league where matchups are explained entirely by the two heroes' strength.
function synthetic(options: {
  heroes: number;
  games: number;
  interaction?: { a: number; b: number; delta: number };
}): { matchups: MatchupTable; meta: HeroMetaTable } {
  const meta: HeroMetaTable = {};
  const matchups: MatchupTable = {};
  for (let i = 1; i <= options.heroes; i++) {
    meta[i] = { pickRate: 1000, winRate: 0.45 + (i % 11) * 0.01 };
  }
  for (let a = 1; a <= options.heroes; a++) {
    matchups[a] = {};
    for (let b = 1; b <= options.heroes; b++) {
      if (a === b) continue;
      let winRate = 0.5 + (meta[a].winRate - meta[b].winRate);
      if (options.interaction?.a === a && options.interaction?.b === b) {
        winRate += options.interaction.delta;
      }
      matchups[a][b] = {
        gamesPlayed: options.games,
        wins: Math.round(options.games * winRate),
        winRate,
      };
    }
  }
  return { matchups, meta };
}

describe("counter model calibration", () => {
  it("recovers a slope of ~1 when matchups are pure hero strength", () => {
    const { matchups, meta } = synthetic({ heroes: 40, games: 2000 });
    const model = fitCounterModel(matchups, meta);
    expect(model.beta).toBeGreaterThan(0.9);
    expect(model.beta).toBeLessThan(1.1);
  });

  it("falls back to defaults when there is not enough data to fit", () => {
    const { matchups, meta } = synthetic({ heroes: 5, games: 2000 });
    const model = fitCounterModel(matchups, meta);
    expect(model).toEqual({ beta: 1, prior: 1200, scale: 13 });
  });

  it("returns a usable model on the shape the fetch script writes", () => {
    const { matchups, meta } = synthetic({
      heroes: 40,
      games: 800,
      interaction: { a: 1, b: 2, delta: 0.06 },
    });
    const model = fitCounterModel(matchups, meta);
    expect(Number.isFinite(model.beta)).toBe(true);
    expect(model.prior).toBeGreaterThan(0);
    expect(model.scale).toBeGreaterThan(0);
  });
});
