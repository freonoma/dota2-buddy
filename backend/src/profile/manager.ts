import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../data/loader.js";
import { RANK_BRACKETS } from "../types.js";
import type { PlayerProfile, RankBracket, ScreenshotImportResult } from "../types.js";

const PROFILE_PATH = join(DATA_DIR, "player_profile.json");
const BACKUP_PATH = join(DATA_DIR, "player_profile.json.bak");
const CORRUPT_PATH = join(DATA_DIR, "player_profile.corrupt.json");

function isRankBracket(value: unknown): value is RankBracket {
  return RANK_BRACKETS.includes(value as RankBracket);
}

function rankFromEnv(): RankBracket {
  const rawRank = (process.env.PLAYER_RANK ?? "legend").toLowerCase();
  return isRankBracket(rawRank) ? rawRank : "legend";
}

function rolesFromEnv(): number[] {
  const rawRoles = process.env.PLAYER_PREFERRED_ROLES;
  const roles = rawRoles ? normalizeRoles(rawRoles.split(",")) : [];
  return roles.length ? roles : [2, 3];
}

function normalizeRoles(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((role) => Number(role))
    .filter((role) => Number.isInteger(role) && role >= 1 && role <= 5);
}

function normalizeRank(value: unknown): RankBracket {
  const rank = typeof value === "string" ? value.toLowerCase() : value;
  return isRankBracket(rank) ? rank : rankFromEnv();
}

function normalizeHeroComfort(value: unknown): PlayerProfile["heroComfort"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PlayerProfile["heroComfort"];
}

// The profile file is hand-editable, so its shape is re-checked rather than trusted.
function normalizeProfile(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    rankBracket: normalizeRank(profile.rankBracket),
    preferredRoles: normalizeRoles(profile.preferredRoles),
    heroComfort: normalizeHeroComfort(profile.heroComfort),
  };
}

function defaultProfileFromEnv(): PlayerProfile {
  return {
    name: process.env.PLAYER_NAME ?? "Player",
    friendId: process.env.PLAYER_FRIEND_ID || undefined,
    mmr: process.env.PLAYER_MMR
      ? Number(process.env.PLAYER_MMR)
      : undefined,
    rankBracket: rankFromEnv(),
    preferredRoles: rolesFromEnv(),
    heroComfort: {},
    lastUpdated: new Date().toISOString(),
  };
}

function writeProfileFile(profile: PlayerProfile): void {
  // The pid keeps two processes from writing into the same temp file.
  const tempPath = `${PROFILE_PATH}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(profile, null, 2));
  if (existsSync(PROFILE_PATH)) {
    copyFileSync(PROFILE_PATH, BACKUP_PATH);
  }
  renameSync(tempPath, PROFILE_PATH);
}

let cached: PlayerProfile | null = null;

export function getProfile(): PlayerProfile {
  if (cached) return cached;
  if (!existsSync(PROFILE_PATH)) {
    mkdirSync(DATA_DIR, { recursive: true });
    const seeded = defaultProfileFromEnv();
    writeProfileFile(seeded);
    cached = seeded;
    return cached;
  }
  try {
    const fromDisk: unknown = JSON.parse(readFileSync(PROFILE_PATH, "utf-8"));
    if (!fromDisk || typeof fromDisk !== "object" || Array.isArray(fromDisk)) {
      throw new Error("profile file does not contain a JSON object");
    }
    cached = mergeEnvDefaults(fromDisk as PlayerProfile);
    return cached;
  } catch (e) {
    console.error("[profile] failed to read, using default:", e);
    try {
      renameSync(PROFILE_PATH, CORRUPT_PATH);
      console.error(`[profile] unreadable file kept at ${CORRUPT_PATH}`);
    } catch (moveError) {
      console.error("[profile] could not move the unreadable file:", moveError);
    }
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
  return normalizeProfile(merged);
}

export function saveProfile(profile: PlayerProfile): PlayerProfile {
  const updated = normalizeProfile({
    ...profile,
    lastUpdated: new Date().toISOString(),
  });
  mkdirSync(DATA_DIR, { recursive: true });
  writeProfileFile(updated);
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
