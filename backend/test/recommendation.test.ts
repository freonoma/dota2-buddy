import { describe, expect, it } from "vitest";
import { recommend } from "../src/engine/recommendation.js";
import type { PlayerProfile } from "../src/types.js";
import { draft, hero, matchup, meta, profile } from "./fixtures.js";

// A small synthetic roster: three offlaners (pos 3) and three carries (pos 1).
const OFF_A = 101, OFF_B = 102, OFF_C = 103;
const CARRY_A = 201, CARRY_B = 202, CARRY_C = 203;
const ENEMY = 301;

const heroes = [
  hero({ id: OFF_A, positions: [3], roles: ["Initiator", "Durable"] }),
  hero({ id: OFF_B, positions: [3], roles: ["Durable"] }),
  hero({ id: OFF_C, positions: [3], roles: ["Nuker"] }),
  hero({ id: CARRY_A, positions: [1], roles: ["Carry", "Escape"] }),
  hero({ id: CARRY_B, positions: [1], roles: ["Carry"] }),
  hero({ id: CARRY_C, positions: [1], roles: ["Carry"] }),
  hero({ id: ENEMY, positions: [1], roles: ["Carry"] }),
];

const flatMeta = meta(
  Object.fromEntries(heroes.map((h) => [h.id, 0.5]))
);

describe("role filtering", () => {
  it("never recommends an off-role hero while enough on-role heroes exist", () => {
    const recs = recommend(
      {
        heroes,
        matchups: {},
        meta: flatMeta,
        // A 5-star carry must not outrank on-role offlaners for a pos 3 request.
        profile: profile({ [CARRY_A]: 5, [CARRY_B]: 5, [CARRY_C]: 5 }),
        draft: draft({ yourRole: 3 }),
      },
      3
    );
    expect(recs).toHaveLength(3);
    for (const r of recs) {
      expect(heroes.find((h) => h.id === r.heroId)!.positions).toContain(3);
    }
  });

  it("returns a short list rather than padding it with off-role heroes", () => {
    const recs = recommend(
      { heroes, matchups: {}, meta: flatMeta, profile: null, draft: draft({ yourRole: 3 }) },
      6
    );
    expect(recs.length).toBe(3);
    for (const r of recs) {
      expect(heroes.find((h) => h.id === r.heroId)!.positions).toContain(3);
    }
  });

  it("falls back to the full pool only when no hero can play the role", () => {
    const recs = recommend(
      { heroes, matchups: {}, meta: flatMeta, profile: null, draft: draft({ yourRole: 5 }) },
      3
    );
    expect(recs.length).toBe(3);
  });

  it("suggestedPosition matches the requested role when the hero can play it", () => {
    const recs = recommend(
      { heroes, matchups: {}, meta: flatMeta, profile: null, draft: draft({ yourRole: 3 }) },
      3
    );
    for (const r of recs) expect(r.suggestedPosition).toBe(3);
  });
});

describe("exclusions", () => {
  it("never recommends a hero already picked or banned by anyone", () => {
    const recs = recommend(
      {
        heroes,
        matchups: {},
        meta: flatMeta,
        profile: null,
        draft: draft({ yourRole: 3, allyPicks: [OFF_A], enemyPicks: [OFF_B], bans: [OFF_C] }),
      },
      7
    );
    const ids = recs.map((r) => r.heroId);
    expect(ids).not.toContain(OFF_A);
    expect(ids).not.toContain(OFF_B);
    expect(ids).not.toContain(OFF_C);
  });
});

describe("counter scoring", () => {
  it("ranks a hero that beats the enemy above one that loses to it", () => {
    const recs = recommend(
      {
        heroes,
        matchups: matchup({
          [OFF_A]: { [ENEMY]: [500, 0.58] },
          [OFF_B]: { [ENEMY]: [500, 0.42] },
        }),
        meta: flatMeta,
        profile: null,
        draft: draft({ yourRole: 3, enemyPicks: [ENEMY] }),
      },
      3
    );
    const a = recs.find((r) => r.heroId === OFF_A)!;
    const b = recs.find((r) => r.heroId === OFF_B)!;
    expect(a.breakdown.counterScore).toBeGreaterThan(b.breakdown.counterScore);
    expect(recs.findIndex((r) => r.heroId === OFF_A)).toBeLessThan(
      recs.findIndex((r) => r.heroId === OFF_B)
    );
  });

  // Simply winning a lot is what scoreMeta rewards, not this.
  it("scores a hero that beats everyone equally at the neutral 50", () => {
    const strong = meta({ [OFF_A]: 0.58, [OFF_B]: 0.5, [OFF_C]: 0.5, [ENEMY]: 0.5 });
    const recs = recommend(
      {
        heroes,
        matchups: matchup({ [OFF_A]: { [ENEMY]: [5000, 0.58] } }),
        meta: strong,
        profile: null,
        draft: draft({ yourRole: 3, enemyPicks: [ENEMY] }),
      },
      3
    );
    expect(recs.find((r) => r.heroId === OFF_A)!.breakdown.counterScore).toBeCloseTo(50, 0);
  });

  it("shrinks a small sample toward the neutral score", () => {
    const small = recommend(
      {
        heroes,
        matchups: matchup({ [OFF_A]: { [ENEMY]: [12, 0.95] } }),
        meta: flatMeta,
        profile: null,
        draft: draft({ yourRole: 3, enemyPicks: [ENEMY] }),
      },
      3
    ).find((r) => r.heroId === OFF_A)!.breakdown.counterScore;

    const large = recommend(
      {
        heroes,
        matchups: matchup({ [OFF_A]: { [ENEMY]: [5000, 0.95] } }),
        meta: flatMeta,
        profile: null,
        draft: draft({ yourRole: 3, enemyPicks: [ENEMY] }),
      },
      3
    ).find((r) => r.heroId === OFF_A)!.breakdown.counterScore;

    expect(small).toBeGreaterThan(50);
    expect(small).toBeLessThan(60);
    expect(large).toBeGreaterThan(small);
  });

  it("weights a lane opponent above a hero you never lane against", () => {
    // At pos 3 you lane against pos 1 and pos 5, not against a mid.
    const laner = hero({ id: 401, positions: [1], roles: [] });
    const mid = hero({ id: 402, positions: [2], roles: [] });
    const roster = [...heroes, laner, mid];
    const matchups = matchup({
      [OFF_A]: { [laner.id]: [5000, 0.56], [mid.id]: [5000, 0.44] },
      [OFF_B]: { [laner.id]: [5000, 0.44], [mid.id]: [5000, 0.56] },
    });
    const flat = meta(Object.fromEntries(roster.map((h) => [h.id, 0.5])));
    const recs = recommend(
      {
        heroes: roster,
        matchups,
        meta: flat,
        profile: null,
        draft: draft({ yourRole: 3, enemyPicks: [laner.id, mid.id] }),
      },
      3
    );
    const a = recs.find((r) => r.heroId === OFF_A)!.breakdown.counterScore;
    const b = recs.find((r) => r.heroId === OFF_B)!.breakdown.counterScore;
    expect(a).toBeGreaterThan(b);
  });

  it("returns the neutral score when there are no enemy picks", () => {
    const recs = recommend(
      { heroes, matchups: {}, meta: flatMeta, profile: null, draft: draft({ yourRole: 3 }) },
      3
    );
    for (const r of recs) expect(r.breakdown.counterScore).toBe(50);
  });
});

describe("comfort scoring", () => {
  it("scores an unrated hero below a rated one and uses level*20", () => {
    const recs = recommend(
      {
        heroes,
        matchups: {},
        meta: flatMeta,
        profile: profile({ [OFF_A]: 5, [OFF_B]: 1 }),
        draft: draft({ yourRole: 3 }),
      },
      3
    );
    expect(recs.find((r) => r.heroId === OFF_A)!.breakdown.comfortScore).toBe(100);
    expect(recs.find((r) => r.heroId === OFF_B)!.breakdown.comfortScore).toBe(20);
    expect(recs.find((r) => r.heroId === OFF_C)!.breakdown.comfortScore).toBe(40);
  });
});

describe("output invariants", () => {
  const recs = recommend(
    {
      heroes,
      matchups: matchup({ [OFF_A]: { [ENEMY]: [500, 0.58] } }),
      meta: flatMeta,
      profile: profile({ [OFF_A]: 4 }),
      draft: draft({ yourRole: 3, enemyPicks: [ENEMY], allyPicks: [CARRY_A] }),
    },
    5
  );

  it("returns scores sorted descending", () => {
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].totalScore).toBeGreaterThanOrEqual(recs[i].totalScore);
    }
  });

  it("keeps every score finite and within 0..100", () => {
    for (const r of recs) {
      for (const v of [r.totalScore, ...Object.values(r.breakdown)]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is deterministic across repeated calls", () => {
    const again = recommend(
      {
        heroes,
        matchups: matchup({ [OFF_A]: { [ENEMY]: [500, 0.58] } }),
        meta: flatMeta,
        profile: profile({ [OFF_A]: 4 }),
        draft: draft({ yourRole: 3, enemyPicks: [ENEMY], allyPicks: [CARRY_A] }),
      },
      5
    );
    expect(again).toEqual(recs);
  });
});

describe("malformed input resilience", () => {
  it("does not throw on duplicate ids in the draft", () => {
    expect(() =>
      recommend(
        {
          heroes,
          matchups: {},
          meta: flatMeta,
          profile: null,
          draft: draft({ yourRole: 3, allyPicks: [OFF_A, OFF_A, OFF_A] }),
        },
        3
      )
    ).not.toThrow();
  });

  it("does not throw on unknown hero ids in the draft", () => {
    expect(() =>
      recommend(
        {
          heroes,
          matchups: {},
          meta: flatMeta,
          profile: null,
          draft: draft({ yourRole: 3, enemyPicks: [999999] }),
        },
        3
      )
    ).not.toThrow();
  });

  // An unguarded lookup here would throw inside the WebSocket handler.
  it("does not throw on a profile with no heroComfort", () => {
    const partial = {
      name: "partial",
      rankBracket: "legend",
      preferredRoles: [3],
      lastUpdated: "",
    } as unknown as PlayerProfile;

    expect(() =>
      recommend(
        { heroes, matchups: {}, meta: flatMeta, profile: partial, draft: draft({ yourRole: 3 }) },
        3
      )
    ).not.toThrow();
  });

  it("does not throw on a role no hero can play", () => {
    expect(() =>
      recommend(
        { heroes, matchups: {}, meta: flatMeta, profile: null, draft: draft({ yourRole: 99 }) },
        3
      )
    ).not.toThrow();
  });
});
