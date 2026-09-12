import { RANK_BRACKETS } from "../types.js";
import type { DraftState, PlayerProfile, RankBracket } from "../types.js";

// Any page in the browser can reach this port, and profiles are written to disk.

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const MAX_TEAM = 5;
const MAX_BANS = 20;
const MAX_NAME = 100;

export function parseDraftState(input: unknown): Validated<DraftState> {
  if (!isObject(input)) return fail("expected an object");

  const allyPicks = parseHeroIds(input.allyPicks, MAX_TEAM);
  if (!allyPicks.ok) return fail(`allyPicks: ${allyPicks.error}`);
  const enemyPicks = parseHeroIds(input.enemyPicks, MAX_TEAM);
  if (!enemyPicks.ok) return fail(`enemyPicks: ${enemyPicks.error}`);
  const bans = parseHeroIds(input.bans, MAX_BANS);
  if (!bans.ok) return fail(`bans: ${bans.error}`);

  const yourRole = input.yourRole;
  if (!isInt(yourRole) || yourRole < 1 || yourRole > 5) {
    return fail("yourRole must be an integer from 1 to 5");
  }

  const round = input.round;
  if (!isInt(round) || round < 1 || round > 3) {
    return fail("round must be 1, 2 or 3");
  }

  const yourSide = input.yourSide;
  if (yourSide !== "radiant" && yourSide !== "dire") {
    return fail('yourSide must be "radiant" or "dire"');
  }

  return {
    ok: true,
    value: {
      allyPicks: allyPicks.value,
      enemyPicks: enemyPicks.value,
      bans: bans.value,
      yourRole,
      round: round as 1 | 2 | 3,
      yourSide,
    },
  };
}

export function parsePlayerProfile(input: unknown): Validated<PlayerProfile> {
  if (!isObject(input)) return fail("expected an object");

  const name = input.name;
  if (typeof name !== "string" || name.length > MAX_NAME) {
    return fail(`name must be a string of at most ${MAX_NAME} characters`);
  }

  if (!isRankBracket(input.rankBracket)) {
    return fail(`rankBracket must be one of: ${RANK_BRACKETS.join(", ")}`);
  }

  const preferredRoles = parseRoles(input.preferredRoles);
  if (!preferredRoles.ok) return fail(`preferredRoles: ${preferredRoles.error}`);

  const heroComfort = parseHeroComfort(input.heroComfort);
  if (!heroComfort.ok) return fail(`heroComfort: ${heroComfort.error}`);

  const profile: PlayerProfile = {
    name,
    rankBracket: input.rankBracket,
    preferredRoles: preferredRoles.value,
    heroComfort: heroComfort.value,
    lastUpdated: new Date().toISOString(),
  };

  if (typeof input.friendId === "string" && input.friendId.length <= 32) {
    profile.friendId = input.friendId;
  }
  if (isInt(input.mmr) && input.mmr >= 0 && input.mmr <= 20000) {
    profile.mmr = input.mmr;
  }

  return { ok: true, value: profile };
}

export interface ExplainRequest {
  heroId: number;
  allyHeroIds: number[];
  enemyHeroIds: number[];
  yourRole: number;
}

export function parseExplainRequest(input: unknown): Validated<ExplainRequest> {
  if (!isObject(input)) return fail("expected an object");

  if (!isHeroId(input.heroId)) return fail("heroId must be a positive integer");

  const allyHeroIds = parseHeroIds(input.allyHeroIds, MAX_TEAM);
  if (!allyHeroIds.ok) return fail(`allyHeroIds: ${allyHeroIds.error}`);
  const enemyHeroIds = parseHeroIds(input.enemyHeroIds, MAX_TEAM);
  if (!enemyHeroIds.ok) return fail(`enemyHeroIds: ${enemyHeroIds.error}`);

  const yourRole = input.yourRole;
  if (!isInt(yourRole) || yourRole < 1 || yourRole > 5) {
    return fail("yourRole must be an integer from 1 to 5");
  }

  return {
    ok: true,
    value: {
      heroId: input.heroId,
      allyHeroIds: allyHeroIds.value,
      enemyHeroIds: enemyHeroIds.value,
      yourRole,
    },
  };
}

export interface ImportRow {
  heroId: number;
  heroName: string;
  gamesPlayed: number;
  winRate?: number;
  suggestedComfort: 1 | 2 | 3 | 4 | 5;
}

export function parseImportRows(input: unknown): Validated<ImportRow[]> {
  if (!Array.isArray(input)) return fail("expected an array");
  if (input.length > 200) return fail("too many rows");

  const rows: ImportRow[] = [];
  for (const [i, raw] of input.entries()) {
    if (!isObject(raw)) return fail(`row ${i}: expected an object`);
    if (!isHeroId(raw.heroId)) return fail(`row ${i}: invalid heroId`);
    if (!isComfortLevel(raw.suggestedComfort)) {
      return fail(`row ${i}: suggestedComfort must be an integer from 1 to 5`);
    }
    if (!isInt(raw.gamesPlayed) || raw.gamesPlayed < 0) {
      return fail(`row ${i}: gamesPlayed must be a non-negative integer`);
    }

    const row: ImportRow = {
      heroId: raw.heroId,
      heroName: typeof raw.heroName === "string" ? raw.heroName : "",
      gamesPlayed: raw.gamesPlayed,
      suggestedComfort: raw.suggestedComfort,
    };
    if (isFraction(raw.winRate)) row.winRate = raw.winRate;
    rows.push(row);
  }

  return { ok: true, value: rows };
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_TYPES)[number];

export interface ScreenshotRequest {
  image: string;
  mediaType: ImageMediaType;
}

export function parseScreenshotRequest(
  input: unknown,
  maxBytes: number
): Validated<ScreenshotRequest> {
  if (!isObject(input)) return fail("expected an object");

  const { image, mediaType } = input;
  if (typeof image !== "string" || image.length === 0) {
    return fail("image must be a base64 string");
  }
  // Base64 encodes three bytes per four characters.
  if ((image.length * 3) / 4 > maxBytes) {
    return fail(`image must be under ${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }
  if (!IMAGE_TYPES.includes(mediaType as ImageMediaType)) {
    return fail(`mediaType must be one of: ${IMAGE_TYPES.join(", ")}`);
  }

  return { ok: true, value: { image, mediaType: mediaType as ImageMediaType } };
}

function parseHeroIds(input: unknown, max: number): Validated<number[]> {
  if (input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) return fail("expected an array");
  if (input.length > max) return fail(`expected at most ${max} entries`);
  if (!input.every(isHeroId)) return fail("expected positive integer hero ids");
  return { ok: true, value: Array.from(new Set(input as number[])) };
}

function parseRoles(input: unknown): Validated<number[]> {
  if (input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) return fail("expected an array");
  if (input.length > 5) return fail("expected at most 5 entries");
  const roles = input.filter(
    (r): r is number => isInt(r) && r >= 1 && r <= 5
  );
  if (roles.length !== input.length) {
    return fail("expected integers from 1 to 5");
  }
  return { ok: true, value: Array.from(new Set(roles)) };
}

function parseHeroComfort(
  input: unknown
): Validated<PlayerProfile["heroComfort"]> {
  if (input === undefined) return { ok: true, value: {} };
  if (!isObject(input)) return fail("expected an object");

  const out: PlayerProfile["heroComfort"] = {};
  for (const [key, raw] of Object.entries(input)) {
    const heroId = Number(key);
    if (!isHeroId(heroId)) return fail(`invalid hero id "${key}"`);
    if (!isObject(raw)) return fail(`hero ${key}: expected an object`);
    if (!isComfortLevel(raw.comfortLevel)) {
      return fail(`hero ${key}: comfortLevel must be an integer from 1 to 5`);
    }

    const entry: PlayerProfile["heroComfort"][number] = {
      comfortLevel: raw.comfortLevel,
    };
    if (isInt(raw.gamesPlayed) && raw.gamesPlayed >= 0) {
      entry.gamesPlayed = raw.gamesPlayed;
    }
    if (isFraction(raw.estimatedWinRate)) {
      entry.estimatedWinRate = raw.estimatedWinRate;
    }
    if (typeof raw.notes === "string" && raw.notes.length <= 500) {
      entry.notes = raw.notes;
    }
    out[heroId] = entry;
  }

  return { ok: true, value: out };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isHeroId(v: unknown): v is number {
  return isInt(v) && v > 0 && v < 100000;
}

function isComfortLevel(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return isInt(v) && v >= 1 && v <= 5;
}

function isFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function isRankBracket(v: unknown): v is RankBracket {
  return RANK_BRACKETS.includes(v as RankBracket);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
