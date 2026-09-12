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

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Could not parse Claude response as JSON. Raw output:\n${rawText.slice(0, 500)}`
    );
  }

  return matchAndScore(parsed, rawText);
}

function matchAndScore(
  parsed: unknown,
  rawText: string
): ScreenshotImportResult {
  const payload = parsed as { heroes?: unknown } | null;
  if (!payload || !Array.isArray(payload.heroes)) {
    throw new Error(
      `Claude response contained no "heroes" array. Raw output:\n${rawText.slice(0, 500)}`
    );
  }

  const heroes = getHeroes();
  const matched: ScreenshotImportResult["matched"] = [];
  const unmatched: ScreenshotImportResult["unmatched"] = [];

  for (const row of payload.heroes as unknown[]) {
    const record = (row ?? {}) as Partial<RawExtraction["heroes"][number]>;
    const rawName =
      typeof record.hero_name === "string" ? record.hero_name.trim() : "";
    const gamesPlayed = toCount(record.games_played);
    const winRate = toWinRate(record.win_rate_percent);
    const hero = rawName ? matchHero(rawName, heroes) : undefined;

    if (!hero || gamesPlayed === undefined) {
      unmatched.push({
        rawName: rawName || "(unreadable row)",
        gamesPlayed: gamesPlayed ?? 0,
        winRate,
      });
      continue;
    }

    matched.push({
      heroId: hero.id,
      heroName: hero.localizedName,
      gamesPlayed,
      wins: toCount(record.wins),
      winRate,
      suggestedComfort: computeComfort(gamesPlayed, winRate),
    });
  }

  return { matched, unmatched, rawText };
}

function toCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}

function toWinRate(percent: unknown): number | undefined {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
  if (percent < 0 || percent > 100) return undefined;
  return percent / 100;
}

// "od" is inside "Bloodseeker", "io" inside "Legion Commander".
const MIN_SUBSTRING_LENGTH = 4;

export function matchHero(name: string, heroes: Hero[]): Hero | undefined {
  const query = normalizeName(name);
  if (!query) return undefined;

  const exact = heroes.find((h) => normalizeName(h.localizedName) === query);
  if (exact) return exact;

  const aliases: Record<string, string> = {
    am: "anti-mage",
    cm: "crystal maiden",
    od: "outworld devourer",
    qop: "queen of pain",
    sf: "shadow fiend",
    pa: "phantom assassin",
    sk: "sand king",
    ws: "wraith king",
    wk: "wraith king",
    tb: "terrorblade",
    np: "natures prophet",
  };
  const aliased = aliases[query];
  if (aliased) {
    const hit = heroes.find((h) => normalizeName(h.localizedName) === aliased);
    if (hit) return hit;
  }

  if (query.length < MIN_SUBSTRING_LENGTH) return undefined;

  const contains = heroes.filter((h) =>
    normalizeName(h.localizedName).includes(query)
  );
  if (contains.length > 0) {
    return contains.length === 1 ? contains[0] : undefined;
  }

  const containedBy = heroes.filter((h) => {
    const heroName = normalizeName(h.localizedName);
    return heroName.length >= MIN_SUBSTRING_LENGTH && query.includes(heroName);
  });
  return containedBy.length === 1 ? containedBy[0] : undefined;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/['’]/g, "");
}

export function computeComfort(
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
