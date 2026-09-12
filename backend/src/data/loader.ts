import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hero, HeroMetaTable, MatchupTable } from "../types.js";
import { HERO_POSITIONS } from "./hero_positions.js";

// dotaconstants only exposes ./index.js via package exports, so resolve
// the entry point and read the JSON files from the sibling build/ folder.
const require = createRequire(import.meta.url);
const dotaConstantsDir = dirname(require.resolve("dotaconstants"));
const heroesRaw = JSON.parse(
  readFileSync(join(dotaConstantsDir, "build", "heroes.json"), "utf-8")
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DATA_DIR = join(__dirname, "..", "..", "data");

type DotaConstantsHero = {
  id: number;
  name: string;
  localized_name: string;
  primary_attr: string;
  attack_type: string;
  roles: string[];
  icon: string;
};

const HEROES: Hero[] = Object.values(
  heroesRaw as Record<string, DotaConstantsHero>
).map((h) => {
  const shortName = h.name.replace("npc_dota_hero_", "");
  const positions =
    HERO_POSITIONS[h.id] ?? derivePositionsFromRoles(h.roles ?? []);
  return {
    id: h.id,
    name: h.name,
    shortName,
    localizedName: h.localized_name,
    primaryAttr: (h.primary_attr as Hero["primaryAttr"]) ?? "all",
    attackType: (h.attack_type as Hero["attackType"]) ?? "Melee",
    roles: h.roles ?? [],
    iconUrl: `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${shortName}.png`,
    positions,
  };
});

const HERO_BY_ID = new Map<number, Hero>(HEROES.map((h) => [h.id, h]));

function derivePositionsFromRoles(roles: string[]): number[] {
  const r = new Set(roles);
  const positions: number[] = [];
  if (r.has("Carry")) positions.push(1);
  if (r.has("Nuker") || r.has("Pusher")) positions.push(2);
  if (r.has("Initiator") || r.has("Durable")) positions.push(3);
  if (r.has("Disabler") || r.has("Support")) positions.push(4);
  if (r.has("Support")) positions.push(5);
  return positions.length ? positions : [2, 3];
}

function loadJsonIfExists<T>(file: string, fallback: T): T {
  const p = join(DATA_DIR, file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch (e) {
    console.error(`[loader] failed to read ${file}:`, e);
    return fallback;
  }
}

interface DataFileMeta {
  generatedAt?: string;
  source?: string;
}

let matchupTable: MatchupTable = {};
let heroMetaTable: HeroMetaTable = {};
let fileMeta: DataFileMeta = {};
let dataLoadedAt: string | null = null;

export function reloadDynamicData(): void {
  matchupTable = loadJsonIfExists<MatchupTable>("matchups.json", {});

  // fetch-data's stamp is not a hero, so keep it out of the id-indexed table.
  const { _meta, ...meta } = loadJsonIfExists<
    HeroMetaTable & { _meta?: DataFileMeta }
  >("hero_stats.json", {});
  heroMetaTable = meta;
  fileMeta = _meta ?? {};

  dataLoadedAt = existsSync(join(DATA_DIR, "matchups.json"))
    ? new Date().toISOString()
    : null;
}

reloadDynamicData();

export function getHeroes(): Hero[] {
  return HEROES;
}

export function getHero(id: number): Hero | undefined {
  return HERO_BY_ID.get(id);
}

export function getMatchups(): MatchupTable {
  return matchupTable;
}

export function getHeroMeta(): HeroMetaTable {
  return heroMetaTable;
}

export function getDataStatus() {
  return {
    heroCount: HEROES.length,
    matchupHeroCount: Object.keys(matchupTable).length,
    metaHeroCount: Object.keys(heroMetaTable).length,
    dataLoadedAt,
    generatedAt: fileMeta.generatedAt ?? null,
    source: fileMeta.source ?? null,
  };
}
