import { runClaude } from "../lib/claude.js";
import { getHero } from "../data/loader.js";

export interface ReasoningRequest {
  heroId: number;
  allyHeroIds: number[];
  enemyHeroIds: number[];
  yourRole: number;
  rankBracket?: string;
}

const cache = new Map<string, string>();

function cacheKey(req: ReasoningRequest): string {
  const allies = [...req.allyHeroIds].sort((a, b) => a - b).join(",");
  const enemies = [...req.enemyHeroIds].sort((a, b) => a - b).join(",");
  return `${req.heroId}|${req.yourRole}|${allies}|${enemies}`;
}

function buildPrompt(req: ReasoningRequest): string {
  const hero = getHero(req.heroId);
  if (!hero) throw new Error(`unknown hero id ${req.heroId}`);

  const allyNames = req.allyHeroIds
    .map((id) => getHero(id)?.localizedName ?? `#${id}`)
    .join(", ") || "none yet";
  const enemyNames = req.enemyHeroIds
    .map((id) => getHero(id)?.localizedName ?? `#${id}`)
    .join(", ") || "none yet";
  const rolePos: Record<number, string> = {
    1: "Pos 1 (Safe Lane Carry)",
    2: "Pos 2 (Mid)",
    3: "Pos 3 (Offlane)",
    4: "Pos 4 (Soft Support / Roamer)",
    5: "Pos 5 (Hard Support)",
  };
  const role = rolePos[req.yourRole] ?? `Pos ${req.yourRole}`;
  const bracket = req.rankBracket ? ` at ${req.rankBracket} bracket` : "";

  return `You are a Dota 2 coaching assistant${bracket}.

A player is drafting Ranked All Pick and is considering picking ${hero.localizedName} for ${role}.

Allies already picked: ${allyNames}
Enemies already picked: ${enemyNames}

In 2-3 short sentences, explain why ${hero.localizedName} is (or isn't) a strong pick here. Be specific about ability interactions, lane matchups, and team-fight contributions when relevant. Focus on what makes this pick situationally good or bad — don't just describe the hero in general. No preamble, no markdown headers, just the explanation.`;
}

export async function explainPick(req: ReasoningRequest): Promise<string> {
  const key = cacheKey(req);
  const cached = cache.get(key);
  if (cached) return cached;

  const prompt = buildPrompt(req);
  const text = await runClaude({ prompt, maxTokens: 400 });
  const cleaned = text.trim();
  cache.set(key, cleaned);
  return cleaned;
}

export function clearReasoningCache(): void {
  cache.clear();
}
