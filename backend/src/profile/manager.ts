import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../data/loader.js";
import type { PlayerProfile, ScreenshotImportResult } from "../types.js";

const PROFILE_PATH = join(DATA_DIR, "player_profile.json");

const VALID_RANKS = [
  "herald",
  "guardian",
  "crusader",
  "archon",
  "legend",
  "ancient",
  "divine",
  "immortal",
] as const;

function defaultProfileFromEnv(): PlayerProfile {
  const rawRank = (process.env.PLAYER_RANK ?? "legend").toLowerCase();
  const rankBracket = (
    VALID_RANKS.includes(rawRank as (typeof VALID_RANKS)[number])
      ? rawRank
      : "legend"
  ) as PlayerProfile["rankBracket"];

  const rawRoles = process.env.PLAYER_PREFERRED_ROLES;
  const preferredRoles = rawRoles
    ? rawRoles
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => n >= 1 && n <= 5)
    : [2, 3];

  return {
    name: process.env.PLAYER_NAME ?? "Player",
    friendId: process.env.PLAYER_FRIEND_ID || undefined,
    mmr: process.env.PLAYER_MMR
      ? Number(process.env.PLAYER_MMR)
      : undefined,
    rankBracket,
    preferredRoles: preferredRoles.length ? preferredRoles : [2, 3],
    heroComfort: {},
    lastUpdated: new Date().toISOString(),
  };
}

let cached: PlayerProfile | null = null;

export function getProfile(): PlayerProfile {
  if (cached) return cached;
  if (!existsSync(PROFILE_PATH)) {
    mkdirSync(DATA_DIR, { recursive: true });
    const seeded = defaultProfileFromEnv();
    writeFileSync(PROFILE_PATH, JSON.stringify(seeded, null, 2));
    cached = seeded;
    return cached;
  }
  try {
    const fromDisk = JSON.parse(readFileSync(PROFILE_PATH, "utf-8")) as PlayerProfile;
    cached = mergeEnvDefaults(fromDisk);
    return cached;
  } catch (e) {
    console.error("[profile] failed to read, using default:", e);
    cached = defaultProfileFromEnv();
    return cached;
  }
}

function mergeEnvDefaults(profile: PlayerProfile): PlayerProfile {
  const envDefault = defaultProfileFromEnv();
  const merged: PlayerProfile = { ...profile };
  if (process.env.PLAYER_NAME && (!profile.name || profile.name === "Player")) {
    merged.name = envDefault.name;
  }
  if (process.env.PLAYER_FRIEND_ID && !profile.friendId) {
    merged.friendId = envDefault.friendId;
  }
  if (process.env.PLAYER_MMR && !profile.mmr) {
    merged.mmr = envDefault.mmr;
  }
  if (process.env.PLAYER_RANK && !profile.rankBracket) {
    merged.rankBracket = envDefault.rankBracket;
  }
  return merged;
}

export function saveProfile(profile: PlayerProfile): PlayerProfile {
  const updated = { ...profile, lastUpdated: new Date().toISOString() };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROFILE_PATH, JSON.stringify(updated, null, 2));
  cached = updated;
  return updated;
}

// Apply a (user-reviewed) list of imported hero rows to the profile.
// Existing notes are preserved; everything else is overwritten.
export function mergeImport(result: ScreenshotImportResult): PlayerProfile {
  const profile = getProfile();
  const next: PlayerProfile = {
    ...profile,
    heroComfort: { ...profile.heroComfort },
  };
  for (const row of result.matched) {
    const existing = next.heroComfort[row.heroId];
    next.heroComfort[row.heroId] = {
      comfortLevel: row.suggestedComfort,
      gamesPlayed: row.gamesPlayed,
      estimatedWinRate: row.winRate,
      notes: existing?.notes,
    };
  }
  return saveProfile(next);
}
