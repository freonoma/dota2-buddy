import { runClaude, extractJsonObject } from "../lib/claude.js";
import { getHeroes } from "../data/loader.js";
import type { Hero, ScreenshotImportResult } from "../types.js";

export { detectMode, detectCliBinary } from "../lib/claude.js";

interface RawExtraction {
  heroes: Array<{
    hero_name: string;
    games_played: number;
    wins?: number;
    win_rate_percent?: number;
  }>;
}

function buildExtractionPrompt(): string {
  const heroNames = getHeroes()
    .map((h) => h.localizedName)
    .sort()
    .join(", ");

  return `You are reading a Dota 2 in-game hero statistics screenshot.

The screenshot shows a table with one row per hero. Each row has:
- A hero portrait (no name written — identify the hero from its portrait)
- Total games played (column labeled "G", "TOTAL", or "GAMES")
- Wins (column labeled "W" or "WINS")
- Win rate as a percentage (column labeled "W%" or "WIN RATE")
- Other stats like KDA / GPM / XPM — IGNORE these

CRITICAL: For each row, you MUST pick the hero name from this exact list, spelled EXACTLY as shown (case-sensitive, with all punctuation including apostrophes and hyphens):

${heroNames}

Do not invent names. Do not abbreviate. Do not use nicknames. If you are uncertain between two portraits, pick the one you are most confident about — but the name MUST come from the list above.

Tips for identifying portraits:
- Look at colors, silhouette, distinctive features
- Cross-reference with game counts: high-game heroes (50+) are usually core roles the player has spent time on
- If two rows have similar portraits, consider which hero is more commonly played

For EACH visible hero row, return a JSON object with:
- hero_name: the hero's name from the list (EXACT spelling from the list above)
- games_played: integer number of games (the TOTAL or G column)
- wins: integer number of wins (if visible, otherwise omit)
- win_rate_percent: number 0-100 (the WIN RATE or W% column, e.g. 52.8)

Return STRICTLY JSON in this exact format, no markdown, no explanation:
{"heroes":[{"hero_name":"Anti-Mage","games_played":72,"wins":38,"win_rate_percent":52.8}, ...]}

Read EVERY visible row. Include rows even if you're not 100% sure — pick your best guess from the list.`;
}

export async function extractFromScreenshot(
  base64Image: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
): Promise<ScreenshotImportResult> {
  const rawText = await runClaude({
    prompt: buildExtractionPrompt(),
    image: { base64: base64Image, mediaType },
  });

  const jsonStr = extractJsonObject(rawText);
  if (!jsonStr) {
    throw new Error(
      `No JSON object found in Claude response. First 500 chars:\n${rawText.slice(0, 500)}`
    );
  }

  let parsed: RawExtraction;
  try {
    parsed = JSON.parse(jsonStr) as RawExtraction;
  } catch {
    throw new Error(
      `Could not parse Claude response as JSON. Raw output:\n${rawText.slice(0, 500)}`
    );
  }

  return matchAndScore(parsed, rawText);
}

function matchAndScore(
  extraction: RawExtraction,
  rawText: string
): ScreenshotImportResult {
  const heroes = getHeroes();
  const matched: ScreenshotImportResult["matched"] = [];
  const unmatched: ScreenshotImportResult["unmatched"] = [];

  for (const row of extraction.heroes ?? []) {
    if (!row.hero_name || typeof row.games_played !== "number") continue;

    const hero = matchHero(row.hero_name, heroes);
    const winRate =
      typeof row.win_rate_percent === "number"
        ? row.win_rate_percent / 100
        : undefined;

    if (hero) {
      matched.push({
        heroId: hero.id,
        heroName: hero.localizedName,
        gamesPlayed: row.games_played,
        wins: row.wins,
        winRate,
        suggestedComfort: computeComfort(row.games_played, winRate),
      });
    } else {
      unmatched.push({
        rawName: row.hero_name,
        gamesPlayed: row.games_played,
        winRate,
      });
    }
  }

  return { matched, unmatched, rawText };
}

function matchHero(name: string, heroes: Hero[]): Hero | undefined {
  const lower = name.toLowerCase().trim();
  let hit = heroes.find((h) => h.localizedName.toLowerCase() === lower);
  if (hit) return hit;
  const aliases: Record<string, string> = {
    am: "anti-mage",
    cm: "crystal maiden",
    od: "outworld destroyer",
    qop: "queen of pain",
    sf: "shadow fiend",
    pa: "phantom assassin",
    sk: "sand king",
    ws: "wraith king",
    wk: "wraith king",
    tb: "terrorblade",
    np: "natures prophet",
    "nature's prophet": "natures prophet",
  };
  const aliased = aliases[lower];
  if (aliased) {
    hit = heroes.find((h) =>
      h.localizedName.toLowerCase().replace("'", "").includes(aliased)
    );
    if (hit) return hit;
  }
  hit = heroes.find((h) => h.localizedName.toLowerCase().includes(lower));
  if (hit) return hit;
  hit = heroes.find((h) => lower.includes(h.localizedName.toLowerCase()));
  if (hit) return hit;
  const noApos = lower.replace(/['']/g, "");
  hit = heroes.find(
    (h) => h.localizedName.toLowerCase().replace(/['']/g, "") === noApos
  );
  return hit;
}

function computeComfort(
  games: number,
  winRate?: number
): 1 | 2 | 3 | 4 | 5 {
  const wr = winRate ?? 0.5;
  if (games >= 100 && wr >= 0.52) return 5;
  if (games >= 100) return 4;
  if (games >= 50 && wr >= 0.55) return 5;
  if (games >= 50) return 4;
  if (games >= 20 && wr >= 0.55) return 4;
  if (games >= 20) return 3;
  if (games >= 5) return 2;
  return 1;
}
