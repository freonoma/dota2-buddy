import { useCallback, useEffect, useMemo, useReducer } from "react";
import type {
  DraftState,
  Hero,
  PlayerProfile,
  Recommendation,
  SlotKind,
} from "../types";

interface AppState {
  heroes: Hero[];
  heroById: Map<number, Hero>;
  draft: DraftState;
  recommendations: Recommendation[];
  profile: PlayerProfile | null;
  connected: boolean;
}

type Action =
  | { type: "set-heroes"; heroes: Hero[] }
  | { type: "set-recommendations"; recs: Recommendation[] }
  | { type: "set-profile"; profile: PlayerProfile }
  | { type: "set-connected"; connected: boolean }
  | { type: "set-draft"; draft: DraftState }
  | { type: "add-hero"; heroId: number; kind: SlotKind }
  | { type: "remove-hero"; heroId: number }
  | { type: "set-role"; role: number }
  | { type: "set-round"; round: 1 | 2 | 3 }
  | { type: "set-side"; side: "radiant" | "dire" }
  | { type: "reset" };

const INITIAL_DRAFT: DraftState = {
  allyPicks: [],
  enemyPicks: [],
  bans: [],
  yourRole: 3,
  round: 1,
  yourSide: "radiant",
};

const INITIAL_STATE: AppState = {
  heroes: [],
  heroById: new Map(),
  draft: INITIAL_DRAFT,
  recommendations: [],
  profile: null,
  connected: false,
};

function withoutHero(arr: number[], id: number): number[] {
  return arr.filter((x) => x !== id);
}

// Round is derived from pick counts so it auto-advances.
function deriveRound(
  allyPicks: number[],
  enemyPicks: number[]
): 1 | 2 | 3 {
  const max = Math.max(allyPicks.length, enemyPicks.length);
  if (max < 2) return 1;
  if (max < 4) return 2;
  return 3;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "set-heroes":
      return {
        ...state,
        heroes: action.heroes,
        heroById: new Map(action.heroes.map((h) => [h.id, h])),
      };
    case "set-recommendations":
      return { ...state, recommendations: action.recs };
    case "set-profile":
      return { ...state, profile: action.profile };
    case "set-connected":
      return { ...state, connected: action.connected };
    case "set-draft":
      return { ...state, draft: action.draft };
    case "add-hero": {
      const { heroId, kind } = action;
      const cleaned = {
        allyPicks: withoutHero(state.draft.allyPicks, heroId),
        enemyPicks: withoutHero(state.draft.enemyPicks, heroId),
        bans: withoutHero(state.draft.bans, heroId),
      };
      const limit = kind === "ban" ? 8 : 5;
      const target =
        kind === "ally" ? cleaned.allyPicks : kind === "enemy" ? cleaned.enemyPicks : cleaned.bans;
      if (target.length >= limit) return state;
      const next = { ...cleaned };
      if (kind === "ally") next.allyPicks = [...cleaned.allyPicks, heroId];
      if (kind === "enemy") next.enemyPicks = [...cleaned.enemyPicks, heroId];
      if (kind === "ban") next.bans = [...cleaned.bans, heroId];
      return {
        ...state,
        draft: {
          ...state.draft,
          ...next,
          round: deriveRound(next.allyPicks, next.enemyPicks),
        },
      };
    }
    case "remove-hero": {
      const allyPicks = withoutHero(state.draft.allyPicks, action.heroId);
      const enemyPicks = withoutHero(state.draft.enemyPicks, action.heroId);
      const bans = withoutHero(state.draft.bans, action.heroId);
      return {
        ...state,
        draft: {
          ...state.draft,
          allyPicks,
          enemyPicks,
          bans,
          round: deriveRound(allyPicks, enemyPicks),
        },
      };
    }
    case "set-role":
      return { ...state, draft: { ...state.draft, yourRole: action.role } };
    case "set-round":
      return { ...state, draft: { ...state.draft, round: action.round } };
    case "set-side":
      return { ...state, draft: { ...state.draft, yourSide: action.side } };
    case "reset":
      return {
        ...state,
        draft: { ...INITIAL_DRAFT, yourRole: state.draft.yourRole },
        recommendations: [],
      };
  }
}

export function useDraftStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const wsRef = useMemo(() => ({ current: null as WebSocket | null }), []);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => dispatch({ type: "set-connected", connected: true });
    ws.onclose = () => dispatch({ type: "set-connected", connected: false });
    ws.onerror = () => dispatch({ type: "set-connected", connected: false });
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "heroes":
            dispatch({ type: "set-heroes", heroes: msg.payload });
            break;
          case "recommendations":
            dispatch({ type: "set-recommendations", recs: msg.payload });
            break;
          case "profile":
            dispatch({ type: "set-profile", profile: msg.payload });
            break;
        }
      } catch {
        /* ignore */
      }
    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "request-recommendations",
        payload: state.draft,
      })
    );
  }, [state.draft, state.connected, wsRef]);

  const addHero = useCallback(
    (heroId: number, kind: SlotKind) => dispatch({ type: "add-hero", heroId, kind }),
    []
  );
  const removeHero = useCallback(
    (heroId: number) => dispatch({ type: "remove-hero", heroId }),
    []
  );
  const setRole = useCallback(
    (role: number) => dispatch({ type: "set-role", role }),
    []
  );
  const setRound = useCallback(
    (round: 1 | 2 | 3) => dispatch({ type: "set-round", round }),
    []
  );
  const setSide = useCallback(
    (side: "radiant" | "dire") => dispatch({ type: "set-side", side }),
    []
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const saveProfile = useCallback(
    (profile: PlayerProfile) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "save-profile", payload: profile }));
    },
    [wsRef]
  );

  return {
    ...state,
    addHero,
    removeHero,
    setRole,
    setRound,
    setSide,
    reset,
    saveProfile,
  };
}

export type DraftStore = ReturnType<typeof useDraftStore>;
