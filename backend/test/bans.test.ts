import { describe, expect, it } from "vitest";
import { suggestBans } from "../src/engine/bans.js";
import { hero, matchup, profile } from "./fixtures.js";
import type { PlayerProfile } from "../src/types.js";

const MINE_A = 10, MINE_B = 11, THREAT = 20, HARMLESS = 21;

const heroes = [
  hero({ id: MINE_A, localizedName: "Mine A" }),
  hero({ id: MINE_B, localizedName: "Mine B" }),
  hero({ id: THREAT, localizedName: "Threat" }),
  hero({ id: HARMLESS, localizedName: "Harmless" }),
];

describe("ban suggestions", () => {
  it("suggests the hero that beats the user's comfort pool", () => {
    const out = suggestBans({
      heroes,
      meta: {},
      matchups: matchup({
        [MINE_A]: { [THREAT]: [500, 0.40], [HARMLESS]: [500, 0.60] },
        [MINE_B]: { [THREAT]: [500, 0.43], [HARMLESS]: [500, 0.55] },
      }),
      profile: profile({ [MINE_A]: 5, [MINE_B]: 4 }),
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].heroId).toBe(THREAT);
    expect(out.map((b) => b.heroId)).not.toContain(HARMLESS);
  });

  it("reports the win rate against the user, not the user's win rate", () => {
    const out = suggestBans({
      heroes,
      meta: {},
      matchups: matchup({ [MINE_A]: { [THREAT]: [500, 0.40] } }),
      profile: profile({ [MINE_A]: 5 }),
    });
    const worst = out[0].worstMatchups[0];
    expect(worst.heroId).toBe(MINE_A);
    // The user wins 40%, so the threat wins 60% against them.
    expect(worst.winRateAgainstYou).toBeCloseTo(0.60, 5);
  });

  it("ignores matchups below the 100-game threshold", () => {
    const out = suggestBans({
      heroes,
      meta: {},
      matchups: matchup({ [MINE_A]: { [THREAT]: [30, 0.10] } }),
      profile: profile({ [MINE_A]: 5 }),
    });
    expect(out).toHaveLength(0);
  });

  it("ignores heroes below the comfort threshold", () => {
    const out = suggestBans({
      heroes,
      meta: {},
      matchups: matchup({ [MINE_A]: { [THREAT]: [500, 0.40] } }),
      profile: profile({ [MINE_A]: 2 }),
    });
    expect(out).toHaveLength(0);
  });

  it("returns an empty list when there is no profile", () => {
    expect(suggestBans({ heroes, matchups: {}, meta: {}, profile: null })).toEqual([]);
  });

  it("returns at most the requested limit, sorted by ban score", () => {
    const out = suggestBans(
      {
        heroes,
        meta: {},
        matchups: matchup({
          [MINE_A]: { [THREAT]: [500, 0.35], [HARMLESS]: [500, 0.47] },
        }),
        profile: profile({ [MINE_A]: 5 }),
      },
      1
    );
    expect(out).toHaveLength(1);
    expect(out[0].heroId).toBe(THREAT);
  });

  // Weighting by sqrt(games) would drop every hand-rated hero.
  it("still suggests bans when comfort heroes were rated by hand", () => {
    const manual: PlayerProfile = {
      name: "t",
      rankBracket: "legend",
      preferredRoles: [3],
      lastUpdated: "",
      heroComfort: { [MINE_A]: { comfortLevel: 5 }, [MINE_B]: { comfortLevel: 4 } },
    };
    const out = suggestBans({
      heroes,
      meta: {},
      matchups: matchup({
        [MINE_A]: { [THREAT]: [500, 0.4] },
        [MINE_B]: { [THREAT]: [500, 0.42] },
      }),
      profile: manual,
    });
    expect(out.length).toBeGreaterThan(0);
  });

  it("never suggests banning a hero from the user's own pool", () => {
    const out = suggestBans({
      heroes,
      meta: {},
      matchups: matchup({
        [MINE_A]: { [MINE_B]: [500, 0.4] },
        [MINE_B]: { [MINE_A]: [500, 0.6] },
      }),
      profile: profile({ [MINE_A]: 5, [MINE_B]: 4 }),
    });
    expect(out.filter((b) => b.heroId === MINE_A || b.heroId === MINE_B)).toEqual([]);
  });

  it("does not throw on a profile with no heroComfort", () => {
    const partial = {
      name: "partial",
      rankBracket: "legend",
      preferredRoles: [3],
      lastUpdated: "",
    } as unknown as PlayerProfile;
    expect(() =>
      suggestBans({ heroes, matchups: {}, meta: {}, profile: partial })
    ).not.toThrow();
  });
});
