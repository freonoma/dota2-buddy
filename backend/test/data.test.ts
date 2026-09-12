import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR, getHeroes } from "../src/data/loader.js";
import { HERO_POSITIONS } from "../src/data/hero_positions.js";
import type { HeroMetaTable, MatchupTable } from "../src/types.js";

const heroes = getHeroes();
const heroIds = new Set(heroes.map((h) => h.id));

const matchupsPath = join(DATA_DIR, "matchups.json");
const statsPath = join(DATA_DIR, "hero_stats.json");
const hasMatchups = existsSync(matchupsPath);
const hasStats = existsSync(statsPath);

describe("hero roster", () => {
  it("loads a full roster", () => {
    expect(heroes.length).toBeGreaterThan(100);
  });

  it("gives every hero at least one position", () => {
    const bad = heroes.filter((h) => !h.positions.length).map((h) => h.localizedName);
    expect(bad).toEqual([]);
  });

  it("only uses positions 1-5", () => {
    const bad = heroes.filter((h) => h.positions.some((p) => p < 1 || p > 5));
    expect(bad.map((h) => h.localizedName)).toEqual([]);
  });

  it("offers enough heroes in every position to fill a recommendation list", () => {
    for (const pos of [1, 2, 3, 4, 5]) {
      expect(heroes.filter((h) => h.positions.includes(pos)).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("has no curated position entry for a hero that no longer exists", () => {
    const stale = Object.keys(HERO_POSITIONS)
      .map(Number)
      .filter((id) => !heroIds.has(id));
    expect(stale).toEqual([]);
  });

  it("curates a position for every hero in the roster", () => {
    const uncurated = heroes.filter((h) => !HERO_POSITIONS[h.id]).map((h) => h.localizedName);
    expect(uncurated).toEqual([]);
  });

  // An existence check still passes when an entry is filed under the wrong hero.
  it("files the recently added heroes under the right ids", () => {
    expect(HERO_POSITIONS[145]?.some((p) => p === 1 || p === 2), "Kez is a core").toBe(true);
    expect(HERO_POSITIONS[131]?.some((p) => p === 4 || p === 5), "Ring Master is a support").toBe(true);
  });

  it("gives every hero a usable icon url", () => {
    expect(heroes.every((h) => h.iconUrl.startsWith("https://"))).toBe(true);
  });
});

describe.skipIf(!hasMatchups)("matchups.json", () => {
  const matchups = JSON.parse(readFileSync(matchupsPath, "utf8")) as MatchupTable;

  it("only references known hero ids", () => {
    for (const a of Object.keys(matchups).map(Number)) {
      expect(heroIds.has(a)).toBe(true);
      for (const b of Object.keys(matchups[a]).map(Number)) expect(heroIds.has(b)).toBe(true);
    }
  });

  it("keeps every win rate a fraction in 0..1", () => {
    const bad: string[] = [];
    for (const a of Object.keys(matchups).map(Number))
      for (const [b, m] of Object.entries(matchups[a]))
        if (!(m.winRate >= 0 && m.winRate <= 1)) bad.push(`${a}v${b}=${m.winRate}`);
    expect(bad).toEqual([]);
  });

  it("keeps wins consistent with games played", () => {
    const bad: string[] = [];
    for (const a of Object.keys(matchups).map(Number))
      for (const [b, m] of Object.entries(matchups[a])) {
        if (m.wins > m.gamesPlayed) bad.push(`${a}v${b} wins>games`);
        if (m.gamesPlayed > 0 && Math.abs(m.wins / m.gamesPlayed - m.winRate) > 0.01)
          bad.push(`${a}v${b} winRate mismatch`);
      }
    expect(bad).toEqual([]);
  });

  it("stores A-vs-B from A's perspective (antisymmetric, not mirrored)", () => {
    // Written from the wrong side these would be equal rather than sum to 1.
    let antisym = 0;
    let mirrored = 0;
    for (const a of Object.keys(matchups).map(Number))
      for (const b of Object.keys(matchups[a]).map(Number)) {
        if (b <= a || !matchups[b]?.[a]) continue;
        if (matchups[a][b].gamesPlayed < 500 || matchups[b][a].gamesPlayed < 500) continue;
        const x = matchups[a][b].winRate;
        const y = matchups[b][a].winRate;
        if (Math.abs(x + y - 1) < 0.03) antisym++;
        if (Math.abs(x - y) < 0.03 && Math.abs(x - 0.5) > 0.02) mirrored++;
      }
    expect(antisym).toBeGreaterThan(mirrored * 5);
  });
});

describe.skipIf(!hasStats)("hero_stats.json", () => {
  const stats = JSON.parse(readFileSync(statsPath, "utf8")) as HeroMetaTable;

  it("only references known hero ids", () => {
    for (const id of Object.keys(stats).map(Number)) expect(heroIds.has(id)).toBe(true);
  });

  it("keeps win rate a fraction and pick rate non-negative", () => {
    for (const [id, m] of Object.entries(stats)) {
      expect(m.winRate, `hero ${id}`).toBeGreaterThanOrEqual(0);
      expect(m.winRate, `hero ${id}`).toBeLessThanOrEqual(1);
      expect(m.pickRate, `hero ${id}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("has a plausible average win rate near 50%", () => {
    const rates = Object.values(stats).map((m) => m.winRate);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(mean).toBeGreaterThan(0.44);
    expect(mean).toBeLessThan(0.56);
  });
});
