// Pulls hero stats and matchups from a public Dota 2 stats API and writes
// them to backend/data/ as JSON. Re-run after each Dota patch.
//
//   npm run fetch-data
//
// Source selection:
//   - STRATZ_API_KEY set → Stratz GraphQL (bracket-filtered matchups)
//   - otherwise          → OpenDota REST (global matchups, free, slower)

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { HeroMetaTable, MatchupTable } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (process.env.STRATZ_API_KEY) {
    console.log("Using Stratz GraphQL (STRATZ_API_KEY detected)");
    await fetchFromStratz();
  } else {
    console.log("Using OpenDota REST (no STRATZ_API_KEY set)");
    await fetchFromOpenDota();
  }

  console.log("\nDone. Restart the backend or POST /api/reload to pick up the new data.");
}

function writeOutputs(meta: HeroMetaTable, matchups: MatchupTable) {
  writeFileSync(
    join(DATA_DIR, "hero_stats.json"),
    JSON.stringify(meta, null, 2)
  );
  console.log(`     wrote hero_stats.json (${Object.keys(meta).length} heroes)`);

  if (Object.keys(matchups).length > 0) {
    writeFileSync(
      join(DATA_DIR, "matchups.json"),
      JSON.stringify(matchups, null, 2)
    );
    console.log(
      `     wrote matchups.json (${Object.keys(matchups).length} heroes)`
    );
  } else {
    console.log(
      `     no matchup data fetched — matchups.json not written. App will run without counter scoring.`
    );
  }
}

// ============================================================
// OpenDota path (default, free, no auth)
// ============================================================

const OPENDOTA_BASE = "https://api.opendota.com/api";
const OPENDOTA_INTERVAL_MS = 1100;

interface OpenDotaHeroStat {
  id: number;
  localized_name: string;
  pro_pick?: number;
  pro_win?: number;
  // Per-bracket fields: "<bracket>_pick" / "<bracket>_win" (1-8).
  // 5 = Legend, 6 = Ancient, 7 = Divine, 8 = Immortal.
  [key: string]: number | string | undefined;
}

interface OpenDotaMatchup {
  hero_id: number;
  games_played: number;
  wins: number;
}

async function fetchFromOpenDota() {
  console.log("[1/2] Fetching heroStats from OpenDota…");
  const heroStats = await opendotaFetch<OpenDotaHeroStat[]>(
    `${OPENDOTA_BASE}/heroStats`
  );
  console.log(`     got ${heroStats.length} heroes`);

  const heroMeta: HeroMetaTable = {};
  for (const h of heroStats) {
    const pick5 = num(h["5_pick"]);
    const win5 = num(h["5_win"]);
    const pick6 = num(h["6_pick"]);
    const win6 = num(h["6_win"]);
    const totalPicks = pick5 + pick6;
    const totalWins = win5 + win6;

    heroMeta[h.id] = {
      pickRate: totalPicks,
      winRate: totalPicks > 0 ? totalWins / totalPicks : 0.5,
      proPickRate: num(h.pro_pick),
      proWinRate:
        num(h.pro_pick) > 0 ? num(h.pro_win) / num(h.pro_pick) : undefined,
    };
  }

  console.log(`[2/2] Fetching matchups for ${heroStats.length} heroes…`);
  console.log(
    `     ~${Math.ceil((heroStats.length * OPENDOTA_INTERVAL_MS) / 1000)}s with rate limiting`
  );

  const matchups: MatchupTable = {};
  let i = 0;
  let consecutiveFails = 0;
  let totalFails = 0;
  const MAX_CONSECUTIVE_FAILS = 5;

  for (const h of heroStats) {
    i++;
    try {
      const data = await opendotaFetchRetry<OpenDotaMatchup[]>(
        `${OPENDOTA_BASE}/heroes/${h.id}/matchups`
      );
      const row: MatchupTable[number] = {};
      for (const m of data) {
        row[m.hero_id] = {
          gamesPlayed: m.games_played,
          wins: m.wins,
          winRate: m.games_played > 0 ? m.wins / m.games_played : 0.5,
        };
      }
      matchups[h.id] = row;
      consecutiveFails = 0;
      const pct = ((i / heroStats.length) * 100).toFixed(0);
      process.stdout.write(
        `\r     [${pct}%] ${i}/${heroStats.length} ${h.localized_name.padEnd(20)}\x1b[K`
      );
    } catch (e) {
      consecutiveFails++;
      totalFails++;
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(
        `\r     [skip] ${h.localized_name.padEnd(20)} (${msg})\n`
      );
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        console.log(
          `\n  ⚠  ${MAX_CONSECUTIVE_FAILS} consecutive failures, bailing out.`
        );
        console.log(`     OpenDota may be having an outage. Check status:`);
        console.log(
          `       curl -s -o /dev/null -w "%{http_code}\\n" https://api.opendota.com/api/heroes/1/matchups`
        );
        break;
      }
    }
    await sleep(OPENDOTA_INTERVAL_MS);
  }
  console.log("");
  if (totalFails > 0) {
    console.log(`     ${totalFails} hero(es) skipped due to errors`);
  }
  writeOutputs(heroMeta, matchups);
}

async function opendotaFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "dota2-buddy/0.1" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

async function opendotaFetchRetry<T>(
  url: string,
  attempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await opendotaFetch<T>(url);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await sleep(800 * Math.pow(2, i));
      }
    }
  }
  throw lastErr;
}

// ============================================================
// Stratz path (optional, requires STRATZ_API_KEY)
// ============================================================

const STRATZ_GRAPHQL = "https://api.stratz.com/graphql";
const STRATZ_INTERVAL_MS = 600; // ~100 req/min, well under the 150/min limit
const STRATZ_BRACKET = "LEGEND_ANCIENT"; // RankBracketBasicEnum value

async function fetchFromStratz() {
  console.log("[1/2] Fetching hero list from Stratz…");
  const heroListData = await stratzQuery<{
    constants: { heroes: Array<{ id: number; displayName: string }> };
  }>(`query { constants { heroes { id displayName } } }`);

  const heroes = heroListData.constants.heroes;
  console.log(`     got ${heroes.length} heroes`);

  console.log(
    `[2/2] Fetching ${STRATZ_BRACKET} matchups for ${heroes.length} heroes…`
  );
  console.log(
    `     ~${Math.ceil((heroes.length * STRATZ_INTERVAL_MS) / 1000)}s with rate limiting`
  );

  const matchups: MatchupTable = {};
  const heroMeta: HeroMetaTable = {};

  let i = 0;
  let totalFails = 0;
  let consecutiveFails = 0;
  const MAX_CONSECUTIVE_FAILS = 5;

  for (const h of heroes) {
    i++;
    try {
      const data = await stratzQuery<{
        heroStats: {
          matchUp: Array<{
            heroId: number;
            vs: Array<{
              heroId2: number;
              matchCount: number;
              winCount: number;
              winsAverage: number;
            }>;
          }>;
        };
      }>(
        `query Matchup($heroId: Short!) {
          heroStats {
            matchUp(heroIds: [$heroId], bracketBasicIds: [${STRATZ_BRACKET}], take: 200) {
              heroId
              vs {
                heroId2
                matchCount
                winCount
                winsAverage
              }
            }
          }
        }`,
        { heroId: h.id }
      );

      const row: MatchupTable[number] = {};
      let totalGames = 0;
      let totalWins = 0;
      const matchupRows = data.heroStats?.matchUp ?? [];
      for (const mu of matchupRows) {
        for (const m of mu.vs ?? []) {
          row[m.heroId2] = {
            gamesPlayed: m.matchCount,
            wins: m.winCount,
            winRate: m.winsAverage,
          };
          totalGames += m.matchCount;
          totalWins += m.winCount;
        }
      }
      matchups[h.id] = row;

      // Each game contributes 5 vs-entries (one per enemy hero), so the
      // sum is 5x the actual game count. Win rate is unaffected.
      heroMeta[h.id] = {
        pickRate: Math.floor(totalGames / 5),
        winRate: totalGames > 0 ? totalWins / totalGames : 0.5,
      };

      consecutiveFails = 0;
      const pct = ((i / heroes.length) * 100).toFixed(0);
      process.stdout.write(
        `\r     [${pct}%] ${i}/${heroes.length} ${h.displayName.padEnd(20)}\x1b[K`
      );
    } catch (e) {
      consecutiveFails++;
      totalFails++;
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(
        `\r     [skip] ${h.displayName.padEnd(20)} (${msg})\n`
      );
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        console.log(
          `\n  ⚠  ${MAX_CONSECUTIVE_FAILS} consecutive Stratz failures, bailing out.`
        );
        console.log(`     Check your STRATZ_API_KEY at https://stratz.com/api`);
        console.log(`     Or unset it in backend/.env to fall back to OpenDota.`);
        break;
      }
    }
    await sleep(STRATZ_INTERVAL_MS);
  }
  console.log("");
  if (totalFails > 0) {
    console.log(`     ${totalFails} hero(es) skipped due to errors`);
  }
  writeOutputs(heroMeta, matchups);
}

async function stratzQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(STRATZ_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRATZ_API_KEY}`,
      "Content-Type": "application/json",
      // Stratz requires a specific User-Agent header for some endpoints.
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stratz HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `Stratz GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  if (!json.data) {
    throw new Error(`Stratz returned no data`);
  }
  return json.data;
}

// ============================================================

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
