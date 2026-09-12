import { useMemo, useState } from "react";
import type { DraftStore } from "../hooks/useDraftStore";
import type { Hero } from "../types";
import { HeroPortrait } from "./HeroPortrait";

interface Props {
  store: DraftStore;
}

const ATTR_FILTERS = [
  { key: "all", label: "All" },
  { key: "str", label: "STR" },
  { key: "agi", label: "AGI" },
  { key: "int", label: "INT" },
  { key: "all_attr", label: "UNI" },
] as const;

export function HeroGrid({ store }: Props) {
  const [filter, setFilter] = useState<(typeof ATTR_FILTERS)[number]["key"]>("all");
  const [search, setSearch] = useState("");

  const used = useMemo(
    () =>
      new Set<number>([
        ...store.draft.allyPicks,
        ...store.draft.enemyPicks,
        ...store.draft.bans,
      ]),
    [store.draft]
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    const byAttr = store.heroes.filter((h) => {
      if (filter === "str" && h.primaryAttr !== "str") return false;
      if (filter === "agi" && h.primaryAttr !== "agi") return false;
      if (filter === "int" && h.primaryAttr !== "int") return false;
      if (filter === "all_attr" && h.primaryAttr !== "all") return false;
      return true;
    });
    if (!q) {
      return byAttr.sort((a, b) =>
        a.localizedName.localeCompare(b.localizedName)
      );
    }
    return byAttr
      .map((hero) => ({ hero, score: heroSearchScore(hero, q) }))
      .filter((m) => m.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.hero.localizedName.localeCompare(b.hero.localizedName)
      )
      .map((m) => m.hero);
  }, [store.heroes, filter, search]);

  const handleClick = (e: React.MouseEvent, hero: Hero) => {
    e.preventDefault();
    store.addHero(hero.id, e.ctrlKey || e.metaKey ? "ban" : "ally");
    setSearch("");
  };

  const handleContextMenu = (e: React.MouseEvent, hero: Hero) => {
    e.preventDefault();
    store.addHero(hero.id, "enemy");
    setSearch("");
  };

  return (
    <div className="panel">
      <div className="panel-header gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Hero Pool
        </h2>
        <div className="flex items-center gap-2 flex-1 justify-end">
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-bg-elevated text-sm rounded-md px-2 py-1 border border-white/5 focus:outline-none focus:border-accent/50 w-40"
          />
          <div className="flex bg-bg-elevated rounded-md overflow-hidden text-xs">
            {ATTR_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2 py-1 ${
                  filter === f.key
                    ? "bg-accent/30 text-accent"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-3 pt-2 pb-1 text-[10px] text-muted flex items-center gap-3">
        <span><kbd className="kbd">Click</kbd> ally</span>
        <span><kbd className="kbd">Right-click</kbd> enemy</span>
        <span><kbd className="kbd">Ctrl+Click</kbd> ban</span>
        <span className="ml-auto">{filtered.length} heroes</span>
      </div>
      <div className="p-3 grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5 max-h-[42vh] overflow-y-auto">
        {filtered.map((hero) => {
          const isUsed = used.has(hero.id);
          return (
            <button
              key={hero.id}
              onClick={(e) => handleClick(e, hero)}
              onContextMenu={(e) => handleContextMenu(e, hero)}
              disabled={isUsed}
              title={hero.localizedName}
              className={`relative rounded overflow-hidden transition-all ${
                isUsed
                  ? "opacity-25 grayscale cursor-not-allowed"
                  : "hover:ring-2 hover:ring-accent hover:scale-105"
              }`}
            >
              <HeroPortrait hero={hero} size="md" className="w-full h-auto" />
            </button>
          );
        })}
      </div>
      <style>{`
        .kbd {
          display: inline-block;
          padding: 0 4px;
          border-radius: 3px;
          background: #1a1f2a;
          border: 1px solid rgba(255,255,255,0.08);
          font-family: ui-monospace, monospace;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function heroInitials(localizedName: string): string {
  return localizedName
    .split(/[\s-]+/)
    .map((word) => normalize(word).charAt(0))
    .join("");
}

function heroSearchScore(hero: Hero, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const targets = [
    normalize(hero.localizedName),
    normalize(hero.shortName),
    heroInitials(hero.localizedName),
  ];
  let best = 0;
  for (const target of targets) {
    if (target === q) return 3;
    if (target.startsWith(q)) best = Math.max(best, 2);
    else if (target.includes(q)) best = Math.max(best, 1);
  }
  return best;
}
