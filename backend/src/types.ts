export interface Hero {
  id: number;
  name: string;
  shortName: string;
  localizedName: string;
  primaryAttr: "agi" | "str" | "int" | "all";
  attackType: "Melee" | "Ranged";
  roles: string[];
  iconUrl: string;
  positions: number[];
}

export type MatchupTable = Record<
  number,
  Record<number, { gamesPlayed: number; wins: number; winRate: number }>
>;

export type HeroMetaTable = Record<
  number,
  {
    pickRate: number;
    winRate: number;
    proPickRate?: number;
    proWinRate?: number;
  }
>;

export interface DraftState {
  allyPicks: number[];
  enemyPicks: number[];
  bans: number[];
  yourRole: number;
  round: 1 | 2 | 3;
  yourSide: "radiant" | "dire";
}

export interface RecommendationBreakdown {
  counterScore: number;
  synergyScore: number;
  metaScore: number;
  comfortScore: number;
  roleScore: number;
}

export interface Recommendation {
  heroId: number;
  totalScore: number;
  breakdown: RecommendationBreakdown;
  suggestedPosition: number;
  reasoning?: string;
}

export interface PlayerProfile {
  name: string;
  friendId?: string;
  mmr?: number;
  rankBracket: "herald" | "guardian" | "crusader" | "archon" | "legend" | "ancient" | "divine" | "immortal";
  preferredRoles: number[];
  heroComfort: Record<
    number,
    {
      comfortLevel: 1 | 2 | 3 | 4 | 5;
      estimatedWinRate?: number;
      gamesPlayed?: number;
      notes?: string;
    }
  >;
  lastUpdated: string;
}

export interface ScreenshotImportResult {
  matched: Array<{
    heroId: number;
    heroName: string;
    gamesPlayed: number;
    wins?: number;
    winRate?: number;
    suggestedComfort: 1 | 2 | 3 | 4 | 5;
  }>;
  unmatched: Array<{
    rawName: string;
    gamesPlayed: number;
    winRate?: number;
  }>;
  rawText?: string;
}

export interface ServerToClientMessage {
  type: "draft-state" | "recommendations" | "heroes" | "profile" | "data-status";
  payload: unknown;
}

export interface ClientToServerMessage {
  type:
    | "set-draft"
    | "request-recommendations"
    | "save-profile"
    | "reset-draft";
  payload: unknown;
}
